import type { Context, FlowResult } from '../../core/runtime/room';
import { skillAvailable } from './skills';
import type { SkillHandle } from './skills';
import { pay } from '../costs/pay';
import { isGameOver } from '../game/end';

/** 自愿发动经正式选择与零费用宣告；接受后来源消失不回滚已宣告的技能效果。 */
export function invoke(
  ctx: Context,
  self: SkillHandle,
  prompt: string,
  available: (ctx: Context) => boolean = () => true,
): Promise<FlowResult<boolean>> {
  return ctx.flow('skill.invoke', async (child) => {
    const live = () =>
      child.query(
        () => !isGameOver(child.world) && skillAvailable(child, self) && available(child),
      );
    const answer = await child.ask<boolean>({
      player: self.owner,
      kind: 'invoke',
      prompt,
      data: { instance: self.id, skill: self.skill },
      optional: false,
      available: live,
      validate: (input) =>
        typeof input === 'boolean'
          ? { ok: true, value: input }
          : { ok: false, reason: 'Choose whether to invoke.' },
    });
    if (answer.kind !== 'chosen' || !answer.value) return false;
    const paid = await pay(child, {
      actor: self.owner,
      skill: self,
      cards: [],
      to: 'discard',
      reason: self.skill,
      factKind: 'skill.invoked',
      declaration: { label: self.name },
      legal: () => live(),
    });
    if (paid.kind === 'aborted') return child.abort(paid.reason);
    return paid.value.kind === 'paid';
  });
}
