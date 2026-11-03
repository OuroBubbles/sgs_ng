import type { Change, StateEntry, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { DeepReadonly } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { syncQueryValue } from '../../core/runtime/query';
import { assertLifetime } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';

export interface StateKey<T> {
  readonly id: string;
  readonly initial: DeepReadonly<T>;
  /** 同步纯校验；异步返回不能被当作 true，执行侧查询与只读投影沿用各自故障策略。 */
  readonly accepts: (input: unknown) => input is T;
}

export interface StateTarget {
  readonly owner: string | null;
  readonly source: string | null;
  readonly lifetime: Lifetime | null;
}

export function defineState<T>(
  id: string,
  initial: T,
  accepts: (input: unknown) => input is T,
): StateKey<T> {
  if (!id) throw new Error('Invalid state key or initial value.');
  const value = immutable(initial);
  if (!syncQueryValue(accepts(value), `${id}.accepts`))
    throw new Error('Invalid state key or initial value.');
  return Object.freeze({ id, initial: value, accepts });
}

function stateId<T>(key: StateKey<T>, target: StateTarget): string {
  return JSON.stringify([key.id, target.owner, target.source, target.lifetime?.id ?? null]);
}

export function readState<T>(
  world: WorldReader,
  key: StateKey<T>,
  target: StateTarget,
): DeepReadonly<T> {
  if (target.lifetime && !target.lifetime.belongsTo(world))
    throw new Error('Lifetime belongs to another World.');
  const id = stateId(key, target);
  const entry = world.state(id);
  if (!entry) return key.initial;
  if (!syncQueryValue(key.accepts(entry.value), `${key.id}.accepts`))
    throw new Error(`Stored state does not match its key: ${key.id}`);
  return entry.value as DeepReadonly<T>;
}

/** 可与费用/宣告的其他 Change 组成同一次提交，不在这里提前支付。 */
export function stateChange<T>(
  ctx: Context,
  key: StateKey<T>,
  target: StateTarget,
  value: T | DeepReadonly<T>,
): Extract<Change, { readonly kind: 'setState' }> {
  assertLifetime(ctx, target.lifetime);
  if (target.owner !== null) ctx.world.player(target.owner);
  // 校验将被保存的快照；复制中的 getter 同样受纯查询的止写约束。
  const snapshot = ctx.query(() => immutable(value));
  if (!ctx.query(() => key.accepts(snapshot))) throw new Error(`Invalid state value: ${key.id}`);
  const state: StateEntry = {
    id: stateId(key, target),
    key: key.id,
    owner: target.owner,
    source: target.source,
    scopeId: target.lifetime?.id ?? null,
    value: snapshot,
  };
  return { kind: 'setState', state };
}

export function setState<T>(
  ctx: Context,
  key: StateKey<T>,
  target: StateTarget,
  value: T | DeepReadonly<T>,
): void {
  ctx.commit('state.changed', [stateChange(ctx, key, target, value)], { key: key.id });
}

export const useCount = defineState(
  'core:use-count',
  0,
  (input): input is number =>
    typeof input === 'number' && Number.isSafeInteger(input) && input >= 0,
);
