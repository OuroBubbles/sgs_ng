import { card, recover } from '../../../sdk';

export default card({
  id: 'standard:peach',
  type: 'basic',
  label: '桃',
  kind: 'peach',
  description: '出牌阶段回复自己 1 点体力；救援时可对濒死角色使用，使其回复 1 点体力。',
  use: {
    count: { min: 1, max: 1 },
    target: (ctx, { request, target }) =>
      (request.timing.kind === 'rescue'
        ? target === request.timing.dying
        : target === request.actor) && ctx.world.player(target).hp < ctx.world.player(target).maxHp,
    async resolve(ctx, { effect }) {
      if (ctx.world.player(effect.target).alive)
        await recover(ctx, {
          from: effect.actor,
          to: effect.target,
          amount: 1,
          card: effect,
        });
    },
  },
});
