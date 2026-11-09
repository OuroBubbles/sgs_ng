import { queryRule } from '../skills/skills';
import { isGameOver } from '../game/end';
import { prohibitDiscard } from './queries';
import type { Card, CardMove, Zone, Change } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { delayedCards } from './delayed';
import { moveCards, declared } from './move';
import { defineEvent } from '../../core/runtime/event';
import { timing } from '../../core/runtime/event';

export const Discard = defineEvent('discard', {
  limited: timing<
    unknown,
    { readonly actor: string; readonly required: number; readonly count: number }
  >(),
  committed: declared<
    Omit<DiscardRequest, 'card'> & {
      readonly subjects: readonly string[];
      readonly cards: readonly string[];
    }
  >(),
});

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

/** 统一解释实时位置与牌面；这里没有可写实体或展示选项 ID。 */
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

/** 能否弃置：牌须仍在所有者区域，且没有技能禁止；owner 省略时为弃置自己的牌。 */
export function canDiscard(
  ctx: Context,
  input: Omit<DiscardRequest, 'owner'> & { readonly owner?: string },
): boolean {
  return ctx.query(() => {
    const request = { ...input, owner: input.owner ?? input.actor };
    if (!request.reason || isGameOver(ctx.world)) return false;
    // 权限不替代发动资格；已宣告效果是否在来源死亡后继续，由其普通流程明确决定。
    ctx.world.player(request.actor);
    ctx.world.player(request.owner);
    const subject = discardSubject(ctx, request);
    return subject !== null && !queryRule(ctx, prohibitDiscard, subject, false);
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
  request: Omit<DiscardRequest, 'card'> & { readonly cards: readonly string[] },
): Promise<DiscardResult> {
  const input = immutable(request);
  return ctx.flow('discard', async (child) => {
    const unavailable: DiscardResult = { kind: 'unavailable', subjects: input.cards, cards: [] };
    if (
      !input.cards.length ||
      new Set(input.cards).size !== input.cards.length ||
      input.cards.some((card) => !canDiscard(child, { ...input, card }))
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
    await moveCards(child, moves, input.reason, {
      kind: Discard.committed,
      data: { ...input, subjects: input.cards, cards },
      changes,
    });

    return immutable({ kind: 'discarded', subjects: input.cards, cards });
  });
}
