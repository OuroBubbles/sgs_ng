import { buildCard, cardOffers, hasCardOffers, parseCardChoice } from './card';
import { cardDef } from '../skills/skills';
import { rulesOf } from '../skills/skills';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { pay } from '../costs/pay';
import { isGameOver } from '../game/end';
import { withProcessing } from './processing';
import type { CardChoice, SemanticCard } from './types';
import { Response } from './response';
import { CardEvent } from './move';

export interface CardSupplyInput {
  readonly actor: string;
  readonly beneficiary: string;
  readonly names: readonly string[];
  readonly reason: string;
  /** 同步纯资格；保留原接收者，并在每次读取时进入查询守卫。 */
  readonly available?: (ctx: Context) => boolean;
}
export interface SuppliedCard {
  readonly id: string;
  readonly actor: string;
  readonly card: SemanticCard;
  readonly processing: string;
  /** 已打出材料仍完整归属于本次供牌，且原请求仍可继续。零材料供牌也受生存期约束。 */
  available(ctx: Context): boolean;
}
export type SupplyResult<T> =
  | { readonly kind: 'supplied'; readonly value: T }
  | { readonly kind: 'declined' | 'unavailable' | 'invalidated' };

/** 实际供牌者打出一次，材料暂存到回调结束；未被后续流程接走的余牌统一善后。 */
export function withCardSupply<T>(
  ctx: Context,
  input: CardSupplyInput,
  body: (ctx: Context, supply: SuppliedCard) => T | Promise<T>,
): Promise<SupplyResult<T>> {
  const isAvailable = input.available?.bind(input);
  const { actor, beneficiary, names, reason } = immutable({
    actor: input.actor,
    beneficiary: input.beneficiary,
    names: input.names,
    reason: input.reason,
  });
  if (!names.length || new Set(names).size !== names.length || !reason)
    throw new Error('Supply requires distinct names and a reason.');
  return ctx.flow('card.supply', async (child) => {
    const live = (at: Context) =>
      at.world === child.world &&
      child.scope.active &&
      at.cause.scopePath.includes(child.scope.id) &&
      at.world.player(actor).alive &&
      at.world.player(beneficiary).alive &&
      !isGameOver(at.world) &&
      (isAvailable === undefined || at.query(() => isAvailable(at)));
    const valid = (at: Context, choice: CardChoice) =>
      at.query(() => {
        if (!live(at)) return false;
        const built = buildCard(at, actor, choice, 'response');
        return built.ok && names.includes(built.value.name);
      });
    const answer = await child.ask<CardChoice>({
      player: actor,
      kind: 'card-response',
      prompt: `请为 ${beneficiary} 打出${names.map((name) => cardDef(ctx, name).label).join('/')}（${reason}）`,
      optional: true,
      describe: () => ({
        names,
        beneficiary,
        reason,
        offers: cardOffers(child, actor, 'response', names),
      }),
      available: () => live(child) && hasCardOffers(child, actor, 'response', names),
      validate: (value) => {
        const parsed = parseCardChoice(value);
        return !parsed.ok
          ? parsed
          : valid(child, parsed.value)
            ? parsed
            : { ok: false, reason: 'Card does not satisfy this supply.' };
      },
    });
    if (answer.kind !== 'chosen')
      return { kind: answer.kind === 'unavailable' ? 'unavailable' : 'declined' };
    const built = buildCard(child, actor, answer.value, 'response');
    if (!built.ok || !valid(child, answer.value)) return { kind: 'unavailable' };
    const card = built.value;
    const origins = new Map(card.materials.map((id) => [id, child.world.position(id)]));
    const result = await withProcessing<SupplyResult<T>>(child, [], async (at, processing) => {
      const responseId = at.cause.flowId;
      const paid = await pay(at, {
        cards: card.materials,
        to: processing.zone,
        reason,
        ...(card.source?.kind === 'viewAs'
          ? { skill: rulesOf(ctx).binding(at.world, card.source.instance)!.self }
          : { actor }),
        materialAllowed: (_ctx, id, zone) => origins.get(id) === zone.id,
        legal: (latest) => {
          const current = buildCard(latest, actor, answer.value, 'response');
          return (
            live(latest) &&
            current.ok &&
            names.includes(current.value.name) &&
            JSON.stringify(current.value) === JSON.stringify(card)
          );
        },
        factKind: CardEvent.responded,
        declaration: {
          id: responseId,
          card,
          beneficiary,
          subject: { kind: 'supply', reason },
          processing: processing.zone,
        },
      });

      if (paid.kind !== 'paid') return { kind: 'unavailable' };
      await at.window(
        Response.finished,
        {
          id: responseId,
          actor,
          card,
          subject: { kind: 'supply', id: child.cause.flowId, beneficiary, reason },
        },
        { subject: actor },
      );
      const available = (current: Context) =>
        live(current) &&
        at.scope.active &&
        current.cause.scopePath.includes(at.scope.id) &&
        card.materials.every((id) => current.world.position(id) === processing.zone);
      if (!available(at)) return { kind: 'invalidated' };
      return {
        kind: 'supplied',
        value: await body(
          at,
          Object.freeze({ id: responseId, actor, card, processing: processing.zone, available }),
        ),
      };
    });

    return result;
  });
}
