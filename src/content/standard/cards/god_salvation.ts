import { card, recover } from '../../../sdk';
import { allLiving } from '../card-kit';

export default card({
  id: 'standard:god_salvation',
  type: 'trick',
  label: '桃园结义',
  description: '对所有角色使用，各目标回复 1 点体力。未受伤者跳过效果。',
  counterable: true,
  use: {
    count: { min: 0, max: 0 },
    fixedTargets: allLiving,
    target: () => true,
    canResolve: (ctx, { effect }) =>
      ctx.world.player(effect.target).hp < ctx.world.player(effect.target).maxHp,
    resolve: (ctx, { effect }) =>
      recover(ctx, { from: effect.actor, to: effect.target, amount: 1, card: effect }),
  },
});
