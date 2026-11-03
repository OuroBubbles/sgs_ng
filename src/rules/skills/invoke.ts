import type { Context } from '../../core/runtime/room';
import { skillAvailable } from './skills';
import type { SkillHandle } from './skills';
import { pay } from '../costs/pay';
import { isGameOver } from '../game/end';

/** 只询问技能选择；资格由 available 表达，接受后的支付和继续条件由调用者编排。 */
export async function askInvoke(
  ctx: Context,
  self: Pick<SkillHandle, 'id' | 'owner' | 'skill'>,
  prompt: string,
  available?: (ctx: Context) => boolean,
): Promise<boolean> {
  const answer = await ctx.ask<boolean>({
    player: self.owner,
    kind: 'invoke',
    prompt,
    data: { instance: self.id, skill: self.skill },
    optional: false,
    ...(available === undefined ? {} : { available: () => available(ctx) }),
    validate: (input) =>
      typeof input === 'boolean'
        ? { ok: true, value: input }
        : { ok: false, reason: 'Choose whether to invoke.' },
  });
  return answer.kind === 'chosen' && answer.value;
}

/** 自愿发动经正式选择与零费用宣告；接受后来源消失不回滚已宣告的技能效果。 */
export function invoke(
  ctx: Context,
  self: SkillHandle,
  prompt: string,
  available: (ctx: Context) => boolean = () => true,
): Promise<boolean> {
  return ctx.flow('skill.invoke', async (child) => {
    const live = () =>
      child.query(
        () => !isGameOver(child.world) && skillAvailable(child, self) && available(child),
      );
    if (!(await askInvoke(child, self, prompt, live))) return false;
    const paid = await pay(child, {
      skill: self,
      reason: self.skill,
      factKind: 'skill.invoked',
      declaration: { label: self.name },
      legal: () => live(),
    });

    return paid.kind === 'paid';
  });
}
