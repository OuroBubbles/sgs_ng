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

/** 内容回调按需读取查询数据和技能来源；modify 负责适配底层贡献协议。 */
export interface ModifyInput<Input> {
  readonly input: Input;
  readonly self: SkillHandle;
}

/** undefined 表示不贡献；null 可由查询自身定义为有意义的值，如不限次数。 */
export function modify<Input, Value>(
  query: QueryType<Input, Value>,
  contribution: (ctx: Context, input: ModifyInput<Input>) => Value | undefined,
): SkillModifier {
  return Object.freeze({
    query,
    contribution: (ctx: Context, input: unknown, self: SkillHandle) =>
      contribution(ctx, { input: input as Input, self }),
  });
}
