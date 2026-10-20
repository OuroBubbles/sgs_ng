import type { Context } from '../../core/runtime/room';
import type { SkillHandle } from './skills';

/** 查询只组合贡献，不开窗、不提交；类型身份是对象，不依赖全局字符串登记。 */
export interface QueryType<Input, Value> {
  readonly id: string;
  readonly combine: (left: Value, right: Value) => Value;
  readonly input?: Input;
}

export function defineQuery<Input, Value>(
  id: string,
  combine: (left: Value, right: Value) => Value,
): QueryType<Input, Value> {
  if (!id) throw new Error('Query requires an ID.');
  return Object.freeze({ id, combine });
}

export interface SkillModifier {
  readonly query: object;
  contribution(ctx: Context, input: unknown, self: SkillHandle): unknown;
}

/** undefined 表示不贡献；null 可由查询自身定义为有意义的值，如不限次数。 */
export function modify<Input, Value>(
  query: QueryType<Input, Value>,
  contribution: (ctx: Context, input: Input, self: SkillHandle) => Value | undefined,
): SkillModifier {
  return Object.freeze({
    query,
    contribution: (ctx: Context, input: unknown, self: SkillHandle) =>
      contribution(ctx, input as Input, self),
  });
}
