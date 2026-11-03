import type { Change, Zone } from '../../core/model/state';
import type { Context } from '../../core/runtime/room';
import type { SkillHandle } from './skills';
import { pay, payDiscard } from '../costs/pay';
import type { UsageLimit } from '../costs/pay';
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

/** 技能宣告：一次提交「发动了某技能」及其代价、次数与同次规则变更。 */
export interface Declaration {
  /** 附加到宣告记录（label 之外）的公开数据，如 targets。 */
  readonly data?: Readonly<Record<string, unknown>>;
  /** 宣告提交前的最终重查；默认只要求技能仍可用且未终局。 */
  readonly legal?: (ctx: Context) => boolean;
  readonly changes?: readonly Change[];
  readonly limit?: UsageLimit;
  /** 作为代价弃置的牌。 */
  readonly discard?: readonly string[];
  /** 作为代价交出的牌及其去向区域。 */
  readonly give?: { readonly cards: readonly string[]; readonly to: string };
  /** 代价牌允许来自的区域，默认手牌与装备。 */
  readonly areas?: readonly Zone['kind'][];
}

/** 写入 skill.invoked：发动、代价与变更同次提交；返回是否成功宣告。 */
export async function declare(
  ctx: Context,
  self: SkillHandle,
  declaration: Declaration = {},
): Promise<boolean> {
  const { data, legal, changes, limit, discard, give, areas } = declaration;
  const spec = {
    skill: self,
    reason: self.skill,
    factKind: 'skill.invoked',
    declaration: { label: self.name, ...data },
    ...(legal ? { legal } : {}),
    ...(changes ? { changes } : {}),
    ...(limit ? { limit } : {}),
    ...(areas ? { areas } : {}),
  };
  const paid = discard
    ? await payDiscard(ctx, { ...spec, cards: discard })
    : give
      ? await pay(ctx, { ...spec, cards: give.cards, to: give.to })
      : await pay(ctx, spec);
  return paid.kind === 'paid';
}

/** 自愿发动：询问是否发动，再宣告；接受后来源消失不回滚已宣告的技能效果。 */
export function invoke(
  ctx: Context,
  self: SkillHandle,
  prompt: string,
  available: (ctx: Context) => boolean = () => true,
  declaration?: (ctx: Context) => Declaration | Promise<Declaration>,
): Promise<boolean> {
  return ctx.flow('skill.invoke', async (child) => {
    const live = () =>
      child.query(() => !isGameOver(child.world) && self.active(child) && available(child));
    if (!(await askInvoke(child, self, prompt, live))) return false;
    const extra = (await declaration?.(child)) ?? {};
    return declare(child, self, {
      ...extra,
      legal: () => live() && (extra.legal?.(child) ?? true),
    });
  });
}
