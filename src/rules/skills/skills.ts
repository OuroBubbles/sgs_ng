import type { SkillInstance, SkillSource, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context, Room } from '../../core/runtime/room';
import { defineEvent, timing } from '../../core/runtime/event';
import type { Trigger, TriggerSource, Timing } from '../../core/runtime/event';
import { assertLifetime, Lifetime } from '../scopes/lifetime';
import { defineMark } from '../state/mark';
import type { ViewAs } from '../cards/types';
import { viewAs } from '../cards/types';
import type { QueryType, SkillModifier } from './query';
import type { ActiveSkill } from './active';
import { EffectBook } from '../effects/effects';
import type { EffectDefinition } from '../effects/effects';
import type { CardDefinition } from '../cards/types';
import { defineCard } from '../cards/card';
import { equipmentAbilities } from '../cards/equipment';
import { Death } from '../combat/life-events';
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
  /** 与技能同处一处的 AI 提示；规则从不读取。 */
  readonly ai?: SkillAi;
  /** 技能创建的独立效果；内容装配按引用自动登记，与武将的技能同理。 */
  readonly effects?: readonly EffectDefinition[];
}

/** AI 只看到观察者视角的简化局面；提示函数必须是纯函数。 */
export interface AiSeat {
  readonly id: string;
  readonly alive: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly gender: string;
}
export interface AiView {
  readonly self: AiSeat;
  readonly players: readonly AiSeat[];
  readonly hand: readonly { readonly id: string }[];
  readonly cards: readonly { readonly id: string }[];
  /** 正值为敌意，负值为友方。 */
  readonly hostility: (player: string) => number;
  /** 牌的保留价值；越低越适合作为费用。 */
  readonly cost: (card: string) => number;
}
export interface SkillAi {
  /** 主动技能的发动意愿；不大于 0 时不发动。 */
  readonly value?: (view: AiView) => number;
  /** 选择目标时偏向友方还是敌方，默认敌方。 */
  readonly targets?: 'ally' | 'enemy';
}

/** 执行侧返回声明本身；Provider 输入仍可使用普通 SkillDefinition。 */
interface DefinedBinding extends SkillBinding {
  readonly definition: SkillDefinition;
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

function checkSnapshots(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('Skill snapshots must be an array.');
}

// 每局挂接时登记 World → 规则目录；规则函数与作者代码都由 ctx 取得，不再传递目录对象。
const attachedBooks = new WeakMap<WorldReader, SkillBook>();

/** 当前对局的规则目录（技能、牌定义、独立效果）。只能在已挂接目录的 Room 中调用。 */
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

/** 每局的规则目录：不可变定义可共享；授予/失效/次数在 World，Provider 登记仅留在执行侧。 */
export class SkillBook implements TriggerSource {
  readonly effects = new EffectBook();
  /** 本局牌定义（牌名 → 定义）；装备牌的能力由同一目录派生。 */
  readonly cards: ReadonlyMap<string, CardDefinition>;
  readonly #definitions = new Map<string, SkillDefinition>();
  // 只共享不可变实例的身份描述；有效性仍逐次读取传入的 World。
  readonly #bindingsByInstance = new WeakMap<SkillInstance, DefinedBinding>();
  #providers = new Map<SkillProvider, object>();
  #attachments = new Map<WorldReader, object>();
  #collecting = 0;
  #snapshots = new Map<object, (payload: unknown) => readonly SkillInstance[]>();
  #sealed = false;

  constructor(definitions: readonly SkillDefinition[] = [], cards: readonly CardDefinition[] = []) {
    const prepared = cards.map(defineCard);
    this.cards = new Map(prepared.map((card) => [card.id, card]));
    if (this.cards.size !== prepared.length) throw new Error('Duplicate or empty card definition.');
    this.register(definitions);
    this.registerSnapshots(Skill.changed, (change) => (change.before ? [change.before] : []));
    this.registerSnapshots(Lifetime.ended, (ended) => ended.skillsBefore);
    this.registerSnapshots(Death.buried, (event) => event.burial.skillsBefore);
    this.registerSnapshots(Death.finished, (event) => event.burial.skillsBefore);
    this.addProvider(equipmentAbilities(prepared));
  }

  /** 装配期声明窗口中的历史来源。只有该窗口收集候选，不进入当前能力目录。 */
  registerSnapshots<T>(
    window: Timing<T, unknown>,
    read: (payload: T) => readonly SkillInstance[],
  ): void {
    if (this.#sealed) throw new Error('Skill snapshots are sealed after attachment.');
    if (this.#snapshots.has(window)) throw new Error('Duplicate skill snapshot reader.');
    this.#snapshots.set(window, (payload) => read(payload as T));
  }

  /** 装配期可追加技能定义；挂接后目录固定。 */
  register(definitions: readonly SkillDefinition[]): void {
    if (this.#sealed) throw new Error('Skill definitions are sealed after attachment.');
    const prepared = definitions.map(defineSkill);
    const ids = new Set<string>();
    for (const { id } of prepared) {
      if (ids.has(id) || this.#definitions.has(id))
        throw new Error(`Duplicate skill definition: ${id}.`);
      ids.add(id);
    }

    // 全部校验与规范化完成后再写入；提交阶段不调用内容代码。
    for (const definition of prepared) this.#definitions.set(definition.id, definition);
  }

  /** 技能旁声明的 AI 提示；未知技能或无提示时为 undefined。 */
  hint(id: string): SkillAi | undefined {
    return this.#definitions.get(id)?.ai;
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
    // 关闭只停止结算；终局房间仍可只读投影牌面，故仅显式卸载时才移除目录查找。
    const detach = (closing: boolean) => {
      removeSource();
      removeEffects();
      cancelCleanup();
      if (this.#attachments.get(room.world) === registration) this.#attachments.delete(room.world);
      if (!closing && attachedBooks.get(room.world) === this) attachedBooks.delete(room.world);
    };
    const cancelCleanup = room.onClose(() => detach(true));
    this.#attachments.set(room.world, registration);
    attachedBooks.set(room.world, this);
    this.#sealed = true;
    return () => detach(false);
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
  ): readonly DefinedBinding[] {
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
  ): readonly DefinedBinding[] {
    let instances = world.snapshot.skills;
    const read = window && this.#snapshots.get(window.type);
    if (read) {
      const snapshots = read(window.payload);
      checkSnapshots(snapshots);
      // 普通查询直接读取当前列表；只有显式历史窗口需要合并与身份冲突检查。
      const merged = new Map(instances.map((instance) => [instance.id, instance]));
      for (const instance of snapshots) {
        const current = merged.get(instance.id);
        if (current && (current.owner !== instance.owner || current.skill !== instance.skill))
          throw new Error('Conflicting historical skill identity.');
        if (!current) merged.set(instance.id, instance);
      }
      instances = [...merged.values()];
    }
    const bindings: DefinedBinding[] = instances.map((instance) => {
      const previous = this.#bindingsByInstance.get(instance);
      if (previous) return previous;
      const { id, owner, skill } = instance;
      const definition = this.definition(skill);
      const binding: DefinedBinding = Object.freeze({
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
    for (const [provider, registration] of this.#providers) {
      for (const { self, definition } of provider.collect(world, window)) {
        // 旧引用只属于这一次登记。
        bindings.push({
          definition: defineSkill(definition),
          self: Object.freeze({
            id: self.id,
            owner: self.owner,
            skill: self.skill,
            name: self.name,
            origin: self.origin,
            active: (at: Context) =>
              this.#providers.get(provider) === registration && self.active(at),
          }),
        });
      }
    }
    if (new Set(bindings.map(({ self }) => self.id)).size !== bindings.length)
      throw new Error('Duplicate ability instance.');
    return bindings;
  }

  binding(world: WorldReader, id: string): DefinedBinding | undefined {
    return this.bindings(world).find(({ self }) => self.id === id);
  }

  query<Input, Value>(
    ctx: Context,
    query: QueryType<Input, Value>,
    input: Input,
    base: Value,
  ): Value {
    return ctx.query(() => {
      // 单项回调先检查同步性；合并后的普通值可能已把 Promise 隐藏掉。
      let value = base;
      for (const { self, definition } of this.bindings(ctx.world)) {
        const modifiers = definition.modifiers?.filter((modifier) => modifier.query === query);
        if (!modifiers?.length) continue;
        if (!self.active(ctx)) continue;
        for (const modifier of modifiers) {
          const contribution = modifier.contribution(ctx, input, self) as Value | undefined;
          if (contribution !== undefined) value = query.combine(value, contribution);
        }
      }
      for (const contribution of this.effects.contributions(ctx, query, input))
        value = query.combine(value, contribution);
      return value;
    });
  }

  collect<T>(type: Timing<T, unknown>, world: WorldReader, payload: T): readonly Trigger<T>[] {
    return this.bindings(world, { type, payload }).flatMap(({ self, definition }) => {
      return (definition.triggers ?? [])
        .filter((trigger) => trigger.window === type)
        .map((trigger) => ({ ...trigger.bind(self), label: definition.name }));
    });
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
          { source: input.source, enabled: true, scopeId: input.lifetime?.id ?? null },
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

  setEnabled(
    ctx: Context,
    owner: string,
    skill: string,
    source: SkillSource,
    enabled: boolean,
  ): Promise<SkillChange> {
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
    if (after) ctx.commit(Skill.changed, [{ kind: 'setSkill', skill: after }], result);
    else if (before)
      ctx.commit(Skill.changed, [{ kind: 'removeSkill', instance: before.id }], result);
    else throw new Error('Empty skill change.');
    await ctx.window(Skill.changed, result, { subject: (after ?? before)!.owner });
    return result;
  }
}
