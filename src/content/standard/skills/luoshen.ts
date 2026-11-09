import {
  alive,
  askInvoke,
  isGameOver,
  judge,
  obtainJudgment,
  skill,
  on,
  Phase,
} from '../../../sdk';

export default skill(
  'standard:luoshen',
  '洛神',
  '准备阶段，你可以判定。若为黑色，你获得此判定牌，并可以继续判定，直到你停止或判定为非黑色。',
  on(Phase.started, {
    who: (phase) => phase.owner,
    when: (_ctx, phase) => phase.kind === 'prepare',
    ask: '是否发动【洛神】进行判定？',
    async effect(ctx, _phase, self) {
      const live = () => alive(ctx, self.owner) && !isGameOver(ctx.world);
      while (live()) {
        const result = await judge(ctx, {
          player: self.owner,
          reason: self.skill,
          match: (_at, card) => card.color === 'black',
          onResult: (at, judgment) =>
            judgment.matched && obtainJudgment(at, self.owner, judgment, self.skill),
        });
        if (!result.matched || !(await askInvoke(ctx, self, '是否继续【洛神】？', live))) return;
      }
    },
  }),
);
