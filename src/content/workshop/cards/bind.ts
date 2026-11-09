import { card, isChained, setChained } from '../../../sdk';

/** 普通多目标锦囊；每个目标结算时读取当前状态，不在客户端维护连环列表。 */
export default card({
  id: 'workshop:bind',
  type: 'trick',
  label: '缚阵',
  description:
    '作者演示牌。选择一至两名角色，分别切换其连环状态。可选择自己；每个目标可被无懈可击。',
  counterable: true,
  use: {
    count: { min: 1, max: 2 },
    target: () => true,
    resolve: (ctx, { effect }) =>
      setChained(ctx, effect.target, !isChained(ctx.world, effect.target), effect.card.name),
  },
});
