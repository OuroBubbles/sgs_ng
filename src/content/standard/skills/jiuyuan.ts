import { kingdomOf, skill, on, Hp } from '../../../sdk';

export default skill(
  'standard:jiuyuan',
  '救援',
  '主公技，锁定技。其他吴势力角色对你使用桃时，额外回复 1 点体力；按当前势力判断，仍受体力上限限制。',
  on(Hp.recovering, {
    locked: true,
    who: (recovery) => recovery.input.to,
    when: (ctx, { input }, self) =>
      input.from !== null &&
      input.from !== self.owner &&
      kingdomOf(ctx.world, input.from) === '吴' &&
      input.card?.card.name === 'standard:peach',
    effect: (_ctx, recovery, self) => recovery.adjust(1, self.skill),
  }),
  { lord: true },
);
