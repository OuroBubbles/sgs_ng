import { card } from '../../../sdk';
import { hasCards, takeOrDiscard } from '../card-kit';

export default card({
  id: 'standard:dismantlement',
  type: 'trick',
  label: '过河拆桥',
  description: '对一名有牌的其他角色使用，弃置其手牌、装备或判定区的一张牌。手牌只能暗选。',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (ctx, { request, target }) => target !== request.actor && hasCards(ctx, target),
    canResolve: (ctx, { effect }) =>
      ctx.world.player(effect.actor).alive && hasCards(ctx, effect.target),
    resolve: (ctx, { effect }) => takeOrDiscard(ctx, effect, false),
  },
});
