import { action, defineMark, recover, skill } from '../../../sdk';

/** 本阶段以仁德给出的手牌数；阶段结束自动清除。 */
const given = defineMark('standard:rende-given', 0, { scope: 'phase' });

export default skill(
  'standard:rende',
  '仁德',
  '出牌阶段，你可以将至少一张手牌交给一名其他角色，可以多次分配。本阶段以此法给出的手牌首次累计达到两张后，你回复 1 点体力。交牌不是弃牌。',
  action({
    id: 'give',
    cards: { count: [1, 'all'] },
    targets: { count: 1, filter: (_ctx, id, { self }) => id !== self.owner },
    pay: 'give',
    // 累计与交牌同次提交；后效中的失去/重新获得技能不能重置本阶段累计。
    declare: (ctx, { self, cards }) => ({
      data: { count: cards.length },
      changes: [given.change(ctx, self.owner, given.of(ctx, self.owner) + cards.length)],
    }),
    async effect(ctx, { self, cards }) {
      const after = given.of(ctx, self.owner);
      if (after - cards.length < 2 && after >= 2)
        await recover(ctx, { from: self.owner, to: self.owner, amount: 1 });
    },
  }),
  {
    ai: {
      value: ({ self, hand, players, hostility }) =>
        self.hp < self.maxHp &&
        hand.length >= Math.max(2, self.hp + 1) &&
        players.some((p) => p.id !== self.id && p.alive && hostility(p.id) < 0)
          ? 18
          : -1,
    },
  },
);
