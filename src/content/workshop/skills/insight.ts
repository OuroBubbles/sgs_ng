import { alive, declare, isGameOver, on, rulesOf, skill, Damage } from '../../../sdk';
import echo from './echo';

/** 普通学习技能：授予是 World 事实；新技能从下一次时点开始参与收集。 */
export default skill(
  'workshop:insight',
  '拾慧',
  '锁定技。受到伤害后，若你没有余响，获得余响（自下一次受到伤害起生效）。',
  on(Damage.received, {
    locked: true,
    when: (ctx, hit, self) =>
      hit.input.to === self.owner &&
      !ctx.world.snapshot.skills.some(
        (granted) => granted.owner === self.owner && granted.skill === echo.id,
      ),
    async effect(ctx, _event, self) {
      if (!(await declare(ctx, self)) || !alive(ctx, self.owner) || isGameOver(ctx.world)) return;
      await rulesOf(ctx).grant(ctx, {
        owner: self.owner,
        skill: echo.id,
        source: { kind: 'effect', id: self.skill },
      });
    },
  }),
);
