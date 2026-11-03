import { cardActivities, general, skill, on, Phase } from '../../../sdk';
import type { Context, PhaseView, SkillHandle } from '../../../sdk';

/** 包括转换、供牌和改判中的真实打出；按阶段与实际角色查询。 */
function usedSlashInPlay(ctx: Context, self: SkillHandle, phase: PhaseView): boolean {
  const turn = phase.turn;
  return (
    !!turn &&
    cardActivities(ctx.history.facts(), turn.id).some(
      (a) =>
        a.actor === self.owner &&
        a.card.name === 'standard:slash' &&
        a.turnId === turn.id &&
        a.phase?.owner === self.owner &&
        a.phase.kind === 'play',
    )
  );
}
const skippable = (ctx: Context, phase: PhaseView, self: SkillHandle) =>
  !phase.skipped && !phase.turn?.ended && !usedSlashInPlay(ctx, self, phase);

export const keji = skill({
  id: 'standard:keji',
  name: '克己',
  description:
    '弃牌阶段开始前，若你在本回合的出牌阶段没有使用或打出过杀，你可以跳过此弃牌阶段。包括转换、供牌和改判中的真实打出；按阶段与实际角色查询。',
  triggers: [
    on(Phase.before, {
      who: (phase) => phase.owner,
      when: (ctx, phase, self) => phase.kind === 'discard' && skippable(ctx, phase, self),
      ask: '是否发动【克己】跳过弃牌阶段？',
      keep: (ctx, phase, self) => skippable(ctx, phase, self),
      declare: (ctx, phase, self) => ({ changes: [phase.skipChange(ctx, self.skill)] }),
    }),
  ],
});

export default general('standard:lvmeng', '吕蒙', '吴', 4, [keji]);
