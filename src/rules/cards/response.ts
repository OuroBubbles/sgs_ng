import { equal, immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { withLifetime } from '../scopes/lifetime';
import type { CardResponse } from './played';
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
import { cardDef } from '../skills/skills';
import { pay } from '../costs/pay';
import { buildCard, cardOffers, hasCardOffers, parseCardChoice } from './card';
import { CardEvent } from './move';
import { withProcessing } from './processing';
import { abilityHandle, useCard, validateUse } from './use';
import { defineEvent, timing } from '../../core/runtime/event';

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
  provide(ctx: Context, choice: CardChoice): Promise<ResponseResult>;
  /** 委托可收窄允许名称，但不能扩大原请求或创建空请求。 */
  delegate(ctx: Context, actor: string, names?: readonly string[]): Promise<ResponseResult>;
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
) => Promise<ResponseResult>;
interface ParentResponse {
  readonly id: string;
  readonly beneficiary: string;
  readonly actors: readonly string[];
  readonly live: (ctx: Context) => boolean;
}
/** 响应请求写入历史的快照。 */
export interface ResponseRequest {
  readonly id: string;
  readonly actor: string;
  readonly purpose: Purpose;
  readonly beneficiary: string;
  readonly requestedNames: readonly string[];
  readonly names: readonly string[];
  readonly to: EffectRef;
  readonly actors: readonly string[];
  readonly parent: string | null;
}
export const Response = defineEvent('response', {
  finished: timing<CardResponse>(),
  requested: timing<ResponseOpportunity, ResponseRequest>(),
  delegated: timing<unknown>(),
  requestFinished: timing<unknown>(),
});

/** 响应机会只拥有待决请求；使用、打出、材料交接由原有用牌/支付管线执行。 */
function requestResponse(
  ctx: Context,
  actor: string,
  requestedNames: readonly string[],
  target: EffectRef,
  parent?: ParentResponse,
  purpose: Purpose = 'response',
  consume?: ResponseConsumer,
): Promise<ResponseResult> {
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
      (parent === undefined || at.query(() => parent.live(at)));
    const pending = (at: Context) => live(at) && supplied === null;
    const available = (at: Context) => pending(at) && !busy;
    const canProvide = (at: Context, choice: CardChoice) =>
      at.query(() => {
        if (!available(at)) return false;
        const card = buildCard(at, actor, choice, purpose);
        if (!card.ok || !names.includes(card.value.name)) return false;
        return (
          purpose === 'response' ||
          validateUse(at, {
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
            const result = await answerChoice(
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

            if (isResponseSatisfied(result)) supplied = immutable(result);
            return result;
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
                      const result = await answerChoice(
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

                      return result.kind === 'used' ? { ...result, supplied: response } : result;
                    })
                : consume;
            const result = await requestResponse(
              delegation,
              provider,
              delegatedNames,
              to,
              {
                id: lifetime.id,
                beneficiary,
                actors,
                live,
              },
              'response',
              accept,
            );

            if (isResponseSatisfied(result)) {
              supplied = immutable(result);
              delegation.commit(Response.delegated, [], {
                request: lifetime.id,
                actor,
                beneficiary,
                provider: result.kind === 'used' ? result.supplied?.actor : result.actor,
                response: result.kind === 'used' ? result.supplied?.id : result.id,
                result: result,
              });
              return result;
            }
            return { kind: 'unavailable' };
          } finally {
            busy = false;
          }
        }),
    });
    const snapshot: ResponseRequest = {
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
    const offerPurpose =
      purpose === 'use' ? { kind: 'response' as const, opportunity: useOpportunity } : 'response';
    const offers = () => cardOffers(child, actor, offerPurpose, names);
    child.commit(Response.requested, [], snapshot);
    if (available(child))
      await child.window(Response.requested, opportunity, { subject: actor, active: pending });
    let result: ResponseResult;
    if (supplied) result = supplied;
    else if (!available(child)) result = { kind: 'unavailable' };
    else {
      const answer = await child.ask<CardChoice>({
        player: actor,
        kind: 'card-response',
        prompt: `请${actor === beneficiary ? '' : `为 ${beneficiary} `}${purpose === 'use' ? '使用' : '打出'}${names.map((name) => cardDef(child, name).label).join('/')}`,
        describe: () => ({
          to: { useId: to.useId, effectId: to.effectId },
          names,
          purpose,
          beneficiary,
          offers: offers(),
        }),
        optional: true,
        available: () => available(child) && hasCardOffers(child, actor, offerPurpose, names),
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

        result = provided;
      }
    }
    child.commit(Response.requestFinished, [], { ...snapshot, result });
    return immutable(result);
  });
}

export function respond(
  ctx: Context,
  actor: string,
  requestedNames: readonly string[],
  target: EffectRef,
): Promise<ResponseResult> {
  return requestResponse(ctx, actor, requestedNames, target);
}

/** 响应一个效果时使用牌；技能供牌者实际打出，原请求者使用，材料在回调内交接。 */
export function useResponse(
  ctx: Context,
  actor: string,
  names: readonly string[],
  target: EffectRef,
): Promise<ResponseResult> {
  return requestResponse(ctx, actor, names, target, undefined, 'use');
}

function answerChoice(
  ctx: Context,
  input: ResponseIntent,
  available: (ctx: Context) => boolean,
  consume?: ResponseConsumer,
): Promise<ResponseResult> {
  if (input.purpose === 'response') return respondChoice(ctx, input, available, consume);
  return ctx.flow<ResponseResult>('response.use', async (at) => {
    const opportunity = Object.freeze({
      ...input.opportunity,
      available: (current: Context) =>
        current.query(() => input.opportunity.available(current) && available(current)),
    });
    const result = await useCard(at, {
      actor: input.actor,
      choice: input.choice,
      targets: [],
      timing: { kind: 'response', opportunity },
    });
    return result.kind === 'used'
      ? {
          kind: 'used',
          id: result.use.id,
          actor: result.use.actor,
          card: result.use.card,
          use: result.use,
        }
      : { kind: 'unavailable' };
  });
}

function respondChoice(
  ctx: Context,
  input: ResponseIntent,
  available: (ctx: Context) => boolean,
  consume?: ResponseConsumer,
): Promise<ResponseResult> {
  return ctx.flow('response.card', async (child) => {
    const { actor, names, to, choice } = input;
    const built = buildCard(child, actor, choice, 'response');
    if (!child.query(() => available(child)) || !built.ok || !names.includes(built.value.name))
      return { kind: 'unavailable' };
    const card = built.value;
    const id = child.cause.flowId;
    const origins = new Map(
      card.materials.map((material) => [material, child.world.position(material)]),
    );
    const processed = await withProcessing<ResponseResult>(child, [], async (body, processing) => {
      const paid = await pay(body, {
        cards: card.materials,
        to: processing.zone,
        reason: id,
        factKind: CardEvent.responded,
        ...(card.source?.kind === 'viewAs'
          ? { skill: abilityHandle(body, card.source.instance) }
          : { actor }),
        materialAllowed: (_pay, material, zone) => origins.get(material) === zone.id,
        legal: (atPay) => {
          const current = buildCard(atPay, actor, choice, 'response');
          return (
            atPay.query(() => available(atPay)) &&
            current.ok &&
            names.includes(current.value.name) &&
            equal(current.value, card)
          );
        },
        declaration: {
          responseId: id,
          processing: processing.zone,
          request: input.request,
          beneficiary: input.beneficiary,
          to: { useId: to.useId, effectId: to.effectId },
          card,
        },
      });

      if (paid.kind !== 'paid') return { kind: 'unavailable' };
      await body.window(
        Response.finished,
        immutable({ id, actor, card, subject: { kind: 'effect', effect: to } }),
        { subject: actor },
      );
      const response = { kind: 'responded', id, actor, card } as const;
      if (!consume) return response;
      const consumed = await consume(
        body,
        response,
        (at) =>
          at.query(() => available(at)) &&
          processing.lifetime.active &&
          at.cause.scopePath.includes(processing.lifetime.id) &&
          card.materials.every((material) => at.world.position(material) === processing.zone),
      );

      return consumed;
    });

    return processed;
  });
}
