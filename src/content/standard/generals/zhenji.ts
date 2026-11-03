import {
  alive,
  askInvoke,
  convert,
  general,
  isGameOver,
  judge,
  obtainJudgment,
  skill,
  trigger,
  Phase,
} from '../../../sdk';

export const luoshen = skill({
  id: 'standard:luoshen',
  name: '洛神',
  description:
    '准备阶段，你可以判定。若为黑色，你获得此判定牌，并可以继续判定，直到你停止或判定为非黑色。',
  triggers: [
    trigger(Phase.started, {
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
  ],
});

export const qingguo = skill({
  id: 'standard:qingguo',
  name: '倾国',
  description: '可以将一张黑色手牌当闪使用或打出。装备区的牌不能作为材料。',
  viewAs: [convert('black-jink', { as: 'standard:jink', match: (c) => c.color === 'black' })],
});

export default general({
  id: 'standard:zhenji',
  name: '甄姬',
  kingdom: '魏',
  gender: 'female',
  hp: 3,
  skills: [luoshen, qingguo],
});
