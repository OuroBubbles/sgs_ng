import { alive, isGameOver, judge, skill, on, Target } from '../../../sdk';

export default skill(
  'standard:tieqi',
  '铁骑',
  '当你指定杀的目标后，可以判定。若结果为红色，该角色不能以闪响应这次杀，八卦阵和护驾供闪也不能绕过。',
  on(Target.specified, {
    who: ({ effect }) => effect.actor,
    when: (_ctx, { effect }) =>
      effect.card.name === 'standard:slash' && effect.state === 'targeting',
    ask: '是否发动【铁骑】进行判定？',
    keep: (ctx, { effect }) => effect.state === 'targeting' && alive(ctx, effect.target),
    async effect(ctx, { effect }, self) {
      const result = await judge(ctx, {
        player: self.owner,
        reason: self.skill,
        match: (_at, card) => card.color === 'red',
      });
      if (
        result.matched &&
        effect.state === 'targeting' &&
        alive(ctx, effect.target) &&
        !isGameOver(ctx.world)
      )
        effect.blockResponses(ctx, effect.target, self.skill, ['standard:jink']);
    },
  }),
);
