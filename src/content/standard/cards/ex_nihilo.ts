import { card, draw } from '../../../sdk';

export default card({
  id: 'standard:ex_nihilo',
  type: 'trick',
  label: '无中生有',
  kind: 'draw',
  description: '出牌阶段对自己使用，摸两张牌。',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => request.actor === target,
    resolve: (ctx, { effect }) =>
      draw(ctx, { player: effect.target, count: 2, reason: 'standard:ex_nihilo' }),
  },
});
