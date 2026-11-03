import { DecisionHub } from '../decisions/hub';
import type { DecisionResult, Decision } from '../decisions/hub';
import { Journal } from '../history/journal';
import type { Cause, Fact, HistoryReader } from '../history/journal';
import type { Change, WorldReader, WorldSeed } from '../model/state';
import { World } from '../state/world';
import { Random } from './random';
import { RuleAbort, Scope } from './scope';
import { AsyncQueryError, syncQueryValue } from './query';
import type {
  Trigger,
  TriggerSource,
  WindowOptions,
  Timing,
  TriggerOccurrence,
  ActionAnchor,
} from './event';

export type FlowBody<T> = (ctx: Context) => T | Promise<T>;

/** 主持入口与显式恢复边界的结果；普通规则函数直接返回 T。 */
export type FlowResult<T> =
  | { readonly kind: 'resolved'; readonly value: T }
  | { readonly kind: 'aborted'; readonly reason: string };

interface Operations {
  readonly assertWriting: () => void;
  readonly query: <T>(body: () => T) => T;
  readonly flow: <T>(kind: string, body: FlowBody<T>, reason: string) => Promise<FlowResult<T>>;
  readonly window: <T>(
    type: Timing<T, unknown>,
    payload: T,
    options: WindowOptions,
  ) => Promise<FlowResult<void>>;
  readonly ask: <T>(spec: Decision<T>) => Promise<DecisionResult<T>>;
  readonly commit: <T>(kind: string, changes: readonly Change[], detail: T) => Fact<T>;
  readonly random: (bound: number) => number;
  readonly actionOrder: (subject?: string) => readonly string[];
}

/** 显式因果上下文；一个上下文同一时刻只能等待一个子操作。 */
export class Context {
  #busy: string | null = null;

  constructor(
    readonly cause: Cause,
    private readonly lifetime: Scope,
    readonly world: WorldReader,
    readonly history: HistoryReader,
    private readonly operations: Operations,
  ) {}

  get scope(): Pick<Scope, 'id' | 'active'> {
    return this.lifetime;
  }

  /** 领域草案使用这个守卫；开放子窗口时草案仍可改，纯查询和关闭后不能改。 */
  assertActive(): void {
    this.operations.assertWriting();
    this.lifetime.assertActive();
  }

  /** 普通调用直接返回领域值；子流程中止会关闭当前作用域并继续向外传播。 */
  flow<T>(kind: string, body: FlowBody<T>, reason = kind): Promise<T> {
    return this.#wait(kind, async () =>
      this.#value(await this.operations.flow(kind, body, reason)),
    );
  }

  /** 显式恢复边界；只接住这个子作用域的规则中止，故障和整局关闭仍向外传播。 */
  attempt<T>(kind: string, body: FlowBody<T>, reason = kind): Promise<FlowResult<T>> {
    return this.#wait(kind, () => this.operations.flow(kind, body, reason));
  }

  window<T>(type: Timing<T, unknown>, payload: T, options: WindowOptions = {}): Promise<void> {
    const { subject, anchor, active } = options;
    const selection: WindowOptions = Object.freeze({
      ...(subject === undefined ? {} : { subject }),
      ...(anchor === undefined ? {} : { anchor }),
      ...(active === undefined ? {} : { active: active.bind(options) }),
    });
    return this.#wait(type.id, async () =>
      this.#value(await this.operations.window(type, payload, selection)),
    );
  }

  /** 按本局模式取得当前完整座次序，包含死亡席位；调用者再按实时资格筛选。 */
  actionOrder(subject?: string): readonly string[] {
    return this.query(() => this.operations.actionOrder(subject));
  }

  ask<T>(spec: Decision<T>): Promise<DecisionResult<T>> {
    return this.#wait('decision', () => this.operations.ask(spec));
  }

  /** 以事件时点为种类提交时，detail 必须符合该时点的载荷类型。 */
  commit<R>(kind: Timing<unknown, R>, changes: readonly Change[], detail: NoInfer<R>): Fact<R> {
    this.#assertIdle();
    return this.operations.commit(kind.id, changes, detail);
  }

  randomInt(bound: number): number {
    this.#assertIdle();
    return this.operations.random(bound);
  }

  /** 纯查询也可直接读 world；这个入口为组合查询添加运行时写入守卫。 */
  query<T>(body: () => T): T {
    this.lifetime.assertActive();
    return this.operations.query(body);
  }

  defer(cleanup: () => void): void {
    this.#assertIdle();
    this.lifetime.onClose(cleanup);
  }

  abort(reason: string): never {
    this.#assertIdle();
    this.lifetime.close(reason);
    throw new RuleAbort(reason);
  }

  /** 运行时出口检查，避免遗漏 await 的子操作逃出父流程。 */
  assertSettled(): void {
    if (this.#busy) throw new Error(`Unawaited child operation: ${this.#busy}`);
    this.lifetime.assertActive();
  }

  #assertIdle(): void {
    this.operations.assertWriting();
    this.lifetime.assertActive();
    if (this.#busy) throw new Error(`Concurrent rule operation while waiting for ${this.#busy}.`);
  }

  #value<T>(result: FlowResult<T>): T {
    if (result.kind === 'resolved') return result.value;
    // 与显式 abort 相同：作者 catch 异常也不能恢复已经中止的上下文。
    this.lifetime.close(result.reason);
    throw new RuleAbort(result.reason);
  }

  #wait<T>(kind: string, work: () => Promise<T>): Promise<T> {
    this.#assertIdle();
    this.#busy = kind;
    let pending: Promise<T>;
    try {
      pending = work();
    } catch (error) {
      this.#busy = null;
      throw error;
    }
    const result = pending.then(
      (value) => {
        this.#busy = null;
        this.operations.assertWriting();
        this.lifetime.assertActive();
        return value;
      },
      (error: unknown) => {
        this.#busy = null;
        throw error;
      },
    );
    // 即使作者漏 await，错误也由父出口/Room 故障诊断接住，不产生游离拒绝。
    result.catch(() => undefined);
    return result;
  }
}

interface Registration {
  readonly label: string;
  readonly token: object;
  readonly id: string;
  readonly owner: string | null;
  readonly group: string;
  readonly order: 'automatic' | 'choose';
  active: boolean;
  readonly times?: (ctx: Context, payload: unknown) => number;
  readonly eligible: (ctx: Context, payload: unknown, occurrence: TriggerOccurrence) => boolean;
  readonly run: (ctx: Context, payload: unknown, occurrence: TriggerOccurrence) => unknown;
}
interface WindowCandidate {
  readonly registration: Registration;
  readonly id: string;
  readonly label: string;
  readonly occurrence: TriggerOccurrence;
}

export interface RoomOptions {
  readonly id: string;
  readonly seed: number;
  readonly world: WorldSeed;
  /** 本局模式的默认起点；未安装时按主体回退。特殊窗口可显式覆盖。 */
  readonly actionAnchor?: ActionAnchor;
}

/** 每局独立的执行者。没有全局 currentRoom/currentEvent，也没有 UI 或计时器依赖。 */
export class Room {
  readonly history = new Journal();
  readonly decisions: DecisionHub;
  readonly world: WorldReader;
  #state: World;
  #random: Random;
  #lifetime: Scope;
  #status: 'ready' | 'running' | 'faulted' | 'ended' = 'ready';
  #failure: unknown;
  #nextFlow = 0;
  #queryDepth = 0;
  #id: string;
  #windows = new Map<string, object>();
  #triggers = new Map<string, Registration>();
  #sources = new Map<TriggerSource, object>();
  #finishReason: string | null = null;
  #actionAnchor: ActionAnchor | null;

  constructor(options: RoomOptions) {
    if (!options.id) throw new Error('Room requires a stable ID.');
    this.#id = options.id;
    this.#actionAnchor = options.actionAnchor ?? null;
    this.#state = new World(options.world);
    this.world = this.#state.reader;
    this.#random = new Random(options.seed);
    this.#lifetime = new Scope(`${options.id}:match`, null);
    this.decisions = new DecisionHub(
      options.id,
      this.world,
      this.history,
      (body, cause) => this.#query(body, cause),
      (error, cause) => this.#freeze(error, cause),
    );
  }

  get status(): 'ready' | 'running' | 'faulted' | 'ended' {
    return this.#status;
  }

  /** 同步只读投影；不启动流程、不消费随机源或因果编号，返回后上下文立即关闭。 */
  inspect<T>(body: (ctx: Context) => T): T {
    const scope = new Scope(`${this.#id}:inspection`, null);
    const deny = (): never => {
      throw new Error('Inspection is read-only.');
    };
    const cause: Cause = Object.freeze({
      flowId: `${this.#id}:inspection`,
      parentFlowId: null,
      scopeId: scope.id,
      scopePath: scope.path,
      reason: 'inspection',
    });
    const ctx: Context = new Context(cause, scope, this.world, this.history, {
      assertWriting: deny,
      query: (read) => this.#query(read),
      actionOrder: (subject) => this.#actionOrder(ctx, subject),
      flow: deny,
      window: deny,
      ask: deny,
      commit: deny,
      random: deny,
    });
    try {
      return this.#query(() => body(ctx));
    } finally {
      scope.close('Inspection finished.');
    }
  }

  run<T>(kind: string, body: FlowBody<T>): Promise<FlowResult<T>> {
    if (this.#status !== 'ready') throw new Error(`Room cannot start a flow: ${this.#status}`);
    this.#assertWriting();
    this.#status = 'running';
    const result = this.#execute(this.#lifetime, null, kind, body, kind).finally(() => {
      if (this.#status === 'running') {
        if (this.#finishReason !== null) this.#finish();
        else this.#status = 'ready';
      }
    });
    result.catch(() => undefined);
    return result;
  }

  /** 停止新决策，当前根流程完成善后后再关闭；与立即 abort 分开。 */
  finish(reason: string): void {
    if (this.#status === 'ended' || this.#status === 'faulted' || this.#finishReason !== null)
      return;
    this.#assertWriting();
    if (!reason) throw new Error('Finishing a room requires a reason.');
    this.#finishReason = reason;
    this.decisions.stop(reason);
    if (this.#status === 'ready') this.#finish();
  }

  #finish(): void {
    this.#status = 'ended';
    try {
      this.#lifetime.close(this.#finishReason ?? 'Room finished.');
    } catch (error) {
      this.#freeze(error, {
        flowId: `${this.#id}:control`,
        parentFlowId: null,
        scopeId: this.#lifetime.id,
        scopePath: this.#lifetime.path,
        reason: 'finish',
      });
      throw error;
    }
  }

  /** 终止整局，关闭全部等待；结束后的 Room 不允许再次进入。 */
  abort(reason: string): void {
    if (this.#status === 'ended' || this.#status === 'faulted') return;
    this.#assertWriting();
    this.#status = 'ended';
    try {
      this.#lifetime.close(reason);
    } catch (error) {
      this.#freeze(error, {
        flowId: `${this.#id}:control`,
        parentFlowId: null,
        scopeId: this.#lifetime.id,
        scopePath: this.#lifetime.path,
        reason,
      });
      throw error;
    }
  }

  on<T>(type: Timing<T, unknown>, trigger: Trigger<T>): () => void {
    this.#assertWriting();
    this.#checkWindow(type);
    if (!trigger.id || this.#triggers.has(trigger.id))
      throw new Error(`Duplicate trigger: ${trigger.id}`);
    const group = trigger.group ?? 'main';
    if (!type.groups.includes(group)) throw new Error(`Unknown window group: ${group}`);
    if (trigger.owner !== null) this.world.player(trigger.owner);
    if (trigger.owner === null && trigger.order === 'choose')
      throw new Error('Ordered choice requires an owner.');
    const entry: Registration = {
      token: type,
      id: trigger.id,
      label: trigger.label ?? trigger.id,
      owner: trigger.owner,
      group,
      order: trigger.order ?? 'automatic',
      active: true,
      ...(trigger.times === undefined
        ? {}
        : { times: (ctx: Context, payload: unknown) => trigger.times!(ctx, payload as T) }),
      // token 的对象身份保证这里只会接收声明的 T。
      eligible: (ctx, payload, occurrence) => trigger.eligible(ctx, payload as T, occurrence),
      run: (ctx, payload, occurrence) => trigger.run(ctx, payload as T, occurrence),
    };
    this.#triggers.set(entry.id, entry);
    return () => {
      // 违规查询已冻结本局时，资源清理仍须能够注销；新规则写入仍被拒绝。
      if (this.#queryDepth && this.#status !== 'faulted')
        throw new Error('Pure queries cannot unregister triggers.');
      entry.active = false;
      if (this.#triggers.get(entry.id) === entry) this.#triggers.delete(entry.id);
    };
  }

  addTriggerSource(source: TriggerSource): () => void {
    this.#assertWriting();
    if (this.#sources.has(source)) throw new Error('Trigger source is already installed.');
    const registration = {};
    this.#sources.set(source, registration);
    return () => {
      if (this.#queryDepth && this.#status !== 'faulted')
        throw new Error('Pure queries cannot unregister trigger sources.');
      if (this.#sources.get(source) === registration) this.#sources.delete(source);
    };
  }

  /** 执行侧资源随整局结束清理；与会生成规则事实的异步善后分开。 */
  onClose(cleanup: () => void): () => void {
    this.#assertWriting();
    const remove = this.#lifetime.onClose(cleanup);
    return () => {
      if (this.#queryDepth && this.#status !== 'faulted')
        throw new Error('Pure queries cannot unregister Room cleanup.');
      remove();
    };
  }

  #assertWriting(): void {
    if (this.#status === 'faulted') throw this.#failure;
    this.#lifetime.assertActive();
    if (this.#queryDepth) throw new Error('Pure queries cannot perform rule operations.');
  }

  #query<T>(body: () => T, cause?: Cause): T {
    this.#queryDepth++;
    try {
      return syncQueryValue(body());
    } catch (error) {
      // 包括组合回调中的违规结果，须在已排队的续体恢复之前冻结执行侧。
      if (cause && error instanceof AsyncQueryError) this.#freeze(error, cause);
      throw error;
    } finally {
      this.#queryDepth--;
    }
  }

  #freeze(error: unknown, cause: Cause): void {
    if (this.#status === 'faulted') return;
    this.#failure = error;
    this.#status = 'faulted';
    this.history.trace(cause, 'fault', {
      message: error instanceof Error ? error.message : String(error),
    });
    try {
      this.#lifetime.close('Room faulted.');
    } catch {
      /* 保留最初故障，资源清理已逐项尝试。 */
    }
  }

  async #execute<T>(
    parent: Scope,
    parentCause: Cause | null,
    kind: string,
    body: FlowBody<T>,
    reason: string,
  ): Promise<FlowResult<T>> {
    this.#assertWriting();
    parent.assertActive();
    const id = ++this.#nextFlow;
    const scope = new Scope(`${this.#id}:scope:${id}`, parent);
    const cause: Cause = Object.freeze({
      flowId: `${this.#id}:flow:${id}`,
      parentFlowId: parentCause?.flowId ?? null,
      scopeId: scope.id,
      scopePath: scope.path,
      reason,
    });
    this.history.trace(cause, 'flow.open', { kind });
    const ctx: Context = new Context(cause, scope, this.world, this.history, {
      assertWriting: () => this.#assertWriting(),
      query: (query) => this.#query(query, cause),
      actionOrder: (subject) => this.#actionOrder(ctx, subject),
      flow: (childKind, childBody, childReason) =>
        this.#execute(scope, cause, childKind, childBody, childReason),
      window: (type, payload, options) =>
        this.#execute(
          scope,
          cause,
          `window:${type.id}`,
          (child) => this.#openWindow(child, type, payload, options),
          type.id,
        ),
      ask: (spec) => this.decisions.open(spec, scope, cause),
      commit: (factKind, changes, detail) => {
        const fact = this.#query(
          () =>
            this.history.prepare(
              cause,
              this.world.snapshot.revision + 1,
              factKind,
              changes,
              detail,
            ),
          cause,
        );
        const prepared = this.#state.prepare(fact.data.changes);
        this.history.append(fact);
        this.#state.apply(prepared);
        return fact;
      },
      random: (bound) => {
        const value = this.#random.integer(bound);
        this.history.trace(cause, 'random', { bound, value });
        return value;
      },
    });
    let outcome = 'faulted';
    let result: FlowResult<T> | null = null;
    let failure: { readonly error: unknown } | null = null;
    try {
      const value = await body(ctx);
      ctx.assertSettled();
      this.#assertWriting();
      outcome = 'resolved';
      result = { kind: 'resolved', value };
    } catch (error) {
      if (error instanceof RuleAbort && this.#status !== 'faulted') {
        outcome = 'aborted';
        result = { kind: 'aborted', reason: error.reason };
      } else {
        this.#freeze(error, cause);
        failure = { error };
      }
    }

    // 释放失败也要冻结，但不覆盖已经捕获的原始内容错误。
    try {
      scope.close();
    } catch (error) {
      if (!failure) {
        this.#freeze(error, cause);
        failure = { error };
      }
      outcome = 'faulted';
    }
    this.history.trace(cause, 'flow.close', {
      kind,
      outcome,
      ...(result?.kind === 'aborted' ? { reason: result.reason } : {}),
    });
    if (failure) throw failure.error;
    if (!result) throw new Error('Flow exited without an outcome.');
    return result;
  }

  #checkWindow<T>(type: Timing<T, unknown>): void {
    const known = this.#windows.get(type.id);
    if (known && known !== type) throw new Error(`Two window definitions share ID: ${type.id}`);
    this.#windows.set(type.id, type);
  }

  #collectSource<T>(
    ctx: Context,
    type: Timing<T, unknown>,
    payload: T,
    source: TriggerSource,
  ): Registration[] {
    const registration = this.#sources.get(source);
    if (!registration) throw new Error('Window source is not attached to this Room.');
    const candidates = ctx.query(() => source.collect(type, this.world, payload));
    return candidates.map((candidate) => {
      if (!candidate.id || (candidate.owner === null && candidate.order === 'choose'))
        throw new Error('Invalid sourced trigger identity or owner.');
      if (candidate.owner !== null) this.world.player(candidate.owner);
      const group = candidate.group ?? 'main';
      if (!type.groups.includes(group)) throw new Error(`Unknown window group: ${group}`);
      return {
        token: type,
        id: candidate.id,
        label: candidate.label ?? candidate.id,
        owner: candidate.owner,
        group,
        order: candidate.order ?? 'automatic',
        active: true,
        ...(candidate.times === undefined
          ? {}
          : {
              times: (child: Context, data: unknown) => candidate.times!(child, data as T),
            }),
        eligible: (child, data, occurrence) =>
          this.#sources.get(source) === registration &&
          candidate.eligible(child, data as T, occurrence),
        run: (child, data, occurrence) => candidate.run(child, data as T, occurrence),
      };
    });
  }

  #actionOrder(ctx: Context, subject?: string, override?: string): readonly string[] {
    const seats = this.world.snapshot.players.map((player) => player.id);
    if (subject !== undefined && !seats.includes(subject))
      throw new Error(`Unknown action-order subject: ${subject}`);
    const preferred =
      override !== undefined
        ? override
        : this.#actionAnchor
          ? this.#actionAnchor(ctx, subject ?? null)
          : null;
    if (preferred !== null && !seats.includes(preferred))
      throw new Error(`Unknown action-order anchor: ${preferred}`);
    const anchor = preferred ?? subject ?? seats[0];
    const index = anchor === undefined ? 0 : seats.indexOf(anchor);
    return Object.freeze([...seats.slice(index), ...seats.slice(0, index)]);
  }

  async #openWindow<T>(
    ctx: Context,
    type: Timing<T, unknown>,
    payload: T,
    options: WindowOptions,
  ): Promise<void> {
    this.#checkWindow(type);
    {
      const isOpen = () => {
        if (!options.active) return true;
        const active = ctx.query(() => options.active!(ctx));
        if (typeof active !== 'boolean') throw new Error('Window active must return a boolean.');
        return active;
      };
      const stopped = () => {
        if (!options.active || isOpen()) return false;
        this.history.trace(ctx.cause, 'window.stopped', { window: type.id });
        return true;
      };
      if (stopped()) return;
      // 入窗即固定本次行动序；嵌套回合或回调改变模式的后续结果都不倒排本窗口。
      const order = ctx.query(() => this.#actionOrder(ctx, options.subject, options.anchor));
      this.history.trace(ctx.cause, 'window.order', {
        window: type.id,
        subject: options.subject ?? null,
        anchor: order[0] ?? null,
        override: options.anchor !== undefined,
      });
      const registrations = [...this.#triggers.values()].filter((entry) => entry.token === type);
      for (const source of this.#sources.keys()) {
        registrations.push(...this.#collectSource(ctx, type, payload, source));
      }
      if (new Set(registrations.map((candidate) => candidate.id)).size !== registrations.length)
        throw new Error('Duplicate window candidate ID.');
      // 每个候选入队时只读一次，成为有限快照；普通后效不自动发现或增加次数。
      const occurrences = (registration: Registration): WindowCandidate[] => {
        const total = ctx.query(() =>
          registration.times === undefined ? 1 : registration.times(ctx, payload),
        );
        if (!Number.isSafeInteger(total) || total < 0)
          throw new Error('Trigger times must be a nonnegative safe integer.');
        return Array.from({ length: total }, (_, offset) => {
          const index = offset + 1;
          return {
            registration,
            id: registration.times ? JSON.stringify([registration.id, index]) : registration.id,
            label: total > 1 ? `${registration.label} · ${index}/${total}` : registration.label,
            occurrence: Object.freeze({
              id: JSON.stringify([ctx.cause.flowId, registration.id, index]),
              index,
              total,
            }),
          };
        });
      };
      const snapshot = registrations.flatMap(occurrences);
      if (new Set(snapshot.map((candidate) => candidate.id)).size !== snapshot.length)
        throw new Error('Duplicate window occurrence ID.');
      const owners = [null, ...order];
      const queues: WindowCandidate[][] = type.groups.flatMap((group) =>
        owners.map((owner) =>
          snapshot.filter(
            (entry) => entry.registration.group === group && entry.registration.owner === owner,
          ),
        ),
      );
      const eligible = (entry: WindowCandidate) =>
        entry.registration.active &&
        ctx.query(() => entry.registration.eligible(ctx, payload, entry.occurrence));
      const trace = (entry: WindowCandidate, outcome: 'ineligible' | 'running') =>
        this.history.trace(ctx.cause, 'window.candidate', {
          window: type.id,
          effect: entry.id,
          source: entry.registration.id,
          occurrence: entry.occurrence,
          outcome,
        });

      for (let cursor = 0; cursor < queues.length; cursor++) {
        const owner = owners[cursor % owners.length]!;
        const pending = queues[cursor]!;
        while (pending.length) {
          pending.sort((a, b) =>
            a.registration.id < b.registration.id
              ? -1
              : a.registration.id > b.registration.id
                ? 1
                : a.occurrence.index - b.occurrence.index,
          );
          if (stopped()) return;
          // 每个效果只开放最早合资格的一次。预览不消费其前面的失效次数；
          // 其他效果可能先改变条件，只有选定本效果时才正式跳过该前缀。
          const offered = new Set<Registration>();
          const prefixes = new Map<Registration, WindowCandidate[]>();
          const frontier: WindowCandidate[] = [];
          for (const entry of pending) {
            if (offered.has(entry.registration)) continue;
            if (eligible(entry)) {
              frontier.push(entry);
              offered.add(entry.registration);
            } else {
              const prefix = prefixes.get(entry.registration) ?? [];
              prefix.push(entry);
              prefixes.set(entry.registration, prefix);
            }
          }
          // 当前组/席位没有可执行者便收束，过去的组与席位不回头。
          if (!frontier.length) {
            for (const entry of pending) trace(entry, 'ineligible');
            break;
          }
          let selected =
            frontier.find((entry) => entry.registration.order === 'automatic') ?? frontier[0];
          if (!selected) break;
          if (selected.registration.order === 'choose' && frontier.length > 1 && owner !== null) {
            const ids = frontier.map((entry) => entry.id);
            const reply = await ctx.ask({
              player: owner,
              kind: 'trigger-order',
              prompt: '选择先结算的效果',
              data: {
                window: type.id,
                options: ids,
                labels: Object.fromEntries(frontier.map((trigger) => [trigger.id, trigger.label])),
                occurrences: Object.fromEntries(
                  frontier.map((entry) => [
                    entry.id,
                    { source: entry.registration.id, ...entry.occurrence },
                  ]),
                ),
              },
              optional: false,
              validate: (input) =>
                typeof input === 'string' && ids.includes(input)
                  ? { ok: true, value: input }
                  : { ok: false, reason: 'Choose a pending effect.' },
            });
            if (reply.kind !== 'chosen') return;
            selected = frontier.find((entry) => entry.id === reply.value);
            if (!selected) throw new Error('Invalid trigger ordering reply.');
          }
          if (stopped()) return;
          const candidate = selected;
          const skipped = prefixes.get(candidate.registration) ?? [];
          const consumed = new Set([candidate, ...skipped]);
          for (let index = pending.length - 1; index >= 0; index--)
            if (consumed.has(pending[index]!)) pending.splice(index, 1);
          for (const entry of skipped) trace(entry, 'ineligible');
          if (!eligible(candidate)) {
            trace(candidate, 'ineligible');
            continue;
          }
          trace(candidate, 'running');
          // 单个候选的局部中止不取消整个窗口，后续候选仍按实时资格继续。
          await ctx.attempt(
            `trigger:${candidate.id}`,
            (child) => candidate.registration.run(child, payload, candidate.occurrence),
            candidate.registration.id,
          );
          if (stopped()) return;
        }
      }
    }
  }
}
