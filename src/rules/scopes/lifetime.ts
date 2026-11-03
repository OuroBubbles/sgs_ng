import type { Change, SkillInstance, StateEntry, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineEvent, timing } from '../../core/runtime/event';

/** 只有显式领域 lifetime 才管理状态/授予到期，普通子 Flow 不自动冒充阶段或回合。 */
export interface Lifetime {
  readonly id: string;
  readonly kind: string;
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

export const Lifetime = defineEvent('lifetime', {
  ended: timing<LifetimeEnd>(),
});

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

export async function withLifetime<T>(
  ctx: Context,
  kind: string,
  body: (ctx: Context, lifetime: Lifetime) => T | Promise<T>,
): Promise<T> {
  return ctx.flow(`lifetime:${kind}`, async (owner) => {
    let active = true;
    owner.defer(() => {
      active = false;
    });
    const lifetime: Lifetime = Object.freeze({
      id: owner.scope.id,
      kind,
      get active() {
        return active;
      },
      belongsTo: (world: WorldReader) => world === owner.world,
    });
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
    owner.commit('lifetime.ended', changes, ended);
    await owner.window(Lifetime.ended, ended);
    if (result.kind === 'aborted') return owner.abort(result.reason);
    return result.value;
  });
}
