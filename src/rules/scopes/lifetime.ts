import type { Change, SkillInstance, StateEntry, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineEvent, timing } from '../../core/runtime/event';

/** 标记与次数的命名作用域；game 即整局（不随生存期到期）。 */
export type Scope = 'phase' | 'turn' | 'round' | 'game';

/** 只有显式领域 lifetime 才管理状态/授予到期，普通子 Flow 不自动冒充阶段或回合。 */
export interface Lifetime {
  readonly id: string;
  readonly kind: string;
  /** 命名作用域：标记与次数限制按它找到“当前阶段/回合/轮”。 */
  readonly scope: Scope | null;
  readonly active: boolean;
  belongsTo(world: WorldReader): boolean;
}

export interface LifetimeEnd {
  readonly id: string;
  readonly kind: string;
  readonly exit: 'resolved' | 'aborted';
  readonly states: readonly string[];
  readonly statesBefore: readonly StateEntry[];
  readonly skillsBefore: readonly SkillInstance[];
}

/** 推演副本接续另一生存期的作用域状态（见 withLifetime 的 adopt）。 */
export interface LifetimeAdoption {
  readonly id: string;
  readonly from: string;
}

export const Lifetime = defineEvent('lifetime', {
  ended: timing<LifetimeEnd>(),
  adopted: timing<LifetimeAdoption>(),
});

/** 作用域状态的条目 ID：同一键、持有者、来源与生存期共用一条。 */
export function stateEntryId(
  key: string,
  owner: string | null,
  source: string | null,
  lifetime: string | null,
): string {
  return JSON.stringify([key, owner, source, lifetime]);
}

export function assertLifetime(ctx: Context, lifetime: Lifetime | null): void {
  ctx.assertActive();
  if (
    lifetime &&
    (!lifetime.active ||
      !lifetime.belongsTo(ctx.world) ||
      !ctx.cause.scopePath.includes(lifetime.id))
  )
    throw new Error('Lifetime is closed or outside the current context.');
}

/** 各阶段（含 'phase' 本身）、回合与轮的生存期即对应的命名作用域；其余（结算、处理区等）不是。 */
const scopeOf: Readonly<Record<string, Exclude<Scope, 'game'>>> = {
  ...Object.fromEntries(
    ['phase', 'prepare', 'judge', 'draw', 'play', 'discard', 'finish'].map((kind) => [
      kind,
      'phase',
    ]),
  ),
  turn: 'turn',
  round: 'round',
};
const open = new WeakMap<WorldReader, Map<string, Lifetime>>();

/** 此刻仍开着的最内层命名作用域（轮/回合/阶段）的 ID；只读 World，供推演副本接续。 */
export function openLifetime(world: WorldReader, scope: Exclude<Scope, 'game'>): string | null {
  let found: string | null = null;
  for (const lifetime of open.get(world)?.values() ?? [])
    if (lifetime.scope === scope && lifetime.active) found = lifetime.id;
  return found;
}

/** ctx 所在的最内层、仍存活的命名作用域；game 与不在其中时为 null。 */
export function lifetimeOf(ctx: Context, scope: Scope): Lifetime | null {
  const lifetimes = open.get(ctx.world);
  const path = ctx.cause.scopePath;
  for (let i = path.length - 1; i >= 0 && lifetimes; i--) {
    const lifetime = lifetimes.get(path[i]!);
    if (lifetime?.scope === scope && lifetime.active) return lifetime;
  }
  return null;
}

/**
 * adopt：从另一 World 复制来的局面里，仍挂在旧生存期（如原局当前回合）上的标记与授予
 * 改挂到这个新生存期，使推演副本能从“回合/阶段进行中”接着结算。普通规则不传。
 */
export async function withLifetime<T>(
  ctx: Context,
  kind: string,
  body: (ctx: Context, lifetime: Lifetime) => T | Promise<T>,
  adopt?: string | null,
): Promise<T> {
  const scope = scopeOf[kind] ?? null;
  return ctx.flow(`lifetime:${kind}`, async (owner) => {
    let active = true;
    const lifetime: Lifetime = Object.freeze({
      id: owner.scope.id,
      kind,
      scope,
      get active() {
        return active;
      },
      belongsTo: (world: WorldReader) => world === owner.world,
    });
    const lifetimes = open.get(owner.world) ?? new Map<string, Lifetime>();
    open.set(owner.world, lifetimes.set(lifetime.id, lifetime));
    owner.defer(() => {
      active = false;
      lifetimes.delete(lifetime.id);
    });
    if (adopt) {
      const changes = rehome(owner.world, adopt, lifetime.id);
      if (changes.length) owner.commit(Lifetime.adopted, changes, { id: lifetime.id, from: adopt });
    }
    const result = await owner.attempt(kind, (child) => body(child, lifetime));
    active = false;

    const states = owner.world.snapshot.states.filter((state) => state.scopeId === lifetime.id);
    const skills = owner.world.snapshot.skills.filter((skill) =>
      skill.grants.some((grant) => grant.scopeId === lifetime.id),
    );
    const changes: Change[] = states.map((state) => ({ kind: 'removeState', state: state.id }));
    for (const skill of skills) {
      const grants = skill.grants.filter((grant) => grant.scopeId !== lifetime.id);
      changes.push(
        grants.length
          ? { kind: 'setSkill', skill: { ...skill, grants } }
          : { kind: 'removeSkill', instance: skill.id },
      );
    }
    const ended = immutable({
      id: lifetime.id,
      kind,
      exit: result.kind,
      states: states.map((state) => state.id),
      statesBefore: states,
      skillsBefore: skills,
    });
    owner.commit(Lifetime.ended, changes, ended);
    await owner.window(Lifetime.ended, ended);
    if (result.kind === 'aborted') return owner.abort(result.reason);
    return result.value;
  });
}

function rehome(world: WorldReader, from: string, to: string): Change[] {
  const changes: Change[] = [];
  for (const state of world.snapshot.states.filter((entry) => entry.scopeId === from)) {
    changes.push({ kind: 'removeState', state: state.id });
    changes.push({
      kind: 'setState',
      state: {
        ...state,
        id: stateEntryId(state.key, state.owner, state.source, to),
        scopeId: to,
      },
    });
  }
  for (const skill of world.snapshot.skills)
    if (skill.grants.some((grant) => grant.scopeId === from))
      changes.push({
        kind: 'setSkill',
        skill: {
          ...skill,
          grants: skill.grants.map((grant) =>
            grant.scopeId === from ? { ...grant, scopeId: to } : grant,
          ),
        },
      });
  return changes;
}
