import type { Change, StateEntry, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { DeepReadonly } from '../../core/model/value';
import type { Context, Room } from '../../core/runtime/room';
import { defineEvent, timing } from '../../core/runtime/event';
import type { Trigger, TriggerSource, Timing } from '../../core/runtime/event';
import { assertLifetime, Lifetime } from '../scopes/lifetime';
import type { QueryType } from '../skills/query';
import { isGameOver } from '../game/end';

const stateKey = 'rules:effect';
const hosts = new WeakMap<WorldReader, EffectBook>();

/** 效果身份、归属与数据进入 World；定义函数和执行句柄不进入历史。 */
export interface EffectRecord<Data = unknown> {
  readonly id: string;
  readonly type: string;
  /** 行动序归属，可为 null；不会隐含“来源技能存在”或“角色存活”的资格。 */
  readonly owner: string | null;
  readonly origin: unknown;
  readonly scopeId: string | null;
  readonly data: DeepReadonly<Data>;
}
/** 字段始终是本次行为绑定的快照；跨 await 读取当前实例须显式调用 current。 */
export interface EffectHandle<Data = unknown> extends EffectRecord<Data> {
  /** 当前挂接中的实时记录；结束、外局或旧挂接均返回 null。 */
  current(world: WorldReader): EffectRecord<Data> | null;
  update(ctx: Context, data: Data): Promise<EffectRecord<Data> | null>;
  /** 返回本次实际移除的记录；重复结束返回 null。后效不改写这份结果。 */
  end(ctx: Context, reason: string): Promise<EffectRecord<Data> | null>;
}
export interface EffectTrigger {
  readonly id: string;
  readonly window: object;
  /** 纯同步绑定；候选收集、执行前重绑及显式入窗均检查这一约定。 */
  bind(self: EffectHandle): Trigger<unknown>;
}

export interface EffectModifier {
  readonly query: object;
  contribution(ctx: Context, input: unknown): unknown;
}
export interface EffectBehavior {
  readonly triggers?: readonly EffectTrigger[];
  readonly modifiers?: readonly EffectModifier[];
}
interface EffectDeclaration<Data> {
  readonly id: string;
  readonly name: string;
  /** 新增、更新与读取存量数据都必须同步校验。 */
  readonly accepts: (data: unknown) => data is Data;
  /** 在纯收集/查询中以普通闭包绑定实例；条件和分支不需要配置模板。 */
  create(self: EffectHandle<Data>): EffectBehavior;
  /** 状态已结束、通用结束窗口已完成后的普通后续，不恢复效果资格。 */
  onEnd?(ctx: Context, input: EffectEnd<Data>): unknown;
}
export type EffectDefinition<Data = unknown> = Readonly<EffectDeclaration<Data>>;
export interface EffectInput<Data> {
  readonly owner: string | null;
  readonly data: Data;
  readonly origin?: unknown;
  readonly lifetime?: Lifetime;
}
export interface PreparedEffect<Data> {
  readonly record: EffectRecord<Data>;
  /** 可与费用/宣告一起提交；调用方仍负责自己的最终资格检查。 */
  readonly change: Extract<Change, { kind: 'setState' }>;
}
export interface EffectEnd<Data = unknown> {
  readonly before: EffectRecord<Data>;
  readonly reason: string;
}
export const Effect = defineEvent('effect', {
  added: timing<EffectRecord>(),
  changed: timing<{
    readonly before: EffectRecord;
    readonly after: EffectRecord;
  }>(),
  ended: timing<EffectEnd>(),
  removed: timing<unknown>(),
});

/** 校验后直接使用声明本身：不复制、不冻结、不绑定方法。 */
export function defineEffect<Data>(definition: EffectDefinition<Data>): EffectDefinition<Data> {
  const { id, name, accepts, create } = definition;
  if (!id.trim() || !name.trim() || typeof accepts !== 'function' || typeof create !== 'function')
    throw new Error('Effect requires an ID, name, data validator and ordinary behavior factory.');
  return definition;
}

export function effectModify<Input, Value>(
  query: QueryType<Input, Value>,
  contribution: (ctx: Context, input: Input) => Value | undefined,
): EffectModifier {
  return Object.freeze({
    query,
    contribution: (ctx: Context, input: unknown) => contribution(ctx, input as Input),
  });
}

/** 每局效果目录与普通数据实例。触发、纯查询、有限次数及显式入窗复用已有管线。 */
export class EffectBook implements TriggerSource {
  #definitions = new Map<string, EffectDefinition>();
  #attachments = new Map<WorldReader, object>();
  #sealed = false;

  register(definitions: readonly EffectDefinition[]): void {
    if (this.#sealed) throw new Error('Effect definitions are sealed after attachment.');
    const prepared = definitions.map(defineEffect);
    if (
      new Set(prepared.map((definition) => definition.id)).size !== prepared.length ||
      prepared.some((definition) => this.#definitions.has(definition.id))
    )
      throw new Error('Duplicate effect definition.');
    for (const definition of prepared) this.#definitions.set(definition.id, definition);
  }

  #definition(id: string): EffectDefinition {
    const definition = this.#definitions.get(id);
    if (!definition) throw new Error(`Unknown effect definition: ${id}`);
    return definition;
  }

  instances<Data>(
    world: WorldReader,
    definition: EffectDefinition<Data>,
  ): readonly EffectRecord<Data>[];
  instances(world: WorldReader): readonly EffectRecord[];
  instances(world: WorldReader, definition?: EffectDefinition): readonly EffectRecord[] {
    const records: EffectRecord[] = [];
    // 先校验完整效果列表，再按定义筛选，避免条件隐藏了非法记录。
    for (const state of world.snapshot.states)
      if (state.key === stateKey) records.push(this.#record(world, state));

    return definition ? records.filter((record) => record.type === definition.id) : records;
  }

  #record(world: WorldReader, entry: StateEntry): EffectRecord {
    const record = entry.value as EffectRecord;
    if (
      !record ||
      record.id !== entry.id ||
      record.scopeId !== entry.scopeId ||
      entry.owner !== null ||
      typeof record.type !== 'string' ||
      !(
        record.owner === null || world.snapshot.players.some((player) => player.id === record.owner)
      )
    )
      throw new Error('Invalid stored effect record.');
    if (!this.#definition(record.type).accepts(record.data))
      throw new Error(`Invalid effect data: ${record.type}`);
    return record;
  }

  attach(room: Room): () => void {
    if (this.#attachments.has(room.world)) throw new Error('Effect book is already attached.');
    if (hosts.has(room.world)) throw new Error('World already has an effect book.');
    this.instances(room.world);
    const registration = {};
    const removeSource = room.addTriggerSource(this);
    const removeExpiry = room.on(Lifetime.ended, {
      id: 'effects:lifetime',
      owner: null,
      eligible: (_ctx, ended) => ended.statesBefore.some((state) => state.key === stateKey),
      run: async (ctx, ended) => {
        // 同批记录已一起到期；单项后效的规则中止不撤销其余项的结束责任。
        for (const state of ended.statesBefore.filter((entry) => entry.key === stateKey))
          await ctx.attempt('effect.expire', (at) =>
            this.#finished(
              at,
              this.#record(at.world, state),
              `lifetime:${ended.kind}:${ended.exit}`,
            ),
          );
      },
    });
    const detach = () => {
      removeSource();
      removeExpiry();
      cancelCleanup();
      if (this.#attachments.get(room.world) === registration) {
        this.#attachments.delete(room.world);
        if (hosts.get(room.world) === this) hosts.delete(room.world);
      }
    };
    const cancelCleanup = room.onClose(detach);
    this.#attachments.set(room.world, registration);
    hosts.set(room.world, this);
    this.#sealed = true;
    return detach;
  }

  #assertWriting(ctx: Context): void {
    ctx.assertActive();
    if (!this.#attachments.has(ctx.world))
      throw new Error('Effect operation requires its attached World.');
  }

  #prepare<Data>(
    ctx: Context,
    definition: EffectDefinition<Data>,
    input: EffectInput<Data>,
  ): PreparedEffect<Data> {
    this.#assertWriting(ctx);
    if (isGameOver(ctx.world)) throw new Error('Cannot add an effect after game end.');
    const registered = this.#definition(definition.id);
    if (registered.create !== definition.create)
      throw new Error('Effect definition or data does not match the registered declaration.');
    const lifetime = ctx.query(() => input.lifetime ?? null);
    // 整份记录一次复制，保留 origin/data 的别名，并校验实际将提交的数据。
    const record: EffectRecord<Data> = ctx.query(() =>
      immutable({
        id: `effect:${ctx.cause.flowId}`,
        type: registered.id,
        owner: input.owner,
        origin: input.origin ?? null,
        scopeId: lifetime?.id ?? null,
        data: input.data,
      }),
    );
    if (!ctx.query(() => registered.accepts(record.data)))
      throw new Error('Effect definition or data does not match the registered declaration.');
    if (record.owner !== null) ctx.world.player(record.owner);
    assertLifetime(ctx, lifetime);
    return Object.freeze({
      record,
      change: immutable({
        kind: 'setState' as const,
        state: {
          id: record.id,
          key: stateKey,
          owner: null,
          source: definition.id,
          scopeId: record.scopeId,
          value: record,
        },
      }),
    });
  }

  prepare<Data>(
    ctx: Context,
    definition: EffectDefinition<Data>,
    input: EffectInput<Data>,
  ): Promise<PreparedEffect<Data>> {
    return ctx.flow('effect.prepare', (at) => this.#prepare(at, definition, input));
  }
  add<Data>(
    ctx: Context,
    definition: EffectDefinition<Data>,
    input: EffectInput<Data>,
  ): Promise<EffectRecord<Data>> {
    return ctx.flow('effect.add', async (at) => {
      const prepared = this.#prepare(at, definition, input);
      at.commit(Effect.added, [prepared.change], prepared.record);
      await at.window(
        Effect.added,
        prepared.record,
        prepared.record.owner === null ? {} : { subject: prepared.record.owner },
      );
      return prepared.record;
    });
  }

  update<Data>(ctx: Context, id: string, data: Data): Promise<EffectRecord<Data> | null> {
    return ctx.flow('effect.update', async (at) => {
      this.#assertWriting(at);
      const entry = at.world.state(id);
      if (entry?.key !== stateKey || isGameOver(at.world)) return null;
      const before = this.#record(at.world, entry);
      const after = at.query(() => immutable({ ...before, data })) as EffectRecord<Data>;
      if (!at.query(() => this.#definition(before.type).accepts(after.data)))
        throw new Error('Invalid updated effect data.');
      at.commit(Effect.changed, [{ kind: 'setState', state: { ...entry, value: after } }], {
        before,
        after,
      });
      await at.window(
        Effect.changed,
        { before, after },
        after.owner === null ? {} : { subject: after.owner },
      );
      return after;
    });
  }

  end(ctx: Context, id: string, reason: string): Promise<EffectRecord | null> {
    return ctx.flow('effect.end', async (at) => {
      this.#assertWriting(at);
      if (!reason.trim()) throw new Error('Effect end requires a reason.');
      const entry = at.world.state(id);
      if (entry?.key !== stateKey) return null;
      const before = this.#record(at.world, entry);
      at.commit(Effect.removed, [{ kind: 'removeState', state: id }], { before, reason });
      await this.#finished(at, before, reason);
      return before;
    });
  }

  async #finished(ctx: Context, before: EffectRecord, reason: string): Promise<void> {
    const ended = immutable({ before, reason });
    ctx.commit(Effect.ended, [], ended);
    await ctx.window(Effect.ended, ended, before.owner === null ? {} : { subject: before.owner });
    const onEnd = this.#definition(before.type).onEnd;
    if (onEnd) await ctx.flow('effect.after-end', (at) => onEnd(at, ended));
  }

  #handle(world: WorldReader, record: EffectRecord): EffectHandle {
    const registration = this.#attachments.get(world);
    const current = (at: WorldReader): EffectRecord | null => {
      if (
        at !== world ||
        registration === undefined ||
        this.#attachments.get(world) !== registration
      )
        return null;
      const entry = world.state(record.id);
      return entry?.key === stateKey ? this.#record(world, entry) : null;
    };
    const check = (ctx: Context) => {
      if (ctx.world !== world || this.#attachments.get(world) !== registration)
        throw new Error('Effect handle is outside its attachment.');
    };
    return Object.freeze({
      ...record,
      current,
      update: (ctx: Context, data: unknown) => {
        check(ctx);
        return this.update(ctx, record.id, data);
      },
      end: (ctx: Context, reason: string) => {
        check(ctx);
        return this.end(ctx, record.id, reason);
      },
    });
  }

  #behavior(self: EffectHandle): EffectBehavior {
    const behavior = this.#definition(self.type).create(self);
    if (
      new Set(behavior.triggers?.map((trigger) => trigger.id)).size !==
      (behavior.triggers?.length ?? 0)
    )
      throw new Error('Duplicate effect trigger.');
    return behavior;
  }

  collect<Payload>(
    type: Timing<Payload, unknown>,
    world: WorldReader,
  ): readonly Trigger<Payload>[] {
    if (!this.#attachments.has(world)) return [];
    return this.instances(world).flatMap((record) => {
      const self = this.#handle(world, record);
      return (this.#behavior(self).triggers ?? [])
        .filter((trigger) => trigger.window === type)
        .map((trigger): Trigger<Payload> => {
          // 入场身份/组/座次/次数固定；资格与普通闭包在执行前按最新数据重绑。
          const latest = (ctx: Context) => {
            const current = self.current(ctx.world);
            if (!current) return undefined;
            const bindingSelf = this.#handle(world, current);
            const binding = this.#behavior(bindingSelf)
              .triggers?.find((item) => item.id === trigger.id && item.window === type)
              ?.bind(bindingSelf);
            return binding;
          };
          return {
            ...trigger.bind(self),
            label: this.#definition(record.type).name,
            eligible: (ctx, payload, occurrence) =>
              latest(ctx)?.eligible(ctx, payload, occurrence) ?? false,
            async run(ctx, payload, occurrence) {
              const current = ctx.query(() => latest(ctx));
              if (current && ctx.query(() => current.eligible(ctx, payload, occurrence)))
                await current.run(ctx, payload, occurrence);
            },
          };
        });
    });
  }

  contributions<Input, Value>(
    ctx: Context,
    query: QueryType<Input, Value>,
    input: Input,
  ): readonly Value[] {
    return ctx.query(() => {
      if (!this.#attachments.has(ctx.world)) return [];
      return this.instances(ctx.world).flatMap((record) =>
        (this.#behavior(this.#handle(ctx.world, record)).modifiers ?? [])
          .filter((modifier) => modifier.query === query)
          .flatMap((modifier) => {
            // 数组本身不会暴露其中的 Promise，须在装入结果前检查单项。
            const value = modifier.contribution(ctx, input) as Value | undefined;
            return value === undefined ? [] : [value];
          }),
      );
    });
  }
}
