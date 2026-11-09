import { attackRange, card, resolveAttack, withinDistance } from '../../../sdk';

export default card({
  id: 'standard:slash',
  type: 'basic',
  label: '杀',
  kind: 'slash',
  description:
    '出牌阶段限一次，对攻击范围内一名其他角色使用。其须使用闪抵消，否则受到你造成的 1 点伤害。',
  response: true,
  use: {
    count: { min: 1, max: 1 },
    usage: { key: 'slash', max: 1 },
    target: (ctx, { request, target }) =>
      target !== request.actor &&
      withinDistance(ctx, request, target, attackRange(ctx, request.actor, request.card)),
    resolve: (ctx, { effect }) =>
      resolveAttack(ctx, effect, { name: 'standard:jink', purpose: 'use' }),
  },
});
