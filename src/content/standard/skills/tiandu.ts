import { obtainJudgment, skill, on, Judgment } from '../../../sdk';

export default skill(
  'standard:tiandu',
  '天妒',
  '你的判定结束后，你可以获得仍在处理区中的判定牌。',
  on(Judgment.finished, {
    who: (judgment) => judgment.player,
    when: (ctx, judgment) =>
      judgment.card !== null && ctx.world.position(judgment.card.id) === judgment.processing,
    ask: '是否发动【天妒】获得此判定牌？',
    keep: (ctx, judgment) => ctx.world.position(judgment.card!.id) === judgment.processing,
    effect: (ctx, judgment, self) => obtainJudgment(ctx, self.owner, judgment, self.skill),
  }),
);
