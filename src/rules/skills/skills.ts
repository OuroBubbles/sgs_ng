import type { SkillInstance, SkillSource, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context, Room } from '../../core/runtime/room';
import { defineEvent, timing } from '../../core/runtime/event';
import type { Trigger, TriggerSource, Timing } from '../../core/runtime/event';
import { assertLifetime, Lifetime } from '../scopes/lifetime';
import type { LifetimeEnd } from '../scopes/lifetime';
import { defineMark } from '../state/mark';
import type { Mark } from '../state/mark';
import type { ViewAs } from '../cards/types';
import { viewAs } from '../cards/types';
import type { QueryType, SkillModifier } from './query';
import type { ActiveSkill } from './active';
import type { CardDefinition } from '../cards/types';
import { defineCard } from '../cards/card';
import { equipmentAbilities } from '../cards/equipment';
import { Death } from '../combat/life-events';
import type { BurialEvent } from '../combat/life-events';
import type { PaymentReceipt } from '../costs/pay';

export interface SkillHandle {
  readonly id: string;
  readonly owner: string;
  readonly skill: string;
  readonly name: string;
  /** 显式授予的共享实例为 null；派生装备能力指向具体实体牌。 */
  readonly origin: SkillSource | null;
  /**
   * 来源此刻能否发动、支付或提供修正：拥有者存活、仍持有且未失效（Provider 来源还须仍在登记中）。
   * on 为本次结算绑定的来源改为本次结算及其子流程内的发动资格。
   */
  active(ctx: Context): boolean;
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

/** on 生成的触发声明；需要自定义来源绑定时，也可用普通对象或方法实现。 */
export interface SkillTrigger {
  readonly id: string;
  readonly window: object;
  bind(handle: SkillHandle): Trigger<unknown>;
}

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  /** 只声明实际能力；省略触发列表时由登记入口补齐。 */
  readonly triggers?: readonly SkillTrigger[];
  readonly description?: string;
  /** 内容分类，具体模式决定初始授予政策；不在技能内核中硬编码身份。 */
  readonly lord?: boolean;
  readonly viewAs?: readonly ViewAs[];
  readonly modifiers?: readonly SkillModifier[];
  readonly active?: readonly ActiveSkill[];
  /** 技能用到的标记；带 skill 的标记（持续效果）随技能自动登记。 */
  readonly marks?: readonly Mark<unknown>[];
}

/** 校验局部 ID 后直接使用声明本身：不复制、不冻结、不绑定方法。 */
export function defineSkill(definition: SkillDefinition): SkillDefinition {
  const { id, name, triggers = [], viewAs: recipes = [], active = [] } = definition;
  if (!id) throw new Error(`Skill "${name}" requires an ID.`);
  recipes.forEach(viewAs);
  // 三类局部 ID 各自命名，允许跨种类复用。
  for (const [kind, entries] of [
    ['trigger', triggers],
    ['view-as recipe', recipes],
    ['active action', active],
  ] as const) {
    const ids = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (!entry.id) throw new Error(`[${id}] Missing ${kind} ID at index ${index}.`);
      if (ids.has(entry.id)) throw new Error(`[${id}] Duplicate ${kind} ID: ${entry.id}.`);
      ids.add(entry.id);
    }
  }
  return definition;
}

export const skillBlocked = defineMark('core:skill-blocked', false);

export function skillEffective(world: WorldReader, instance: string): boolean {
  const current = world.snapshot.skills.find((skill) => skill.id === instance);
  return current !== undefined && !isSkillBlocked(world, current.owner, instance);
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
  skillBlocked.set(ctx, current.owner, true, { source: current.id, lifetime });
}

export interface SkillChange {
  readonly kind: 'changed' | 'unchanged';
  readonly before: SkillInstance | null;
  readonly after: SkillInstance | null;
}
export const Skill = defineEvent('skill', {
  changed: timing<SkillChange>(),
  invoked: timing<PaymentReceipt>(),
});

export interface GrantSkill {
  readonly owner: string;
  readonly skill: string;
  readonly source: SkillSource;
  readonly lifetime?: Lifetime;
}

function sameSource(a: SkillSource, b: SkillSource): boolean {
  return a.kind === b.kind && a.id === b.id;
}

// 每局挂接时登记 World → 规则目录；规则函数与作者代码都由 ctx 取得，不再传递目录对象。
const attachedBooks = new WeakMap<WorldReader, SkillBook>();

/** 当前对局的规则目录（技能与牌定义）。只能在已挂接目录的 Room 中调用。 */
export function rulesOf(ctx: Pick<Context, 'world'>): SkillBook {
  const book = attachedBooks.get(ctx.world);
  if (!book) throw new Error('No rule catalog is attached to this room.');
  return book;
}

/** 按当前目录合并一个查询的全部贡献。 */
export function queryRule<Input, Value>(
  ctx: Context,
  query: QueryType<Input, Value>,
  input: Input,
  base: Value,
): Value {
  return rulesOf(ctx).query(ctx, query, input, base);
}

/** 牌名对应的定义；未知牌名报错。 */
export function cardDef(ctx: Pick<Context, 'world'>, name: string): CardDefinition {
  const definition = rulesOf(ctx).cards.get(name);
  if (!definition) throw new Error(`Unknown card definition: ${name}`);
  return definition;
}

/** 持续效果：持有带 skill 的标记（当前作用域内不为初值）的存活角色拥有该技能。 */
function markAbilities(marks: readonly Mark<unknown>[]): SkillProvider {
  const byKey = new Map(marks.map((mark) => [mark.id, mark]));
  return {
    collect(world) {
      const bindings = new Map<string, SkillBinding>();
      for (const { key, owner } of world.snapshot.states) {
        const mark = byKey.get(key);
        if (!mark?.skill || owner === null) continue;
        const id = JSON.stringify(['mark', owner, key]);
        const self: SkillHandle = Object.freeze({
          id,
          owner,
          skill: mark.skill.id,
          name: mark.skill.name,
          origin: null,
          active: (ctx: Context) =>
            ctx.world.player(owner).alive && mark.of(ctx, owner) !== mark.initial,
        });
        bindings.set(id, { self, definition: mark.skill });
      }
      return [...bindings.values()];
    },
  };
}

/** 历史窗口：刚失去、到期或随死亡移除的技能实例仍可响应这一次窗口。 */
const snapshots = new Map<object, (payload: never) => readonly SkillInstance[]>([
  [Skill.changed, (change: SkillChange) => (change.before ? [change.before] : [])],
  [Lifetime.ended, (ended: LifetimeEnd) => ended.skillsBefore],
  [Death.buried, (event: BurialEvent) => event.burial.skillsBefore],
  [Death.finished, (event: BurialEvent) => event.burial.skillsBefore],
]);

/** 每局的规则目录：不可变定义可共享；授予/失效/次数在 World，派生能力由 Provider 从 World 读出。 */
export class SkillBook implements TriggerSource {
  /** 本局牌定义（牌名 → 定义）；装备牌的能力由同一目录派生。 */
  readonly cards: ReadonlyMap<string, CardDefinition>;
  readonly #definitions = new Map<string, SkillDefinition>();
  // 只共享不可变实例的身份描述；有效性仍逐次读取传入的 World。
  readonly #bindingsByInstance = new WeakMap<SkillInstance, SkillBinding>();
  readonly #providers = new Set<SkillProvider>();

  constructor(definitions: readonly SkillDefinition[] = [], cards: readonly CardDefinition[] = []) {
    const prepared = cards.map(defineCard);
    this.cards = new Map(prepared.map((card) => [card.id, card]));
    if (this.cards.size !== prepared.length) throw new Error('Duplicate or empty card definition.');
    const owners = [...definitions, ...prepared.flatMap((card) => card.equipment?.skill ?? [])];
    const marks = [...new Set(owners.flatMap((definition) => definition.marks ?? []))];
    this.#register([...definitions, ...marks.flatMap((mark) => mark.skill ?? [])]);
    this.addProvider(equipmentAbilities(prepared));
    this.addProvider(markAbilities(marks));
  }

  #register(definitions: readonly SkillDefinition[]): void {
    const prepared = definitions.map(defineSkill);
    const ids = new Set<string>();
    for (const { id } of prepared) {
      if (ids.has(id) || this.#definitions.has(id))
        throw new Error(`Duplicate skill definition: ${id}.`);
      ids.add(id);
    }
    for (const definition of prepared) this.#definitions.set(definition.id, definition);
  }

  definition(id: string): SkillDefinition {
    const definition = this.#definitions.get(id);
    if (!definition) throw new Error(`Unknown skill definition: ${id}`);
    return definition;
  }

  attach(room: Room): () => void {
    for (const instance of room.world.snapshot.skills) this.definition(instance.skill);
    if (attachedBooks.has(room.world)) throw new Error('Room already has a rule catalog.');
    const removeSource = room.addTriggerSource(this);
    attachedBooks.set(room.world, this);
    // 关闭只停止结算；终局房间仍可只读投影牌面，故仅显式卸载时才移除目录查找。
    const cancelCleanup = room.onClose(removeSource);
    return () => {
      removeSource();
      cancelCleanup();
      attachedBooks.delete(room.world);
    };
  }

  /** 装配期加入派生能力的来源；返回卸载函数。 */
  addProvider(provider: SkillProvider): () => void {
    this.#providers.add(provider);
    return () => this.#providers.delete(provider);
  }

  bindings(
    world: WorldReader,
    window?: { readonly type: object; readonly payload: unknown },
  ): readonly SkillBinding[] {
    let instances = world.snapshot.skills;
    const read = window && snapshots.get(window.type);
    if (read) {
      // 普通查询直接读取当前列表；只有显式历史窗口需要合并刚移除的实例。
      const merged = new Map(instances.map((instance) => [instance.id, instance]));
      for (const instance of read(window.payload as never))
        if (!merged.has(instance.id)) merged.set(instance.id, instance);
      instances = [...merged.values()];
    }
    const bindings: SkillBinding[] = instances.map((instance) => {
      const previous = this.#bindingsByInstance.get(instance);
      if (previous) return previous;
      const { id, owner, skill } = instance;
      const definition = this.definition(skill);
      const binding: SkillBinding = Object.freeze({
        self: Object.freeze({
          id,
          owner,
          skill,
          name: definition.name,
          origin: null,
          active: (ctx: Context) => ctx.world.player(owner).alive && skillEffective(ctx.world, id),
        }),
        definition,
      });
      this.#bindingsByInstance.set(instance, binding);
      return binding;
    });
    for (const provider of this.#providers) bindings.push(...provider.collect(world, window));
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
        const modifiers = definition.modifiers?.filter((modifier) => modifier.query === query);
        if (!modifiers?.length || !self.active(ctx)) continue;
        for (const modifier of modifiers) {
          const contribution = modifier.contribution(ctx, input, self) as Value | undefined;
          if (contribution !== undefined) value = query.combine(value, contribution);
        }
      }
      return value;
    });
  }

  collect<T>(type: Timing<T, unknown>, world: WorldReader, payload: T): readonly Trigger<T>[] {
    return this.bindings(world, { type, payload }).flatMap(({ self, definition }) =>
      (definition.triggers ?? [])
        .filter((trigger) => trigger.window === type)
        .map((trigger) => ({ ...trigger.bind(self), label: definition.name })),
    );
  }

  grant(ctx: Context, input: GrantSkill): Promise<SkillChange> {
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
          { source: input.source, scopeId: input.lifetime?.id ?? null },
        ],
      });
      return this.#change(child, before, after);
    });
  }

  revoke(ctx: Context, owner: string, skill: string, source: SkillSource): Promise<SkillChange> {
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

  async #change(
    ctx: Context,
    before: SkillInstance | null,
    after: SkillInstance | null,
  ): Promise<SkillChange> {
    const result: SkillChange = immutable({ kind: 'changed', before, after });
    if (after) ctx.commit(Skill.changed, [{ kind: 'setSkill', skill: after }], result);
    else if (before)
      ctx.commit(Skill.changed, [{ kind: 'removeSkill', instance: before.id }], result);
    else throw new Error('Empty skill change.');
    await ctx.window(Skill.changed, result, { subject: (after ?? before)!.owner });
    return result;
  }
}
