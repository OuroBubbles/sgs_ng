import type { Change, StateEntry, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { DeepReadonly } from '../../core/model/value';
import type { Context, FlowResult, Room } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import type {
  Trigger,
  TriggerSource,
  TriggerOccurrence,
  WindowType,
  WindowRef,
  WindowAdmission,
} from '../../core/runtime/window';
import { assertLifetime, lifetimeEnded } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';
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
export interface EffectHandle<Data = unknown> extends EffectRecord<Data> {
  /** data 在实例仍存在时读取最新值；结束后的普通后续保留本次绑定快照。 */
  active(world: WorldReader): boolean;
  update(ctx: Context, data: Data): Promise<FlowResult<EffectRecord<Data> | null>>;
  end(ctx: Context, reason: string): Promise<FlowResult<boolean>>;
}
export interface EffectTrigger {
  readonly id: string;
  readonly window: object;
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
  readonly accepts: (data: unknown) => data is Data;
  /** 在纯收集/查询中以普通闭包绑定实例；条件和分支不需要配置模板。 */
  create(self: EffectHandle<Data>): EffectBehavior;
  /** 状态已结束、通用结束窗口已完成后的普通后续，不恢复效果资格。 */
  onEnd?(ctx: Context, before: EffectRecord<Data>, reason: string): void | Promise<void>;
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
export interface EffectEnd {
  readonly before: EffectRecord;
  readonly reason: string;
}
export const effectAdded = defineWindow<EffectRecord>('effect.added');
export const effectChanged = defineWindow<{
  readonly before: EffectRecord;
  readonly after: EffectRecord;
}>('effect.changed');
export const effectEnded = defineWindow<EffectEnd>('effect.ended');

export function defineEffect<Data>(definition: EffectDefinition<Data>): EffectDefinition<Data> {
  if (
    !definition.id.trim() ||
    !definition.name.trim() ||
    typeof definition.accepts !== 'function' ||
    typeof definition.create !== 'function'
  )
    throw new Error('Effect requires an ID, name, data validator and ordinary behavior factory.');
  return Object.freeze({ ...definition });
}

/** 只描述一个普通触发；身份、生存资格、行动序与有限次数仍走原有 Window。 */
export function effectOn<Payload>(
  window: WindowType<Payload>,
  input: {
    readonly id: string;
    readonly group?: string;
    readonly order?: 'automatic' | 'choose';
    readonly times?: (ctx: Context, payload: Payload) => number;
    readonly when?: (ctx: Context, payload: Payload, occurrence: TriggerOccurrence) => boolean;
    readonly run: (
      ctx: Context,
      payload: Payload,
      occurrence: TriggerOccurrence,
    ) => void | Promise<void>;
  },
): EffectTrigger {
  if (!input.id) throw new Error('Effect trigger requires an ID.');
  const handler = Object.freeze({ ...input });
  return Object.freeze({
    id: handler.id,
    window,
    bind: (self: EffectHandle): Trigger<unknown> => ({
      id: JSON.stringify([self.id, handler.id]),
      owner: self.owner,
      label: self.type,
      ...(handler.group === undefined ? {} : { group: handler.group }),
      ...(handler.order === undefined ? {} : { order: handler.order }),
      ...(handler.times === undefined
        ? {}
        : { times: (ctx, value) => handler.times!(ctx, value as Payload) }),
      eligible: (ctx, value, occurrence) =>
        self.active(ctx.world) && (handler.when?.(ctx, value as Payload, occurrence) ?? true),
      run: (ctx, value, occurrence) => handler.run(ctx, value as Payload, occurrence),
    }),
  });
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
    if (
      new Set(definitions.map((definition) => definition.id)).size !== definitions.length ||
      definitions.some((definition) => this.#definitions.has(definition.id))
    )
      throw new Error('Duplicate effect definition.');
    const prepared = definitions.map(
      (definition) => [definition.id, defineEffect(definition)] as const,
    );
    this.#definitions = new Map([...this.#definitions, ...prepared]);
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
    return world.snapshot.states
      .filter((state) => state.key === stateKey)
      .map((state) => this.#record(world, state))
      .filter((record) => !definition || record.type === definition.id);
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
    const removeExpiry = room.on(lifetimeEnded, {
      id: 'effects:lifetime',
      owner: null,
      eligible: (_ctx, ended) => ended.statesBefore.some((state) => state.key === stateKey),
      run: async (ctx, ended) => {
        for (const state of ended.statesBefore.filter((entry) => entry.key === stateKey))
          await this.#finished(
            ctx,
            this.#record(ctx.world, state),
            `lifetime:${ended.kind}:${ended.exit}`,
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
    if (registered.create !== definition.create || !ctx.query(() => registered.accepts(input.data)))
      throw new Error('Effect definition or data does not match the registered declaration.');
    if (input.owner !== null) ctx.world.player(input.owner);
    assertLifetime(ctx, input.lifetime ?? null);
    const record: EffectRecord<Data> = immutable({
      id: `effect:${ctx.cause.flowId}`,
      type: definition.id,
      owner: input.owner,
      origin: input.origin ?? null,
      scopeId: input.lifetime?.id ?? null,
      data: input.data,
    }) as EffectRecord<Data>;
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
  ): Promise<FlowResult<PreparedEffect<Data>>> {
    return ctx.flow('effect.prepare', (at) => this.#prepare(at, definition, input));
  }
  add<Data>(
    ctx: Context,
    definition: EffectDefinition<Data>,
    input: EffectInput<Data>,
  ): Promise<FlowResult<EffectRecord<Data>>> {
    return ctx.flow('effect.add', async (at) => {
      const prepared = this.#prepare(at, definition, input);
      at.commit('effect.added', [prepared.change], prepared.record);
      await at.window(
        effectAdded,
        prepared.record,
        prepared.record.owner === null ? {} : { subject: prepared.record.owner },
      );
      return prepared.record;
    });
  }

  update<Data>(
    ctx: Context,
    id: string,
    data: Data,
  ): Promise<FlowResult<EffectRecord<Data> | null>> {
    return ctx.flow('effect.update', async (at) => {
      this.#assertWriting(at);
      const entry = at.world.snapshot.states.find(
        (state) => state.key === stateKey && state.id === id,
      );
      if (!entry || isGameOver(at.world)) return null;
      const before = this.#record(at.world, entry);
      if (!at.query(() => this.#definition(before.type).accepts(data)))
        throw new Error('Invalid updated effect data.');
      const after = immutable({ ...before, data }) as EffectRecord<Data>;
      at.commit('effect.changed', [{ kind: 'setState', state: { ...entry, value: after } }], {
        before,
        after,
      });
      await at.window(
        effectChanged,
        { before, after },
        after.owner === null ? {} : { subject: after.owner },
      );
      return after;
    });
  }

  end(ctx: Context, id: string, reason: string): Promise<FlowResult<boolean>> {
    return ctx.flow('effect.end', async (at) => {
      this.#assertWriting(at);
      if (!reason.trim()) throw new Error('Effect end requires a reason.');
      const entry = at.world.snapshot.states.find(
        (state) => state.key === stateKey && state.id === id,
      );
      if (!entry) return false;
      const before = this.#record(at.world, entry);
      at.commit('effect.removed', [{ kind: 'removeState', state: id }], { before, reason });
      await this.#finished(at, before, reason);
      return true;
    });
  }

  async #finished(ctx: Context, before: EffectRecord, reason: string): Promise<void> {
    const ended = immutable({ before, reason });
    ctx.commit('effect.ended', [], ended);
    await ctx.window(effectEnded, ended, before.owner === null ? {} : { subject: before.owner });
    const onEnd = this.#definition(before.type).onEnd;
    if (onEnd) ctx.unwrap(await ctx.flow('effect.after-end', (at) => onEnd(at, before, reason)));
  }

  #handle(world: WorldReader, record: EffectRecord): EffectHandle {
    const registration = this.#attachments.get(world);
    const current = () =>
      world.snapshot.states.find((state) => state.key === stateKey && state.id === record.id)
        ?.value as EffectRecord | undefined;
    const active = (at: WorldReader) =>
      at === world &&
      registration !== undefined &&
      this.#attachments.get(world) === registration &&
      current() !== undefined;
    const check = (ctx: Context) => {
      if (ctx.world !== world || this.#attachments.get(world) !== registration)
        throw new Error('Effect handle is outside its attachment.');
    };
    return Object.freeze({
      ...record,
      get data() {
        return (current() ?? record).data;
      },
      active,
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

  #behavior(world: WorldReader, record: EffectRecord): EffectBehavior {
    const behavior = this.#definition(record.type).create(this.#handle(world, record));
    if (
      new Set(behavior.triggers?.map((trigger) => trigger.id)).size !==
      (behavior.triggers?.length ?? 0)
    )
      throw new Error('Duplicate effect trigger.');
    return behavior;
  }

  collect<Payload>(type: WindowType<Payload>, world: WorldReader): readonly Trigger<Payload>[] {
    if (!this.#attachments.has(world)) return [];
    return this.instances(world).flatMap((record) => {
      const self = this.#handle(world, record);
      return (this.#behavior(world, record).triggers ?? [])
        .filter((trigger) => trigger.window === type)
        .map((trigger): Trigger<Payload> => {
          // 入场身份/组/座次/次数固定；资格与普通闭包在执行前按最新数据重绑。
          const latest = (ctx: Context) =>
            self.active(ctx.world)
              ? this.#behavior(world, record)
                  .triggers?.find((current) => current.id === trigger.id && current.window === type)
                  ?.bind(self)
              : undefined;
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
        (this.#behavior(ctx.world, record).modifiers ?? [])
          .filter((modifier) => modifier.query === query)
          .flatMap((modifier) => {
            const value = modifier.contribution(ctx, input) as Value | undefined;
            return value === undefined ? [] : [value];
          }),
      );
    });
  }

  include<Payload>(
    ctx: Context,
    window: WindowRef<Payload>,
    instances?: readonly string[],
  ): WindowAdmission {
    if (instances === undefined) return ctx.include(window, this);
    const ids = new Set(instances);
    const triggers = new Set(
      ctx.query(() =>
        this.instances(ctx.world)
          .filter((record) => ids.has(record.id))
          .flatMap((record) =>
            (this.#behavior(ctx.world, record).triggers ?? [])
              .filter((trigger) => trigger.window === window.type)
              .map((trigger) => trigger.bind(this.#handle(ctx.world, record)).id),
          ),
      ),
    );
    return ctx.include(window, this, (trigger) => triggers.has(trigger.id));
  }
}
