import { card, chooseOne, draw, recover, wounded } from '../../../sdk';

/** 作者演示牌；复用标准锦囊与选择流程，无专用 UI 或内核分支。 */
export default card({
  id: 'workshop:prepare',
  type: 'trick',
  label: '整备',
  description:
    '作者演示牌。对自己使用，选择摸两张牌，或回复 1 点体力。未受伤时只能摸牌；可被无懈可击。',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => target === request.actor,
    async resolve(ctx, { effect }) {
      const answer = await ctx.ask(
        chooseOne({
          player: effect.target,
          prompt: '整备：选择一项',
          reason: 'workshop:prepare',
          options: [
            { id: 'draw', label: '摸两张牌' },
            ...(wounded(ctx, effect.target) ? [{ id: 'recover', label: '回复一点体力' }] : []),
          ],
        }),
      );
      if (answer.kind !== 'chosen') return ctx.abort('整备选择中止。');
      if (answer.value === 'recover')
        await recover(ctx, { from: effect.actor, to: effect.target, amount: 1, card: effect });
      else await draw(ctx, { player: effect.target, count: 2, reason: 'workshop:prepare' });
    },
  },
});
