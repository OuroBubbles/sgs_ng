import type { Cause, Journal } from '../history/journal';
import { immutable } from '../model/value';
import type { Scope } from '../runtime/scope';

export type Validation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export interface DecisionSpec {
  readonly player: string;
  readonly kind: string;
  readonly prompt: string;
  readonly data: unknown;
  readonly optional: boolean;
}

/** 一次活跃选择的执行侧定义，闭包不进入展示/传输描述。 */
export interface Decision<T> extends DecisionSpec {
  readonly describe?: () => unknown;
  readonly feedback?: (input: unknown) => unknown;
  readonly available?: () => boolean;
  readonly validate: (input: unknown) => Validation<T>;
}

/** 可展示的数据与运行中的校验闭包分开；这里不携带 validate 或实体写入器。 */
export interface DecisionRequest {
  readonly id: string;
  readonly token: number;
  readonly revision: number;
  readonly player: string;
  readonly kind: string;
  readonly prompt: string;
  readonly data: unknown;
  readonly optional: boolean;
}

export type DecisionResult<T> =
  | { readonly kind: 'chosen'; readonly value: T }
  | { readonly kind: 'cancelled' | 'unavailable' | 'aborted' };

export type ReplyResult =
  | { readonly kind: 'accepted' }
  | {
      readonly kind: 'rejected';
      readonly reason: 'closed' | 'stale' | 'invalid' | 'required';
      readonly message: string;
    };

interface Pending {
  readonly cause: Cause;
  request: DecisionRequest;
  readonly validate: (input: unknown) => Validation<unknown>;
  readonly available: () => boolean;
  readonly describe: () => unknown;
  readonly feedback: (input: unknown) => unknown;
  readonly close: (result: DecisionResult<unknown>) => void;
}

export class DecisionHub {
  #nextId = 0;
  #pending = new Map<string, Pending>();
  #stopped: string | null = null;

  constructor(
    private readonly roomId: string,
    private readonly revision: () => number,
    private readonly journal: Journal,
    private readonly query: <T>(body: () => T) => T,
    private readonly fault: (error: unknown, cause: Cause) => void,
  ) {}

  get pending(): readonly DecisionRequest[] {
    return [...this.#pending.values()].flatMap((entry) => {
      const current = this.#current(entry);
      return current ? [current] : [];
    });
  }

  open<T>(spec: Decision<T>, scope: Scope, cause: Cause): Promise<DecisionResult<T>> {
    scope.assertActive();
    if (this.#stopped !== null) return Promise.resolve({ kind: 'unavailable' });
    if (spec.available && !this.query(spec.available))
      return Promise.resolve({ kind: 'unavailable' });
    const request = immutable({
      id: `${this.roomId}:decision:${++this.#nextId}`,
      token: 1,
      revision: this.revision(),
      player: spec.player,
      kind: spec.kind,
      prompt: spec.prompt,
      data: spec.describe ? this.query(spec.describe) : spec.data,
      optional: spec.optional,
    });

    return new Promise((resolve) => {
      const detach = scope.onClose(() => entry.close({ kind: 'aborted' }));
      const entry: Pending = {
        cause,
        request,
        validate: (input) => this.query(() => spec.validate(input)),
        available: () => this.query(spec.available ?? (() => true)),
        describe: () => this.query(spec.describe ?? (() => spec.data)),
        feedback: (input) => this.query(() => spec.feedback?.(input) ?? null),
        close: (result) => {
          if (!this.#pending.delete(request.id)) return;
          detach();
          this.journal.trace(cause, 'decision.close', { id: request.id, result });
          // entry 的 validate 只会生成本 spec 的 T；未知输入在 validate 中被收窄。
          resolve(result as DecisionResult<T>);
        },
      };
      this.#pending.set(request.id, entry);
      this.journal.trace(cause, 'decision.open', request);
    });
  }

  /** 结束输入而不关闭正在做规则善后的作用域。由 Room.finish 调用。 */
  stop(reason: string): void {
    if (this.#stopped !== null) return;
    this.#stopped = reason;
    for (const entry of [...this.#pending.values()]) entry.close({ kind: 'aborted' });
  }

  /** 草案改变也可以失效选择，不依赖单个 World revision。 */
  invalidate(id: string): void {
    const entry = this.#pending.get(id);
    if (!entry) return;
    try {
      if (!entry.available()) {
        entry.close({ kind: 'unavailable' });
        return;
      }
      entry.request = immutable({
        ...entry.request,
        token: entry.request.token + 1,
        revision: this.revision(),
        data: entry.describe(),
      });
    } catch (error) {
      this.fault(error, entry.cause);
      throw error;
    }
  }

  preview(
    id: string,
    input: unknown,
  ): {
    readonly request: DecisionRequest;
    readonly valid: boolean;
    readonly reason: string;
    readonly feedback: unknown;
  } | null {
    const entry = this.#pending.get(id);
    if (!entry) return null;
    try {
      const request = this.#current(entry);
      if (!request) return null;
      const result = entry.validate(input);
      const available = entry.available();
      return {
        request,
        valid: result.ok && available,
        reason: !result.ok ? result.reason : available ? '' : 'No legal completion.',
        feedback: immutable(entry.feedback(input)),
      };
    } catch (error) {
      this.fault(error, entry.cause);
      throw error;
    }
  }

  submit(id: string, token: number, input: unknown): ReplyResult {
    const entry = this.#pending.get(id);
    if (!entry) return this.#reject('closed', 'Decision is no longer open.');
    const current = this.#current(entry);
    if (!current) return this.#reject('closed', 'Decision is no longer open.');
    if (current.token !== token) return this.#reject('stale', 'Selection changed; preview again.');
    try {
      if (!entry.available()) {
        entry.close({ kind: 'unavailable' });
        return this.#reject('invalid', 'No legal completion.');
      }
      const result = entry.validate(input);
      if (!result.ok) return this.#reject('invalid', result.reason);
      const value = immutable(result.value);
      entry.close({ kind: 'chosen', value });
      return { kind: 'accepted' };
    } catch (error) {
      this.fault(error, entry.cause);
      throw error;
    }
  }

  cancel(id: string, token: number): ReplyResult {
    const entry = this.#pending.get(id);
    if (!entry) return this.#reject('closed', 'Decision is no longer open.');
    const current = this.#current(entry);
    if (!current) return this.#reject('closed', 'Decision is no longer open.');
    if (current.token !== token) return this.#reject('stale', 'Selection changed.');
    if (!entry.request.optional) return this.#reject('required', 'This decision is required.');
    entry.close({ kind: 'cancelled' });
    return { kind: 'accepted' };
  }

  #current(entry: Pending): DecisionRequest | null {
    if (entry.request.revision !== this.revision()) this.invalidate(entry.request.id);
    return this.#pending.has(entry.request.id) ? entry.request : null;
  }

  #reject(reason: 'closed' | 'stale' | 'invalid' | 'required', message: string): ReplyResult {
    return { kind: 'rejected', reason, message };
  }
}
