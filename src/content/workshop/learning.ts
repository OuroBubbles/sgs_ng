import { damageReceived, draw, invoke, isGameOver, on, pay, rulesOf } from '../../sdk';
import type { SkillDefinition } from '../../sdk';

export const echo = {
  id: 'workshop:echo',
  name: '余响',
  description: '受到一次伤害后，你可以摸一张牌。每次伤害一次，不按伤害点数重复。',
  triggers: [
    on(damageReceived, {
      order: 'choose',
      when: (_ctx, { payload: hit, self }) => hit.input.to === self.owner,
      async run(ctx, { self }) {
        const accepted = await invoke(ctx, self, '是否发动【余响】摸一张牌？');
        if (accepted) await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
      },
    }),
  ],
} satisfies SkillDefinition;

/** 普通学习技能：授予是 World 事实，是否处理当前时点则由作者显式决定。 */
export const insight = {
  id: 'workshop:insight',
  name: '拾慧',
  description:
    '锁定技。受到伤害后，若你没有余响，获得余响，并将新实例加入本次受伤时点。仍可选择是否发动余响。',
  triggers: [
    on(damageReceived, {
      when: (ctx, { payload: hit, self }) =>
        hit.input.to === self.owner &&
        !ctx.world.snapshot.skills.some(
          (skill) => skill.owner === self.owner && skill.skill === echo.id,
        ),
      async run(ctx, { self }) {
        const window = ctx.windowOf(damageReceived);
        if (!window) throw new Error('Insight requires its damage window.');
        const paid = await pay(ctx, {
          skill: self,
          reason: self.skill,
          factKind: 'skill.invoked',
          declaration: { label: self.name },
        });
        if (paid.kind !== 'paid' || !ctx.world.player(self.owner).alive || isGameOver(ctx.world))
          return;
        const change = await rulesOf(ctx).skills.grant(ctx, {
          owner: self.owner,
          skill: echo.id,
          source: { kind: 'effect', id: self.skill },
        });
        if (change.after) rulesOf(ctx).skills.include(ctx, window, [change.after.id]);
      },
    }),
  ],
} satisfies SkillDefinition;
