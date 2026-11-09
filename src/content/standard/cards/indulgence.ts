import { delayedCard, isGameOver, judge } from '../../../sdk';

export default delayedCard({
  id: 'standard:indulgence',
  label: '乐不思蜀',
  description:
    '放入一名其他角色的判定区。其判定阶段进行判定，若不为红桃，跳过本回合下一个出牌阶段；生效时可被无懈。',
  async resolve(ctx, { effect, phase }) {
    const result = await judge(ctx, {
      player: effect.target,
      reason: effect.card.name,
      match: (_ctx, card) => card.suit === 'heart',
    });

    if (
      result.kind === 'judged' &&
      result.matched === false &&
      !isGameOver(ctx.world) &&
      ctx.world.player(effect.target).alive
    )
      phase.turn?.skipNext(ctx, 'play', 'standard:indulgence');
  },
});
