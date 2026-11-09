import { alive, askDiscard, cardDef, on, skill, Target } from '../../../sdk';

/** 锁定技：被杀指定后由使用者弃基本牌“付费”，否则此杀对刘禅无效（取消对他的这一效果）。 */
export default skill(
  'standard:xiangle',
  '享乐',
  '锁定技，当你成为杀的目标后，你令使用者选择：1.弃置一张基本牌；2.此杀对你无效。',
  on(Target.confirmed, {
    locked: true,
    who: ({ effect }) => effect.target,
    when: (_ctx, { effect }) =>
      effect.state === 'targeting' && effect.card.name === 'standard:slash',
    async effect(ctx, { effect }, self) {
      const paid =
        alive(ctx, effect.actor) &&
        (await askDiscard(ctx, effect.actor, {
          count: 1,
          prompt: `享乐：弃置一张基本牌，否则此杀对 ${self.owner} 无效`,
          reason: self.skill,
          filter: (at, card) => cardDef(at, card.name).type === 'basic',
          cancel: '令此杀无效',
        }));
      if (!paid) effect.cancel(ctx, self.skill);
    },
  }),
);
