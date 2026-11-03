import { draw, invoke, isGameOver, on, pay, rulesOf, Damage, Skill } from '../../sdk';
import type { SkillDefinition } from '../../sdk';

export const echo = {
  id: 'workshop:echo',
  name: '余响',
  description: '受到一次伤害后，你可以摸一张牌。每次伤害一次，不按伤害点数重复。',
  triggers: [
    on(Damage.received, {
      when: (_ctx, hit, self) => hit.input.to === self.owner,
      async effect(ctx, _event, self) {
        const accepted = await invoke(ctx, self, '是否发动【余响】摸一张牌？');
        if (accepted) await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
      },
    }),
  ],
} satisfies SkillDefinition;

/** 普通学习技能：授予是 World 事实；新技能从下一次时点开始参与收集。 */
export const insight = {
  id: 'workshop:insight',
  name: '拾慧',
  description: '锁定技。受到伤害后，若你没有余响，获得余响（自下一次受到伤害起生效）。',
  triggers: [
    on(Damage.received, {
      locked: true,
      when: (ctx, hit, self) =>
        hit.input.to === self.owner &&
        !ctx.world.snapshot.skills.some(
          (skill) => skill.owner === self.owner && skill.skill === echo.id,
        ),
      async effect(ctx, _event, self) {
        const paid = await pay(ctx, {
          skill: self,
          reason: self.skill,
          factKind: Skill.invoked,
          declaration: { label: self.name },
        });
        if (paid.kind !== 'paid' || !ctx.world.player(self.owner).alive || isGameOver(ctx.world))
          return;
        await rulesOf(ctx).skills.grant(ctx, {
          owner: self.owner,
          skill: echo.id,
          source: { kind: 'effect', id: self.skill },
        });
      },
    }),
  ],
} satisfies SkillDefinition;
