import type { Context } from './room';
import type { WorldReader } from '../model/state';

/**
 * 事件的一个具名时点。同一个对象既是触发时机（ctx.window / on），也是历史记录的种类
 * （ctx.commit / history.facts）；id 统一由「事件.时点」推导。
 */
export interface Timing<T, R = T> {
  readonly id: string;
  readonly groups: readonly string[];
  /** 只参与类型推导：触发时的载荷（可为可修改草稿）。 */
  readonly payload?: T;
  /** 只参与类型推导：写入历史的记录形状（草稿的可序列化快照）；默认与载荷相同。 */
  readonly record?: R;
}

/** 时点声明：载荷类型与可选的结算分组（默认单组 main）。 */
export interface TimingSpec<T, R = T> {
  readonly groups: readonly string[];
  readonly payload?: T;
  readonly record?: R;
}
export function timing<T, R = T>(...groups: string[]): TimingSpec<T, R> {
  const fixed = groups.length ? [...groups] : ['main'];
  if (fixed.some((group) => !group) || new Set(fixed).size !== fixed.length)
    throw new Error('Timing requires distinct named groups.');
  return Object.freeze({ groups: Object.freeze(fixed) });
}

export type EventTimings<S> = {
  readonly [K in keyof S]: S[K] extends TimingSpec<infer T, infer R> ? Timing<T, R> : never;
};

/** 声明一个事件及其全部时点：defineEvent('damage', { received: timing<DamageResult>() }) → Damage.received。 */
export function defineEvent<const S extends Record<string, TimingSpec<unknown, unknown>>>(
  id: string,
  timings: S,
): EventTimings<S> {
  const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return Object.fromEntries(
    Object.entries(timings).map(([key, spec]) => [
      key,
      Object.freeze({ id: `${id}.${kebab(key)}`, groups: spec.groups }),
    ]),
  ) as EventTimings<S>;
}

/** 本窗口内的一次独立结算；index 从 1 开始，total 在该候选入队时固定。 */
export interface TriggerOccurrence {
  readonly id: string;
  readonly index: number;
  readonly total: number;
}

/** id 标识具体拥有者的效果实例；times 显式生成可与其他效果交错的有限次数。 */
export interface Trigger<T> {
  readonly id: string;
  readonly label?: string;
  readonly owner: string | null;
  readonly group?: string;
  readonly order?: 'automatic' | 'choose';
  readonly times?: (ctx: Context, payload: T) => number;
  readonly eligible: (ctx: Context, payload: T, occurrence: TriggerOccurrence) => boolean;
  /** 等待普通规则操作完整结束；返回值本身不参与窗口裁决。 */
  readonly run: (ctx: Context, payload: T, occurrence: TriggerOccurrence) => unknown;
}

/** 目录补充展示标签时，复制声明字段并保留原方法与接收者，不冻结作者对象。 */
export function labelTrigger<T>(trigger: Trigger<T>, label: string): Trigger<T> {
  const { id, owner, group, order, times, eligible, run } = trigger;
  return Object.freeze({
    id,
    label,
    owner,
    ...(group === undefined ? {} : { group }),
    ...(order === undefined ? {} : { order }),
    ...(times === undefined ? {} : { times: times.bind(trigger) }),
    eligible: eligible.bind(trigger),
    run: run.bind(trigger),
  });
}

export interface WindowOptions {
  /** 事件主体只提供模式没有默认起点时的回退，不覆盖模式政策。 */
  readonly subject?: string;
  /** 特殊规则显式覆盖起点；通常只声明 subject，交给模式决定行动序。 */
  readonly anchor?: string;
  /** 普通纯查询决定窗口是否继续；false 收束整个窗口，不回滚已执行效果。 */
  readonly active?: (ctx: Context) => boolean;
}

/** 模式提供纯查询；null 表示回退到调用方主体或首席。核心不认识回合规则。 */
export type ActionAnchor = (ctx: Context, subject: string | null) => string | null;

/** 开窗时从权威状态生成候选，核心不需要导入技能定义或内容包。 */
export interface TriggerSource {
  collect<T>(type: Timing<T, unknown>, world: WorldReader, payload: T): readonly Trigger<T>[];
}
