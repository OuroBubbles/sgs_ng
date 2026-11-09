import { card, damage } from '../../../sdk';

export default card({
  id: 'workshop:ember',
  type: 'trick',
  label: '引焰',
  description:
    '作者演示牌。对一名其他角色造成 1 点火焰伤害。若目标处于连环，其受到的伤害会依次传给当时的其他连环角色；每名角色受到伤害时解除连环。可被无懈可击。',
  counterable: true,
  nature: 'fire',
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => target !== request.actor,
    resolve: (ctx, { effect }) =>
      damage(ctx, {
        from: effect.actor,
        to: effect.target,
        amount: 1,
        nature: effect.card.nature,
        card: effect,
      }),
  },
});
