import type { Change, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { DeepReadonly } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { assertLifetime, lifetimeOf } from '../scopes/lifetime';
import type { Lifetime, Scope } from '../scopes/lifetime';
import { defineEvent, timing } from '../../core/runtime/event';

/**
 * 标记：类型化的局内状态，挂在角色（owner）或全局（null）上，按作用域自动到期。
 * - 0 是计数（非负整数），false 是标志，其余形状直接存放冻结后的普通数据；
 * - scope 'phase' / 'turn' / 'round' 写入时取 ctx 所在的当前阶段/回合/轮，结束即清除；'game' 不到期；
 * - source 区分同一标记的多个命名空间（如各技能各自的次数），省略即共用。
 */
export const MarkEvent = defineEvent('mark', {
  changed: timing<unknown>(),
});

export interface MarkSlot {
  readonly source?: string | null;
  /** 显式指定生存期，覆盖按 scope 解析的当前阶段/回合/轮。 */
  readonly lifetime?: Lifetime | null;
}

export interface Mark<T> {
  readonly id: string;
  readonly initial: DeepReadonly<T>;
  readonly scope: Scope;
  /** 读取；未设置或作用域外为 initial。game 标记或显式 lifetime 只需 World。 */
  of(at: Context | WorldReader, owner?: string | null, slot?: MarkSlot): DeepReadonly<T>;
  /** 绝对值 Change，可与费用、伤害等同次提交。 */
  change(
    ctx: Context,
    owner: string | null,
    value: T | DeepReadonly<T>,
    slot?: MarkSlot,
  ): Extract<Change, { readonly kind: 'setState' }>;
  /** 单独提交一次 MarkEvent.changed。 */
  set(ctx: Context, owner: string | null, value: T | DeepReadonly<T>, slot?: MarkSlot): void;
  /** 计数加减（结果不低于 0）。 */
  add(
    this: Mark<number>,
    ctx: Context,
    owner: string | null,
    amount?: number,
    slot?: MarkSlot,
  ): number;
}

export interface MarkSpec<T> {
  readonly scope?: Scope;
  /** 需要更严格的形状时给出；默认计数为非负整数、标志为布尔，其余接受任意普通数据。 */
  readonly accepts?: (input: unknown) => input is T;
}

const counter = (input: unknown): input is number =>
  Number.isSafeInteger(input) && Number(input) >= 0;
const flag = (input: unknown): input is boolean => typeof input === 'boolean';
const any = (input: unknown): input is never => {
  void input;
  return true;
};

export function defineMark(id: string, initial: number, spec?: MarkSpec<number>): Mark<number>;
export function defineMark(id: string, initial: boolean, spec?: MarkSpec<boolean>): Mark<boolean>;
export function defineMark<T>(id: string, initial: T, spec?: MarkSpec<T>): Mark<T>;
export function defineMark<T>(id: string, initial: T, spec: MarkSpec<T> = {}): Mark<T> {
  const scope = spec.scope ?? 'game';
  const accepts = (spec.accepts ??
    (typeof initial === 'number' ? counter : typeof initial === 'boolean' ? flag : any)) as (
    input: unknown,
  ) => input is T;
  const value = immutable(initial);
  if (!id || !accepts(value)) throw new Error('Invalid mark ID or initial value.');
  const isContext = (at: Context | WorldReader): at is Context => 'cause' in at;
  const lifetime = (at: Context | WorldReader, slot: MarkSlot): Lifetime | null => {
    if (slot.lifetime !== undefined || scope === 'game') return slot.lifetime ?? null;
    if (!isContext(at)) throw new Error(`Scoped mark needs a context: ${id}`);
    return lifetimeOf(at, scope);
  };
  const entryId = (owner: string | null, slot: MarkSlot, life: Lifetime | null) =>
    JSON.stringify([id, owner, slot.source ?? null, life?.id ?? null]);
  const mark: Mark<T> = Object.freeze({
    id,
    initial: value,
    scope,
    of(at: Context | WorldReader, owner: string | null = null, slot: MarkSlot = {}) {
      const world = isContext(at) ? at.world : at;
      const life = lifetime(at, slot);
      if (life && !life.belongsTo(world)) throw new Error('Lifetime belongs to another World.');
      if (!life && scope !== 'game' && slot.lifetime === undefined) return value;
      const entry = world.state(entryId(owner, slot, life));
      if (!entry) return value;
      if (!accepts(entry.value)) throw new Error(`Stored state does not match its key: ${id}`);
      return entry.value as DeepReadonly<T>;
    },
    change(ctx: Context, owner: string | null, next: T | DeepReadonly<T>, slot: MarkSlot = {}) {
      const life = lifetime(ctx, slot);
      if (!life && scope !== 'game' && slot.lifetime === undefined)
        throw new Error(`No active ${scope} for mark: ${id}`);
      assertLifetime(ctx, life);
      if (owner !== null) ctx.world.player(owner);
      // 校验将被保存的快照；复制中的 getter 同样受纯查询的止写约束。
      const snapshot = ctx.query(() => immutable(next));
      if (!ctx.query(() => accepts(snapshot))) throw new Error(`Invalid state value: ${id}`);
      return {
        kind: 'setState' as const,
        state: {
          id: entryId(owner, slot, life),
          key: id,
          owner,
          source: slot.source ?? null,
          scopeId: life?.id ?? null,
          value: snapshot,
        },
      };
    },
    set(ctx: Context, owner: string | null, next: T | DeepReadonly<T>, slot: MarkSlot = {}) {
      ctx.commit(MarkEvent.changed, [mark.change(ctx, owner, next, slot)], { key: id });
    },
    add(this: Mark<number>, ctx: Context, owner: string | null, amount = 1, slot: MarkSlot = {}) {
      const next = Math.max(0, this.of(ctx, owner, slot) + amount);
      this.set(ctx, owner, next, slot);
      return next;
    },
  });
  return mark;
}
