import {
  cardQueries,
  cardsMoved,
  draw,
  general,
  modify,
  ownedCards,
  skill,
  trigger,
} from '../../../sdk';
import type { Context, MoveResult } from '../../../sdk';

export const qianxun = skill({
  id: 'standard:qianxun',
  name: '谦逊',
  description: '锁定技，你不能成为顺手牵羊或乐不思蜀的目标。',
  modifiers: [
    modify(cardQueries.prohibitTarget, (_ctx, { input, self }) =>
      input.target === self.owner &&
      ['standard:snatch', 'standard:indulgence'].includes(input.card.name)
        ? true
        : undefined,
    ),
  ],
});

/** 一批移出多张手牌只算一次；需此前有手牌、此后手牌为空。 */
function emptiedHand(moved: MoveResult, owner: string): boolean {
  const hands = (zones: MoveResult['before']) =>
    zones.filter((z) => z.kind === 'hand' && z.owner === owner);
  return (
    hands(moved.before).some(
      (z) => z.cards.length > 0 && moved.moves.some((m) => m.from === z.id && m.cards.length > 0),
    ) && hands(moved.after).every((z) => z.cards.length === 0)
  );
}
const emptyHanded = (ctx: Context, owner: string) => ownedCards(ctx.world, owner).length === 0;

export const lianying = skill({
  id: 'standard:lianying',
  name: '连营',
  description:
    '失去最后的手牌后，你可以摸一张牌。一批移出多张手牌只产生一次机会；重新获得手牌再失去时是新的机会。',
  triggers: [
    trigger(cardsMoved, {
      when: (ctx, moved, self) => emptiedHand(moved, self.owner) && emptyHanded(ctx, self.owner),
      ask: '是否发动【连营】摸一张牌？',
      keep: (ctx, _moved, self) => emptyHanded(ctx, self.owner),
      effect: (ctx, _moved, self) =>
        draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
    }),
  ],
});

export default general({
  id: 'standard:luxun',
  name: '陆逊',
  kingdom: '吴',
  hp: 3,
  skills: [qianxun, lianying],
});
