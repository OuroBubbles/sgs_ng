import type { SkillInstance, SkillSource, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context, FlowResult, Room } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import type {
  Trigger,
  TriggerSource,
  WindowType,
  TriggerOccurrence,
  WindowRef,
  WindowAdmission,
} from '../../core/runtime/window';
import { assertLifetime, lifetimeEnded } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';
import { defineState, setState } from '../state/state';
import type { ViewAs } from '../cards/types';
import { viewAs } from '../cards/types';
import type { QueryType, SkillModifier } from './query';
import type { ActiveSkill } from './active';
import { playerBuried, deathFinished } from '../combat/life-events';
import { EffectBook } from '../effects/effects';

export interface SkillHandle {
  readonly id: string;
  readonly owner: string;
  readonly skill: string;
  readonly name: string;
  /** 显式授予的共享实例为 null；派生装备能力指向具体实体牌。 */
  readonly origin: SkillSource | null;
  /** 只查询当前所有权与失效；历史后效不把已经离场的来源伪装成仍有效。 */
  effective(world: WorldReader): boolean;
  /** 执行侧登记资格。卸载或替换 Provider 后，旧引用不能借 retain 继续发动。 */
  readonly registered?: () => boolean;
  /** on 为本次结算绑定的可发动资格；不会被登记为查询、转换或新的主动技能。 */
  readonly available?: (ctx: Context) => boolean;
}

/** 发动/支付的来源资格。历史资格只属于绑定它的结算和子流程。 */
export function skillAvailable(ctx: Context, self: SkillHandle): boolean {
  return ctx.query(() => {
    const owner = ctx.world.snapshot.players.find((player) => player.id === self.owner);
    return (
      owner !== undefined &&
      (self.registered?.() ?? true) &&
      (self.available ? self.available(ctx) : owner.alive && self.effective(ctx.world))
    );
  });
}

export interface SkillBinding {
  readonly self: SkillHandle;
  readonly definition: SkillDefinition;
}

/** 从权威状态派生能力，不另存一份可漂移的授予列表。 */
export interface SkillProvider {
  collect(
    world: WorldReader,
    window?: { readonly type: object; readonly payload: unknown },
  ): readonly SkillBinding[];
}

export interface SkillEffect {
  readonly id: string;
  readonly window: object;
  bind(handle: SkillHandle): Trigger<unknown>;
}

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly effects: readonly SkillEffect[];
  readonly description?: string;
  /** 内容分类，具体模式决定初始授予政策；不在技能内核中硬编码身份。 */
  readonly lord?: boolean;
  readonly viewAs?: readonly ViewAs[];
  readonly modifiers?: readonly SkillModifier[];
  readonly active?: readonly ActiveSkill[];
}

export interface Effect<T> {
  readonly id: string;
  readonly group?: string;
  readonly order?: 'automatic' | 'choose';
  readonly allowDead?: boolean;
  /** 本窗口有限次数的快照；每次独立重查、选择与结算，不把多个发动藏在 run 循环中。 */
  readonly times?: (ctx: Context, payload: T, self: SkillHandle) => number;
  /** 明确允许已离场来源处理本次事实；不恢复所有权，只为本次 run 与子流程提供发动资格。 */
  readonly retain?: (ctx: Context, payload: T, self: SkillHandle) => boolean;
  readonly when?: (
    ctx: Context,
    payload: T,
    self: SkillHandle,
    occurrence: TriggerOccurrence,
  ) => boolean;
  readonly run: (
    ctx: Context,
    payload: T,
    self: SkillHandle,
    occurrence: TriggerOccurrence,
  ) => void | Promise<void>;
}

export function on<T>(window: WindowType<T>, definition: Effect<T>): SkillEffect {
  const effect = Object.freeze({ ...definition });
  if (!effect.id) throw new Error('Skill effect requires an ID.');
  return Object.freeze({
    id: effect.id,
    window,
    bind(self: SkillHandle): Trigger<unknown> {
      const available = (ctx: Context, payload: T) =>
        (self.registered?.() ?? true) &&
        (effect.allowDead || ctx.world.player(self.owner).alive) &&
        ((self.available ? self.available(ctx) : self.effective(ctx.world)) ||
          (effect.retain?.(ctx, payload, self) ?? false));
      return {
        id: JSON.stringify([self.id, effect.id]),
        owner: self.owner,
        ...(effect.group === undefined ? {} : { group: effect.group }),
        ...(effect.order === undefined ? {} : { order: effect.order }),
        ...(effect.times === undefined
          ? {}
          : { times: (ctx: Context, payload: unknown) => effect.times!(ctx, payload as T, self) }),
        eligible: (ctx, payload, occurrence) =>
          available(ctx, payload as T) &&
          (effect.when?.(ctx, payload as T, self, occurrence) ?? true),
        async run(ctx, payload, occurrence) {
          let active = true;
          const binding: SkillHandle = Object.freeze({
            id: self.id,
            owner: self.owner,
            skill: self.skill,
            name: self.name,
            origin: self.origin,
            effective: (world: WorldReader) => self.effective(world),
            ...(self.registered === undefined ? {} : { registered: () => self.registered!() }),
            available: (at: Context) =>
              active &&
              at.world === ctx.world &&
              at.cause.scopePath.includes(ctx.scope.id) &&
              available(at, payload as T),
          });
          try {
            await effect.run(ctx, payload as T, binding, occurrence);
          } finally {
            active = false;
          }
        },
      };
    },
  });
}

export function defineSkill(definition: SkillDefinition): SkillDefinition {
  if (
    !definition.id ||
    definition.effects.some((effect) => !effect.id) ||
    new Set(definition.effects.map((effect) => effect.id)).size !== definition.effects.length ||
    (definition.viewAs !== undefined &&
      new Set(definition.viewAs.map((recipe) => recipe.id)).size !== definition.viewAs.length) ||
    (definition.active !== undefined &&
      (definition.active.some((action) => !action.id) ||
        new Set(definition.active.map((action) => action.id)).size !== definition.active.length))
  )
    throw new Error('Skill requires a distinct ID for each effect.');
  return Object.freeze({
    ...definition,
    effects: Object.freeze(definition.effects.map((effect) => Object.freeze({ ...effect }))),
    ...(definition.active === undefined
      ? {}
      : { active: Object.freeze(definition.active.map((action) => Object.freeze({ ...action }))) }),
    ...(definition.viewAs === undefined
      ? {}
      : { viewAs: Object.freeze(definition.viewAs.map(viewAs)) }),
    ...(definition.modifiers === undefined
      ? {}
      : {
          modifiers: Object.freeze(
            definition.modifiers.map((modifier) => Object.freeze({ ...modifier })),
          ),
        }),
  });
}

export const skillBlocked = defineState(
  'core:skill-blocked',
  false,
  (input): input is boolean => typeof input === 'boolean',
);

export function skillEffective(world: WorldReader, instance: string): boolean {
  const current = world.snapshot.skills.find((skill) => skill.id === instance);
  return (
    current !== undefined &&
    current.grants.some((grant) => grant.enabled) &&
    !isSkillBlocked(world, current.owner, instance)
  );
}

export function isSkillBlocked(world: WorldReader, owner: string, instance: string): boolean {
  return world.snapshot.states.some(
    (state) =>
      state.key === skillBlocked.id &&
      state.owner === owner &&
      state.source === instance &&
      state.value === true,
  );
}

/** 明确匹配本次事件里的旧实例；部分撤销和失效不是失去整个技能。 */
export function skillLost(
  world: WorldReader,
  before: SkillInstance | null,
  self: SkillHandle,
): boolean {
  return (
    before?.id === self.id &&
    before.owner === self.owner &&
    before.skill === self.skill &&
    before.grants.some((grant) => grant.enabled) &&
    !world.snapshot.skills.some((current) => current.id === self.id) &&
    !isSkillBlocked(world, self.owner, self.id)
  );
}

export function blockSkill(ctx: Context, instance: string | SkillHandle, lifetime: Lifetime): void {
  const current =
    typeof instance === 'string'
      ? ctx.world.snapshot.skills.find((skill) => skill.id === instance)
      : instance;
  if (!current) throw new Error('Cannot block an unknown skill instance.');
  setState(ctx, skillBlocked, { owner: current.owner, source: current.id, lifetime }, true);
}

export interface SkillChange {
  readonly kind: 'changed' | 'unchanged';
  readonly before: SkillInstance | null;
  readonly after: SkillInstance | null;
}
export const skillsChanged = defineWindow<SkillChange>('skills.changed');

export interface GrantSkill {
  readonly owner: string;
  readonly skill: string;
  readonly source: SkillSource;
  readonly lifetime?: Lifetime;
}

function sameSource(a: SkillSource, b: SkillSource): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function checkSnapshots(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('Skill snapshots must be an array.');
}

/** 不可变定义可共享；授予/失效/次数在 World，Provider 登记仅留在执行侧。 */
export class SkillBook implements TriggerSource {
  readonly effects = new EffectBook();
  #definitions: ReadonlyMap<string, SkillDefinition> = new Map();
  #providers = new Map<SkillProvider, object>();
  #attachments = new Map<WorldReader, object>();
  #collecting = 0;
  #snapshots = new Map<object, (payload: unknown) => readonly SkillInstance[]>();
  #sealed = false;

  constructor(definitions: readonly SkillDefinition[] = []) {
    this.register(definitions);
    this.registerSnapshots(skillsChanged, (change) => (change.before ? [change.before] : []));
    this.registerSnapshots(lifetimeEnded, (ended) => ended.skillsBefore);
    this.registerSnapshots(playerBuried, (event) => event.burial.skillsBefore);
    this.registerSnapshots(deathFinished, (event) => event.burial.skillsBefore);
  }

  /** 装配期声明窗口中的历史来源。只有该窗口收集候选，不进入当前能力目录。 */
  registerSnapshots<T>(
    window: WindowType<T>,
    read: (payload: T) => readonly SkillInstance[],
  ): void {
    if (this.#sealed) throw new Error('Skill snapshots are sealed after attachment.');
    if (this.#snapshots.has(window)) throw new Error('Duplicate skill snapshot reader.');
    this.#snapshots.set(window, (payload) => read(payload as T));
  }

  /** 装配期允许先建立牌目录，再注入需要 CardBook 的普通技能工厂；挂接后目录固定。 */
  register(definitions: readonly SkillDefinition[]): void {
    if (this.#sealed) throw new Error('Skill definitions are sealed after attachment.');
    if (
      new Set(definitions.map((definition) => definition.id)).size !== definitions.length ||
      definitions.some((definition) => this.#definitions.has(definition.id))
    )
      throw new Error('Duplicate skill definition.');
    const prepared = definitions.map(
      (definition) => [definition.id, defineSkill(definition)] as const,
    );
    this.#definitions = new Map([...this.#definitions, ...prepared]);
  }

  definition(id: string): SkillDefinition {
    const definition = this.#definitions.get(id);
    if (!definition) throw new Error(`Unknown skill definition: ${id}`);
    return definition;
  }

  attach(room: Room): () => void {
    for (const instance of room.world.snapshot.skills) this.definition(instance.skill);
    const removeSource = room.addTriggerSource(this);
    let removeEffects: () => void;
    try {
      removeEffects = this.effects.attach(room);
    } catch (error) {
      removeSource();
      throw error;
    }
    const registration = {};
    const detach = () => {
      removeSource();
      removeEffects();
      cancelCleanup();
      if (this.#attachments.get(room.world) === registration) this.#attachments.delete(room.world);
    };
    const cancelCleanup = room.onClose(detach);
    this.#attachments.set(room.world, registration);
    this.#sealed = true;
    return detach;
  }

  /** 装配期可省略 Context；运行期安装/卸载必须属于本目录唯一挂接的 Room。 */
  addProvider(provider: SkillProvider, ctx?: Context): (ctx?: Context) => void {
    this.#assertProviderWriting(ctx);
    if (this.#providers.has(provider)) throw new Error('Skill provider is already installed.');
    const registration = {};
    this.#providers.set(provider, registration);
    return (at?: Context) => {
      this.#assertProviderWriting(at);
      if (this.#providers.get(provider) === registration) this.#providers.delete(provider);
    };
  }

  #assertProviderWriting(ctx?: Context): void {
    if (this.#collecting) throw new Error('Skill providers cannot change during collection.');
    if (ctx) {
      ctx.assertActive();
      if (this.#attachments.size !== 1 || !this.#attachments.has(ctx.world))
        throw new Error('Runtime skill providers require a single attached Room.');
    } else if (this.#sealed) throw new Error('Runtime skill providers require an active Context.');
  }

  bindings(
    world: WorldReader,
    window?: { readonly type: object; readonly payload: unknown },
  ): readonly SkillBinding[] {
    this.#collecting++;
    try {
      return this.#bindings(world, window);
    } finally {
      this.#collecting--;
    }
  }

  #bindings(
    world: WorldReader,
    window?: { readonly type: object; readonly payload: unknown },
  ): readonly SkillBinding[] {
    const instances = new Map(world.snapshot.skills.map((instance) => [instance.id, instance]));
    const read = window && this.#snapshots.get(window.type);
    if (read) {
      const snapshots = read(window.payload);
      checkSnapshots(snapshots);
      for (const instance of snapshots) {
        const current = instances.get(instance.id);
        if (current && (current.owner !== instance.owner || current.skill !== instance.skill))
          throw new Error('Conflicting historical skill identity.');
        if (!current) instances.set(instance.id, instance);
      }
    }
    const bindings: SkillBinding[] = [...instances.values()].map((instance) => ({
      self: Object.freeze({
        id: instance.id,
        owner: instance.owner,
        skill: instance.skill,
        name: this.definition(instance.skill).name,
        origin: null,
        effective: (current: WorldReader) => skillEffective(current, instance.id),
      }),
      definition: this.definition(instance.skill),
    }));
    for (const [provider, registration] of this.#providers) {
      for (const { self, definition } of provider.collect(world, window)) {
        const registered = () =>
          this.#providers.get(provider) === registration && (self.registered?.() ?? true);
        // 显式转发保留 class 方法的接收者；旧引用只属于这一次登记。
        bindings.push({
          definition,
          self: Object.freeze({
            id: self.id,
            owner: self.owner,
            skill: self.skill,
            name: self.name,
            origin: self.origin,
            registered,
            effective: (current: WorldReader) => registered() && self.effective(current),
            ...(self.available === undefined
              ? {}
              : { available: (at: Context) => registered() && self.available!(at) }),
          }),
        });
      }
    }
    if (new Set(bindings.map(({ self }) => self.id)).size !== bindings.length)
      throw new Error('Duplicate ability instance.');
    return bindings;
  }

  binding(world: WorldReader, id: string): SkillBinding | undefined {
    return this.bindings(world).find(({ self }) => self.id === id);
  }

  query<Input, Value>(
    ctx: Context,
    query: QueryType<Input, Value>,
    input: Input,
    base: Value,
  ): Value {
    return ctx.query(() => {
      let value = base;
      for (const { self, definition } of this.bindings(ctx.world)) {
        if (!ctx.world.player(self.owner).alive || !self.effective(ctx.world)) continue;
        for (const modifier of definition.modifiers ?? []) {
          if (modifier.query !== query) continue;
          const contribution = modifier.contribution(ctx, input, self) as Value | undefined;
          if (contribution !== undefined) value = query.combine(value, contribution);
        }
      }
      for (const contribution of this.effects.contributions(ctx, query, input))
        value = query.combine(value, contribution);
      return value;
    });
  }

  collect<T>(type: WindowType<T>, world: WorldReader, payload: T): readonly Trigger<T>[] {
    return this.bindings(world, { type, payload }).flatMap(({ self, definition }) => {
      return definition.effects
        .filter((effect) => effect.window === type)
        .map((effect) => ({ ...effect.bind(self), label: definition.name }));
    });
  }

  /** 只加入本次显式选中的当前实例；省略 instances 时重新收集本目录的新候选。 */
  include<T>(ctx: Context, window: WindowRef<T>, instances?: readonly string[]): WindowAdmission {
    if (instances === undefined) return ctx.include(window, this);
    const wanted = new Set(instances);
    const ids = ctx.query(
      () =>
        new Set(
          this.bindings(ctx.world, { type: window.type, payload: window.payload })
            .filter(({ self }) => wanted.has(self.id))
            .flatMap(({ self, definition }) =>
              definition.effects
                .filter((effect) => effect.window === window.type)
                .map((effect) => effect.bind(self).id),
            ),
        ),
    );
    return ctx.include(window, this, (trigger) => ids.has(trigger.id));
  }

  grant(ctx: Context, input: GrantSkill): Promise<FlowResult<SkillChange>> {
    return ctx.flow('skill.grant', async (child) => {
      this.definition(input.skill);
      child.world.player(input.owner);
      assertLifetime(child, input.lifetime ?? null);
      const before =
        child.world.snapshot.skills.find(
          (skill) => skill.owner === input.owner && skill.skill === input.skill,
        ) ?? null;
      if (before?.grants.some((grant) => sameSource(grant.source, input.source)))
        return immutable({ kind: 'unchanged', before, after: before });
      const after: SkillInstance = immutable({
        id: before?.id ?? `skill:${child.cause.flowId}`,
        skill: input.skill,
        owner: input.owner,
        grants: [
          ...(before?.grants ?? []),
          { source: input.source, enabled: true, scopeId: input.lifetime?.id ?? null },
        ],
      });
      return this.#change(child, before, after);
    });
  }

  revoke(
    ctx: Context,
    owner: string,
    skill: string,
    source: SkillSource,
  ): Promise<FlowResult<SkillChange>> {
    return ctx.flow('skill.revoke', (child) => {
      const before =
        child.world.snapshot.skills.find(
          (instance) => instance.owner === owner && instance.skill === skill,
        ) ?? null;
      if (!before?.grants.some((grant) => sameSource(grant.source, source)))
        return immutable({ kind: 'unchanged', before, after: before });
      const grants = before.grants.filter((grant) => !sameSource(grant.source, source));
      return this.#change(child, before, grants.length ? { ...before, grants } : null);
    });
  }

  setEnabled(
    ctx: Context,
    owner: string,
    skill: string,
    source: SkillSource,
    enabled: boolean,
  ): Promise<FlowResult<SkillChange>> {
    return ctx.flow('skill.enable', (child) => {
      const before =
        child.world.snapshot.skills.find(
          (instance) => instance.owner === owner && instance.skill === skill,
        ) ?? null;
      const grant = before?.grants.find((item) => sameSource(item.source, source));
      if (!before || !grant || grant.enabled === enabled)
        return immutable({ kind: 'unchanged', before, after: before });
      return this.#change(child, before, {
        ...before,
        grants: before.grants.map((item) => (item === grant ? { ...item, enabled } : item)),
      });
    });
  }

  async #change(
    ctx: Context,
    before: SkillInstance | null,
    after: SkillInstance | null,
  ): Promise<SkillChange> {
    const result: SkillChange = immutable({ kind: 'changed', before, after });
    if (after) ctx.commit('skill.changed', [{ kind: 'setSkill', skill: after }], result);
    else if (before)
      ctx.commit('skill.changed', [{ kind: 'removeSkill', instance: before.id }], result);
    else throw new Error('Empty skill change.');
    await ctx.window(skillsChanged, result, { subject: (after ?? before)!.owner });
    return result;
  }
}
