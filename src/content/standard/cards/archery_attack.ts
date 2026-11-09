import { card, resolveAttack } from '../../../sdk';
import { otherLiving } from '../card-kit';

export default card({
  id: 'standard:archery_attack',
  type: 'trick',
  label: '万箭齐发',
  description: '对所有其他角色使用，各目标须打出闪，否则受到你造成的 1 点伤害。',
  counterable: true,
  use: {
    count: { min: 0, max: 0 },
    fixedTargets: otherLiving,
    target: (_ctx, { request, target }) => target !== request.actor,
    resolve: (ctx, { effect }) =>
      resolveAttack(ctx, effect, { name: 'standard:jink', purpose: 'response' }),
  },
});
