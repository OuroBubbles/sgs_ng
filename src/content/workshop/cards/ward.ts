import { card, changeShield } from '../../../sdk';

export default card({
  id: 'workshop:ward',
  type: 'trick',
  label: '凝障',
  description:
    '作者演示牌。对自己使用，获得 2 点护盾。伤害先消耗护盾，余量才扣体力；完全吸收仍属于受到伤害，不阻断连环。失去体力不消耗护盾。可被无懈可击。',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => target === request.actor,
    resolve: (ctx, { effect }) =>
      changeShield(ctx, { player: effect.target, amount: 2, reason: 'workshop:ward' }),
  },
});
