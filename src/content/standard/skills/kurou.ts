import { action, draw, loseHp, skill } from '../../../sdk';

export default skill(
  'standard:kurou',
  '苦肉',
  '出牌阶段，你可以失去 1 点体力，然后摸两张牌。不限次数；濒死时先完成救援，存活才摸牌。',
  action({
    id: 'lose-hp-draw',
    async effect(ctx, { self }) {
      await loseHp(ctx, { player: self.owner, amount: 1, reason: self.skill });
      await draw(ctx, { player: self.owner, count: 2, reason: self.skill });
    },
  }),
);
