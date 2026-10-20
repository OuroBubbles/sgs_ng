import type { Card, CardMove, Zone, Change } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context, FlowResult } from '../../core/runtime/room';
import type { CardBook } from './book';
import { delayedCards } from './delayed';
import { moveCards } from './move';
import { pay } from '../costs/pay';
import type { PaymentSpec, PaymentResult } from '../costs/pay';

export interface DiscardRequest {
  readonly actor: string;
  readonly owner: string;
  /** 实体牌 ID，或整个延时牌的逻辑 ID；判定区材料不能作为独立牌绕过整体规则。 */
  readonly card: string;
  readonly reason: string;
}
export interface DiscardQuery extends DiscardRequest {
  readonly area: Zone['kind'];
  readonly face: Pick<Card, 'name' | 'suit' | 'rank'>;
  readonly materials: readonly string[];
}

/** 统一解释实时位置与牌面。是否允许由 CardBook 查询；这里没有可写实体或展示选项 ID。 */
export function discardSubject(ctx: Context, request: DiscardRequest): DiscardQuery | null {
  const identity = {
    actor: request.actor,
    owner: request.owner,
    card: request.card,
    reason: request.reason,
  };
  const delayed = delayedCards(ctx.world, request.owner, true);
  const entry = delayed.find((entry) => entry.id === request.card);
  if (entry)
    return immutable({
      ...identity,
      area: 'judgment',
      face: entry.source.card,
      materials: entry.cards,
    });
  const card = ctx.world.snapshot.cards.find((card) => card.id === request.card);
  if (!card) return null;
  const zone = ctx.world.zone(ctx.world.position(card.id));
  if (zone.owner !== request.owner || delayed.some((entry) => entry.id === zone.id)) return null;
  return immutable({ ...identity, area: zone.kind, face: card, materials: [card.id] });
}

/** 弃牌费用复用原子 pay：选择、弃牌权限、原有条件都在支付前重查，次数与宣告不拆开。 */
export function payDiscard(
  ctx: Context,
  book: CardBook,
  spec: Omit<PaymentSpec, 'to' | 'materialAllowed'>,
): Promise<FlowResult<PaymentResult>> {
  return pay(ctx, {
    ...spec,
    to: 'discard',
    legal: (at) =>
      spec.cards.every((card) =>
        book.canDiscard(at, { actor: spec.actor, owner: spec.actor, card, reason: spec.reason }),
      ) &&
      (spec.legal?.(at) ?? true),
  });
}

export interface DiscardResult {
  readonly kind: 'discarded' | 'unavailable';
  readonly subjects: readonly string[];
  readonly cards: readonly string[];
}

/** 明确的弃置效果：批内先完整重查，再一次提交实体移动与延时身份移除。普通移动不调用它。 */
export function discardCards(
  ctx: Context,
  book: CardBook,
  request: Omit<DiscardRequest, 'card'> & { readonly cards: readonly string[] },
): Promise<FlowResult<DiscardResult>> {
  const input = immutable(request);
  return ctx.flow('discard', async (child) => {
    const unavailable: DiscardResult = { kind: 'unavailable', subjects: input.cards, cards: [] };
    if (
      !input.cards.length ||
      new Set(input.cards).size !== input.cards.length ||
      input.cards.some((card) => !book.canDiscard(child, { ...input, card }))
    )
      return unavailable;
    const moves: CardMove[] = [];
    const changes: Exclude<Change, { readonly kind: 'move' }>[] = [];
    const delayed = delayedCards(child.world, input.owner, true);
    for (const id of input.cards) {
      const entry = delayed.find((entry) => entry.id === id);
      moves.push({
        cards: entry?.cards ?? [id],
        from: entry?.id ?? child.world.position(id),
        to: 'discard',
        place: 'bottom',
      });
      if (entry)
        changes.push(
          { kind: 'removeState', state: entry.stateId },
          { kind: 'removeZone', zone: entry.id },
        );
    }
    const cards = moves.flatMap((move) => move.cards);
    const moved = await moveCards(child, moves, input.reason, {
      kind: 'discard.committed',
      data: { ...input, subjects: input.cards, cards },
      changes,
    });
    if (moved.kind === 'aborted') return child.abort(moved.reason);
    return immutable({ kind: 'discarded', subjects: input.cards, cards });
  });
}
