import { equipment, ownedCards } from '../../../sdk';

export default equipment(
  'standard:spear',
  '丈八蛇矛',
  { weapon: 3 },
  '武器，攻击范围 3。你可将两张手牌当杀使用或打出。',
  {
    id: 'two-cards-slash',
    count: { min: 2, max: 2 },
    materials: (ctx, { self }) => ownedCards(ctx.world, self.owner),
    // 多材料的花色/点数为空，颜色独立按材料推导；作者只需指定名称。
    make: { name: 'standard:slash' },
  },
);
