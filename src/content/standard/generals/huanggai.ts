import { action, draw, general, loseHp, skill } from '../../../sdk';

export const kurou = skill({
  id: 'standard:kurou',
  name: '苦肉',
  description:
    '出牌阶段，你可以失去 1 点体力，然后摸两张牌。不限次数；濒死时先完成救援，存活才摸牌。',
  active: [
    action({
      id: 'lose-hp-draw',
      async effect(ctx, { self }) {
        await loseHp(ctx, { player: self.owner, amount: 1, reason: self.skill });
        await draw(ctx, { player: self.owner, count: 2, reason: self.skill });
      },
    }),
  ],
  ai: { value: ({ self, hand }) => (self.hp > 2 && hand.length < 6 ? 15 : -1) },
});

export default general({
  id: 'standard:huanggai',
  name: '黄盖',
  kingdom: '吴',
  hp: 4,
  skills: [kurou],
});
