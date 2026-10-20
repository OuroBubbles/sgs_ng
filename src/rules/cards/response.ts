import { immutable } from '../../core/model/value';
import type { Context, FlowResult } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import { withLifetime } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';
import { isGameOver } from '../game/end';
import { effectReference, isResponseBlocked } from './types';
import type {
  CardChoice,
  EffectRef,
  SemanticCard,
  Purpose,
  UseSnapshot,
  ResponseUseOpportunity,
} from './types';
import { parseCardChoice } from './book';
import type { CardBook } from './book';

export type ResponseResult =
  | {
      readonly kind: 'responded';
      readonly id: string;
      readonly actor: string;
      readonly card: SemanticCard;
    }
  | {
      readonly kind: 'used';
      readonly id: string;
      readonly actor: string;
      readonly card: SemanticCard;
      readonly use: UseSnapshot;
      readonly supplied?: Extract<ResponseResult, { kind: 'responded' }>;
    }
  | { readonly kind: 'declined' | 'unavailable' };

export function isResponseSatisfied(
  result: ResponseResult,
): result is Extract<ResponseResult, { kind: 'used' | 'responded' }> {
  return result.kind === 'used' || result.kind === 'responded';
}

export interface ResponseOpportunity {
  readonly id: string;
  readonly lifetime: Lifetime;
  readonly actor: string;
  /** 使用与打出分别经过原有支付/禁令/完成管线；委托者始终实际打出。 */
  readonly purpose: Purpose;
  readonly beneficiary: string;
  /** 当前效果允许的语义牌名；被具名禁令排除的名称不进入供牌与菜单。 */
  readonly names: readonly string[];
  readonly to: EffectRef;
  readonly actors: readonly string[];
  readonly result: ResponseResult | null;
  available(ctx: Context): boolean;
  canProvide(ctx: Context, choice: CardChoice): boolean;
  provide(ctx: Context, choice: CardChoice): Promise<FlowResult<ResponseResult>>;
  /** 委托可收窄允许名称，但不能扩大原请求或创建空请求。 */
  delegate(
    ctx: Context,
    actor: string,
    names?: readonly string[],
  ): Promise<FlowResult<ResponseResult>>;
}
export interface ResponseIntent {
  readonly actor: string;
  readonly purpose: Purpose;
  readonly opportunity: ResponseUseOpportunity;
  readonly beneficiary: string;
  readonly request: string;
  readonly names: readonly string[];
  readonly to: EffectRef;
  readonly choice: CardChoice;
}
export type ResponseConsumer = (
  ctx: Context,
  response: Extract<ResponseResult, { kind: 'responded' }>,
  available: (ctx: Context) => boolean,
) => Promise<FlowResult<ResponseResult>>;
type CommitResponse = (
  ctx: Context,
  input: ResponseIntent,
  available: (ctx: Context) => boolean,
  consume?: ResponseConsumer,
) => Promise<FlowResult<ResponseResult>>;
interface ParentResponse {
  readonly id: string;
  readonly beneficiary: string;
  readonly actors: readonly string[];
  readonly live: (ctx: Context) => boolean;
}
export const responseRequested = defineWindow<ResponseOpportunity>('response.requested');

/** 响应机会只拥有待决请求；使用、打出、材料交接由 CardBook 原有领域管线执行。 */
export function requestResponse(
  ctx: Context,
  book: CardBook,
  actor: string,
  requestedNames: readonly string[],
  target: EffectRef,
  commit: CommitResponse,
  parent?: ParentResponse,
  purpose: Purpose = 'response',
  consume?: ResponseConsumer,
): Promise<FlowResult<ResponseResult>> {
  const requested = immutable(requestedNames);
  const to = effectReference(target);
  const beneficiary = parent?.beneficiary ?? actor;
  const names = immutable(requested.filter((name) => !isResponseBlocked(to, beneficiary, name)));
  return withLifetime(ctx, 'response', async (child, lifetime) => {
    const actors = immutable([...(parent?.actors ?? []), actor]);
    let supplied: ResponseResult | null = null;
    let busy = false;
    const live = (at: Context) =>
      at.world === child.world &&
      lifetime.active &&
      at.cause.scopePath.includes(lifetime.id) &&
      !isGameOver(at.world) &&
      names.length > 0 &&
      at.world.player(actor).alive &&
      at.world.player(to.target).alive &&
      (parent?.live(at) ?? true);
    const pending = (at: Context) => live(at) && supplied === null;
    const available = (at: Context) => pending(at) && !busy;
    const canProvide = (at: Context, choice: CardChoice) =>
      at.query(() => {
        if (!available(at)) return false;
        const card = book.build(at, actor, choice, purpose);
        if (!card.ok || !names.includes(card.value.name)) return false;
        return (
          purpose === 'response' ||
          book.validateUse(at, {
            actor,
            choice,
            targets: [],
            timing: { kind: 'response', opportunity: useOpportunity },
          }).ok
        );
      });
    const useOpportunity: ResponseUseOpportunity = Object.freeze({
      lifetime,
      actor,
      names,
      to,
      available: pending,
    });
    const opportunity: ResponseOpportunity = Object.freeze({
      id: lifetime.id,
      lifetime,
      actor,
      purpose,
      beneficiary,
      names,
      to,
      actors,
      get result() {
        return supplied;
      },
      available,
      canProvide,
      provide: (at: Context, choice: CardChoice) =>
        at.flow<ResponseResult>('response.provide', async (provider) => {
          const selected = immutable(choice);
          if (!canProvide(provider, selected)) return { kind: 'unavailable' };
          busy = true;
          try {
            const result = await commit(
              provider,
              {
                actor,
                purpose,
                opportunity: useOpportunity,
                beneficiary,
                request: lifetime.id,
                names,
                to,
                choice: selected,
              },
              live,
              consume,
            );
            if (result.kind === 'aborted') return provider.abort(result.reason);
            if (isResponseSatisfied(result.value)) supplied = immutable(result.value);
            return result.value;
          } finally {
            busy = false;
          }
        }),
      delegate: (at: Context, provider: string, acceptedNames: readonly string[] = names) =>
        at.flow<ResponseResult>('response.delegate', async (delegation) => {
          const delegatedNames = immutable(acceptedNames);
          if (
            !available(delegation) ||
            actors.includes(provider) ||
            !delegation.world.player(provider).alive ||
            !delegatedNames.length ||
            new Set(delegatedNames).size !== delegatedNames.length ||
            delegatedNames.some((name) => !names.includes(name))
          )
            return { kind: 'unavailable' };
          busy = true;
          try {
            // 代打材料仍在其处理区时，由原请求者执行完整使用；没有第二次供牌菜单。
            const accept: ResponseConsumer | undefined =
              purpose === 'use'
                ? (at, response, materialsAvailable) =>
                    at.flow<ResponseResult>('response.consume', async (handoff) => {
                      const card = response.card;
                      const choice: CardChoice = {
                        kind: 'generated',
                        reason: 'response.delegated',
                        face: {
                          name: card.name,
                          suit: card.suit,
                          color: card.color,
                          rank: card.rank,
                          nature: card.nature,
                        },
                        materials: card.materials,
                        origin: { actor: response.actor, card },
                      };
                      const result = await commit(
                        handoff,
                        {
                          actor,
                          purpose,
                          opportunity: useOpportunity,
                          beneficiary,
                          request: lifetime.id,
                          names,
                          to,
                          choice,
                        },
                        (current) => live(current) && materialsAvailable(current),
                      );
                      if (result.kind === 'aborted') return handoff.abort(result.reason);
                      return result.value.kind === 'used'
                        ? { ...result.value, supplied: response }
                        : result.value;
                    })
                : consume;
            const result = await requestResponse(
              delegation,
              book,
              provider,
              delegatedNames,
              to,
              commit,
              {
                id: lifetime.id,
                beneficiary,
                actors,
                live,
              },
              'response',
              accept,
            );
            if (result.kind === 'aborted') return delegation.abort(result.reason);
            if (isResponseSatisfied(result.value)) {
              supplied = immutable(result.value);
              delegation.commit('response.delegated', [], {
                request: lifetime.id,
                actor,
                beneficiary,
                provider:
                  result.value.kind === 'used' ? result.value.supplied?.actor : result.value.actor,
                response:
                  result.value.kind === 'used' ? result.value.supplied?.id : result.value.id,
                result: result.value,
              });
              return result.value;
            }
            return { kind: 'unavailable' };
          } finally {
            busy = false;
          }
        }),
    });
    const snapshot = {
      id: lifetime.id,
      actor,
      purpose,
      beneficiary,
      requestedNames: requested,
      names,
      to,
      actors,
      parent: parent?.id ?? null,
    };
    const offers = () =>
      book.offers(
        child,
        actor,
        purpose === 'use' ? { kind: 'response', opportunity: useOpportunity } : 'response',
        names,
      );
    child.commit('response.requested', [], snapshot);
    if (available(child))
      await child.window(responseRequested, opportunity, { subject: actor, active: pending });
    let result: ResponseResult;
    if (supplied) result = supplied;
    else if (!available(child)) result = { kind: 'unavailable' };
    else {
      const answer = await child.ask<CardChoice>({
        player: actor,
        kind: 'card-response',
        prompt: `请${actor === beneficiary ? '' : `为 ${beneficiary} `}${purpose === 'use' ? '使用' : '打出'}${names.map((name) => book.definition(name).label).join('/')}`,
        data: null,
        describe: () => ({
          to: { useId: to.useId, effectId: to.effectId },
          names,
          purpose,
          beneficiary,
          offers: offers(),
        }),
        optional: true,
        available: () => available(child) && offers().length > 0,
        validate: (input) => {
          const parsed = parseCardChoice(input);
          return !parsed.ok
            ? parsed
            : canProvide(child, parsed.value)
              ? parsed
              : { ok: false, reason: 'Card does not satisfy this response.' };
        },
      });
      if (answer.kind !== 'chosen')
        result = { kind: answer.kind === 'unavailable' ? 'unavailable' : 'declined' };
      else {
        const provided = await opportunity.provide(child, answer.value);
        if (provided.kind === 'aborted') return child.abort(provided.reason);
        result = provided.value;
      }
    }
    child.commit('response.request.finished', [], { ...snapshot, result });
    return immutable(result);
  });
}
