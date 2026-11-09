import { card, withinDistance } from '../../../sdk';
import { hasCards, takeOrDiscard } from '../card-kit';

export default card({
  id: 'standard:snatch',
  type: 'trick',
  label: '顺手牵羊',
  description: '对距离为 1 的一名其他角色使用，获得其手牌、装备或判定区的一张牌。手牌只能暗选。',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (ctx, { request, target }) =>
      target !== request.actor && hasCards(ctx, target) && withinDistance(ctx, request, target, 1),
    canResolve: (ctx, { effect }) =>
      ctx.world.player(effect.actor).alive && hasCards(ctx, effect.target),
    resolve: (ctx, { effect }) => takeOrDiscard(ctx, effect, true),
  },
});
