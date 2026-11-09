// 标准牌共用的小工具与事件；cards/ 下每个文件是一张牌，本文件不被扫描。
import type {
  CardDefinition,
  CardEffect,
  CardFixedTargetsInput,
  Context,
  DefenseDraft,
  SkillHandle,
} from '../../sdk';
import {
  CardEvent,
  cardQueries,
  chooseOwnedCard,
  defineEvent,
  delayedCards,
  discardCards,
  equipment,
  modify,
  moveDelayed,
  ownedCards,
  takeCard,
  timing,
} from '../../sdk';

export const Weapon = defineEvent('weapon', {
  followUp: timing<
    unknown,
    {
      readonly actor: string;
      readonly name: string;
      readonly fromEffect: string;
      readonly use: string;
    }
  >(),
  damageReplaced: timing<
    unknown,
    {
      readonly actor: string;
      readonly name: string;
      readonly target: string;
      readonly effect: string;
    }
  >(),
});

/** 青龙刀与贯石斧共同的时机：自己的杀被闪抵消、尚未被突破且目标存活。 */
export function slashDefended(ctx: Context, draft: DefenseDraft, self: SkillHandle): boolean {
  return (
    !draft.broken &&
    draft.effect.card.name === 'standard:slash' &&
    draft.effect.actor === self.owner &&
    ctx.world.player(draft.effect.target).alive
  );
}

/** 坐骑：进攻马计算与他人距离 −1，防御马他人计算与你距离 +1；作为材料时不生效。 */
export function horse(id: string, label: string, defensive: boolean): CardDefinition {
  return equipment(
    id,
    label,
    defensive ? 'defensive-horse' : 'offensive-horse',
    defensive
      ? '防御坐骑。其他角色计算与你的距离时加 1。'
      : '进攻坐骑。你计算与其他角色的距离时减 1，至少为 1。',
    modify(cardQueries.distanceCorrection, (_ctx, { input: request, self }) => {
      if (self.origin && request.card?.materials.includes(self.origin.id)) return undefined;
      return (defensive ? request.to : request.from) === self.owner
        ? defensive
          ? 1
          : -1
        : undefined;
    }),
  );
}

export const otherLiving = (ctx: Context, { actor }: CardFixedTargetsInput) =>
  ctx.world.snapshot.players
    .filter((player) => player.alive && player.id !== actor)
    .map((player) => player.id);
export const allLiving = (ctx: Context) =>
  ctx.world.snapshot.players.filter((player) => player.alive).map((player) => player.id);

const areas = ['hand', 'equipment', 'judgment'];
export const hasCards = (ctx: Context, player: string) =>
  ownedCards(ctx.world, player, areas).length > 0 || delayedCards(ctx.world, player).length > 0;

/** 过河拆桥与顺手牵羊：选目标区域内一张牌，弃置或获得（判定区的延时牌整体移入手牌）。 */
export async function takeOrDiscard(
  ctx: Context,
  effect: CardEffect,
  take: boolean,
): Promise<void> {
  const { actor, target } = effect;
  const reason = effect.card.name;
  const chosen = await chooseOwnedCard(ctx, { actor, target, areas, reason, discard: !take });
  if (chosen.kind === 'unavailable') return;
  const card = chosen.kind === 'delayed' ? chosen.id : chosen.card;
  if (!take) await discardCards(ctx, { actor, owner: target, cards: [card], reason });
  else if (chosen.kind !== 'delayed')
    await takeCard(ctx, { actor, target, card, from: chosen.from, reason });
  else {
    const moved = await moveDelayed(ctx, chosen.id, `${actor}:hand`);
    if (moved.kind !== 'unavailable')
      ctx.commit(CardEvent.takenDelayed, [], {
        actor,
        target,
        card: chosen.card,
        cards: moved.cards,
      });
  }
}
