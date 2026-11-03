import { rulesOf } from '../skills/skills';
import { JointSelection } from '../../core/decisions/selection';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { isGameOver } from '../game/end';
import { delayedCards } from './delayed';
import type { SemanticCard } from './types';

export interface OwnedCardChoice {
  readonly actor: string;
  readonly target: string;
  readonly areas: readonly string[];
  readonly reason: string;
  readonly prompt?: string;
  readonly discard?: boolean;
  /** 可取消选牌不宣告技能；调用者在接纳后负责支付与后效。 */
  readonly optional?: boolean;
}
export type ChosenOwnedCard =
  | { readonly kind: 'chosen'; readonly card: string; readonly from: string }
  | {
      readonly kind: 'delayed';
      readonly id: string;
      readonly from: string;
      readonly card: SemanticCard;
    }
  | { readonly kind: 'unavailable' };

/** 隐藏手牌只给本次选择的 opaque 选项；公开区显示牌名，最终再次验证持有区域。 */
export function chooseOwnedCard(ctx: Context, request: OwnedCardChoice): Promise<ChosenOwnedCard> {
  const book = rulesOf(ctx);
  return ctx.flow('chooseOwnedCard', async (child) => {
    const input = immutable(request);
    if (
      !child.world.player(input.actor).alive ||
      !child.world.player(input.target).alive ||
      isGameOver(child.world)
    )
      return { kind: 'unavailable' };
    const delayed = delayedCards(child.world, input.target, true);
    const initial = child.world.snapshot.zones
      .filter((zone) => zone.owner === input.target && input.areas.includes(zone.kind))
      .flatMap((zone): { card: string; from: string; delayed: SemanticCard | null }[] => {
        const entry = delayed.find((entry) => entry.id === zone.id);
        return entry
          ? [{ card: entry.id, from: zone.id, delayed: entry.source.card }]
          : zone.cards.map((card) => ({
              card,
              from: zone.id,
              delayed: null,
            }));
      });
    const visible = (from: string) => {
      const zone = child.world.zone(from);
      return (
        zone.kind === 'equipment' ||
        zone.kind === 'judgment' ||
        (zone.kind === 'hand' && input.actor === input.target)
      );
    };
    const hidden = initial.filter((item) => !visible(item.from));
    // 隐藏牌选项不沿用手牌顺序或实体 ID；随机源与本局一致，重放可追踪实际选择事实。
    for (let i = hidden.length - 1; i > 0; i--) {
      const j = child.randomInt(i + 1);
      [hidden[i], hidden[j]] = [hidden[j]!, hidden[i]!];
    }
    const options = [...hidden, ...initial.filter((item) => visible(item.from))].map((item, i) => ({
      ...item,
      id: `${child.cause.flowId}:option:${i + 1}`,
    }));
    const live = () =>
      child.world.player(input.actor).alive &&
      child.world.player(input.target).alive &&
      !isGameOver(child.world);
    const available = () =>
      live()
        ? options
            .filter((item) =>
              item.delayed
                ? delayedCards(child.world, input.target, true).some(
                    (entry) => entry.id === item.card,
                  )
                : child.world.position(item.card) === item.from,
            )
            .filter(
              (item) =>
                !input.discard ||
                book.canDiscard(child, {
                  actor: input.actor,
                  owner: input.target,
                  card: item.card,
                  reason: input.reason,
                }),
            )
        : [];
    const selection = new JointSelection({
      cards: () =>
        available().map((item, i) => {
          const zone = child.world.zone(item.from);
          const card = visible(item.from) ? (item.delayed ?? book.face(child, item.card)) : null;
          return {
            id: item.id,
            label: !card
              ? `${zone.kind === 'hand' ? '未知手牌' : '未知牌'} ${i + 1}`
              : `${book.definition(card.name).label} · ${card.suit} ${card.rank}`,
          };
        }),
      cardCount: { min: 1, max: 1 },
    });
    const answer = await child.ask({
      ...selection.decision(input.actor, input.prompt ?? `选择 ${input.target} 的一张牌`, {
        optional: input.optional ?? false,
      }),
      describe: () => ({
        ...selection.describe(),
        purpose: 'owned-card',
        reason: input.reason,
        target: input.target,
        ownedCards: available().map((item) => {
          const card = visible(item.from) ? (item.delayed ?? book.face(child, item.card)) : null;
          return {
            id: item.id,
            area: child.world.zone(item.from).kind,
            face: card
              ? { name: card.name, suit: card.suit, rank: card.rank, color: card.color }
              : null,
          };
        }),
        ...(input.optional ? { cancelLabel: '不发动' } : {}),
      }),
    });
    if (answer.kind !== 'chosen') return { kind: 'unavailable' };
    const chosen = available().find((item) => item.id === answer.value.cards[0]);
    if (!chosen) return { kind: 'unavailable' };
    child.commit('card.chosen', [], { ...input, card: chosen.card, from: chosen.from });
    if (chosen.delayed)
      return immutable({
        kind: 'delayed',
        id: chosen.card,
        from: chosen.from,
        card: chosen.delayed,
      });
    return immutable({ kind: 'chosen', card: chosen.card, from: chosen.from });
  });
}
