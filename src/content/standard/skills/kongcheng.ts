import { cardQueries, modify, skill } from '../../../sdk';

export default skill(
  'standard:kongcheng',
  '空城',
  '锁定技，若你没有手牌，你不能成为杀或决斗的目标。装备不影响空城。',
  modify(cardQueries.prohibitTarget, (ctx, { input, self }) =>
    input.target === self.owner &&
    ctx.world.zone(`${self.owner}:hand`).cards.length === 0 &&
    ['standard:slash', 'standard:duel'].includes(input.card.name)
      ? true
      : undefined,
  ),
);
