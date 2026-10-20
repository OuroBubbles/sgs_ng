import type { Change } from '../model/state';
import { immutable } from '../model/value';

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
    readonly detail: T;
    readonly revision: number;
    readonly changes: readonly Change[];
  };
}

export type JournalEntry = Trace | Fact;

export interface HistoryReader {
  readonly entries: readonly JournalEntry[];
  facts(kind?: string, withinScope?: string): readonly Fact[];
}

/** 单调序号与父子因果分别保存；中文叙事不参与状态还原。 */
export class Journal {
  #entries: JournalEntry[] = [];
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

  facts(kind?: string, withinScope?: string): readonly Fact[] {
    return Object.freeze(
      this.#entries.filter(
        (entry): entry is Fact =>
          entry.type === 'commit' &&
          (kind === undefined || entry.data.kind === kind) &&
          (withinScope === undefined || entry.scopePath.includes(withinScope)),
      ),
    );
  }

  trace(cause: Cause, type: TraceKind, data: unknown): Trace {
    const entry = immutable({ ...cause, seq: this.#entries.length + 1, type, data });
    this.#entries.push(entry);
    if (type === 'decision.open' || type === 'decision.close' || type === 'fault') this.#notify();
    return entry;
  }

  commit<T>(
    cause: Cause,
    revision: number,
    kind: string,
    changes: readonly Change[],
    detail: T,
  ): Fact<T> {
    const fact: Fact<T> = immutable({
      ...cause,
      seq: this.#entries.length + 1,
      type: 'commit',
      data: { kind, revision, changes, detail },
    });
    this.#entries.push(fact);
    this.#notify();
    return fact;
  }
}
