import type { Change } from '../model/state';
import { immutable } from '../model/value';
import type { DeepReadonly } from '../model/value';
import type { Timing } from '../runtime/event';

export interface Cause {
  readonly flowId: string;
  readonly parentFlowId: string | null;
  readonly scopeId: string;
  readonly scopePath: readonly string[];
  readonly reason: string;
}

export type TraceKind =
  | 'flow.open'
  | 'flow.close'
  | 'window.candidate'
  | 'window.order'
  | 'window.stopped'
  | 'window.included'
  | 'decision.open'
  | 'decision.close'
  | 'random'
  | 'fault';

export interface Trace extends Cause {
  readonly seq: number;
  readonly type: TraceKind;
  readonly data: unknown;
}

export interface Fact<T = unknown> extends Cause {
  readonly seq: number;
  readonly type: 'commit';
  readonly data: {
    readonly kind: string;
    readonly detail: DeepReadonly<T>;
    readonly revision: number;
    readonly changes: readonly Change[];
  };
}

export type JournalEntry = Trace | Fact;

/** 历史记录的种类：事件时点本身（带类型）或其序列化 id。 */
export type FactKind = Timing<unknown, unknown> | string;
export const factKind = (kind: FactKind): string => (typeof kind === 'string' ? kind : kind.id);

/** 按事件时点收窄一条历史记录的载荷类型。 */
export const isFact = <R>(fact: Fact, kind: Timing<unknown, R>): fact is Fact<R> =>
  fact.data.kind === kind.id;

export interface HistoryReader {
  readonly entries: readonly JournalEntry[];
  facts<R>(kind: Timing<unknown, R>, withinScope?: string): readonly Fact<R>[];
  facts(kind?: string, withinScope?: string): readonly Fact[];
}

/** 单调序号与父子因果分别保存；中文叙事不参与状态还原。 */
export class Journal {
  #entries: JournalEntry[] = [];
  // 与总历史共享同一冻结事实；按种类查询不必反复扫描流程轨迹。
  #facts: Fact[] = [];
  #factsByKind = new Map<string, Fact[]>();
  #observers = new Set<() => void>();
  #scheduled = false;

  /** 批量异步通知观察者，不在提交中执行 UI 或其他外部代码。取消后不再接收通知。 */
  subscribe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => {
      this.#observers.delete(observer);
    };
  }

  #notify(): void {
    if (this.#scheduled || !this.#observers.size) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      for (const observer of [...this.#observers]) if (this.#observers.has(observer)) observer();
    });
  }

  get entries(): readonly JournalEntry[] {
    return Object.freeze([...this.#entries]);
  }

  facts<R>(kind: Timing<unknown, R>, withinScope?: string): readonly Fact<R>[];
  facts(kind?: string, withinScope?: string): readonly Fact[];
  facts(kind?: FactKind, withinScope?: string): readonly Fact[] {
    const facts = kind === undefined ? this.#facts : (this.#factsByKind.get(factKind(kind)) ?? []);
    return Object.freeze(
      withinScope === undefined
        ? [...facts]
        : facts.filter((fact) => fact.scopePath.includes(withinScope)),
    );
  }

  trace(cause: Cause, type: TraceKind, data: unknown): Trace {
    const entry = immutable({ ...cause, seq: this.#entries.length + 1, type, data });
    this.#entries.push(entry);
    if (type === 'decision.open' || type === 'decision.close' || type === 'fault') this.#notify();
    return entry;
  }

  /** 先快照完整事实；调用方在只读边界执行，再以同一份变化准备状态。 */
  prepare<T>(
    cause: Cause,
    revision: number,
    kind: string,
    changes: readonly Change[],
    detail: T,
  ): Fact<T> {
    return immutable({
      ...cause,
      seq: this.#entries.length + 1,
      type: 'commit',
      data: { kind, revision, changes, detail },
    });
  }

  /** 状态准备成功后发布；不在输入复制中写入部分事实。 */
  append(fact: Fact): void {
    if (fact.seq !== this.#entries.length + 1) throw new Error('Prepared fact sequence is stale.');
    this.#entries.push(fact);
    this.#facts.push(fact);
    const kind = fact.data.kind;
    const sameKind = this.#factsByKind.get(kind) ?? [];
    if (!this.#factsByKind.has(kind)) this.#factsByKind.set(kind, sameKind);
    sameKind.push(fact);
    this.#notify();
  }
}
