import type { Cause, Journal } from '../history/journal';
import { immutable } from '../model/value';
import type { DeepReadonly } from '../model/value';
import type { WorldReader } from '../model/state';
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
export interface Decision<T> extends Omit<DecisionSpec, 'data'> {
  /** 静态展示数据可省略；提供 describe 时以其实时结果为准。 */
  readonly data?: unknown;
  readonly describe?: () => unknown;
  readonly feedback?: (input: unknown) => unknown;
  readonly available?: () => boolean;
  readonly validate: (input: unknown) => Validation<T>;
}

/** 可展示的数据与运行中的校验闭包分开；这里不携带 validate 或实体写入器。 */
export interface DecisionRequest extends DecisionSpec {
  readonly id: string;
  readonly token: number;
  readonly revision: number;
}

export type DecisionResult<T> =
  | { readonly kind: 'chosen'; readonly value: DeepReadonly<T> }
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
    private readonly world: WorldReader,
    private readonly journal: Journal,
    private readonly query: <T>(body: () => T, cause: Cause) => T,
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
    // 固定本次请求的方法与接收者；方法内部仍可读取实时草案与候选。
    const { player, available, describe, validate, feedback } = this.query(() => {
      const player = spec.player;
      this.world.player(player);
      return {
        player,
        available: spec.available?.bind(spec) ?? (() => true),
        describe: spec.describe?.bind(spec) ?? (() => spec.data ?? null),
        validate: spec.validate.bind(spec),
        feedback: spec.feedback?.bind(spec),
      };
    }, cause);
    if (!this.query(available, cause)) return Promise.resolve({ kind: 'unavailable' });
    const request = this.#snapshot(cause, () => ({
      id: `${this.roomId}:decision:${++this.#nextId}`,
      token: 1,
      revision: this.world.snapshot.revision,
      player,
      kind: spec.kind,
      prompt: spec.prompt,
      data: this.query(describe, cause),
      optional: spec.optional,
    }));

    return new Promise((resolve) => {
      const detach = scope.onClose(() => entry.close({ kind: 'aborted' }));
      const entry: Pending = {
        cause,
        request,
        validate: (input) => this.query(() => validate(input), cause),
        available: () => this.query(available, cause),
        describe: () => this.query(describe, cause),
        feedback: (input) => this.query(() => feedback?.(input) ?? null, cause),
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
      entry.request = this.#snapshot(entry.cause, () => ({
        ...entry.request,
        token: entry.request.token + 1,
        revision: this.world.snapshot.revision,
        data: entry.describe(),
      }));
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
      return this.#snapshot(entry.cause, () => {
        const result = entry.validate(input);
        const available = entry.available();
        const { ok } = result;
        return {
          request,
          valid: ok && available,
          reason: !ok ? result.reason : available ? '' : 'No legal completion.',
          feedback: entry.feedback(input),
        };
      });
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
      const result = this.#snapshot(entry.cause, (): Validation<unknown> => {
        const checked = entry.validate(input);
        return checked.ok
          ? { ok: true, value: checked.value }
          : { ok: false, reason: checked.reason };
      });
      if (!result.ok) return this.#reject('invalid', result.reason);
      entry.close({ kind: 'chosen', value: result.value });
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

  /** 读取与复制共用止写边界；getter 也不能在 callback 返回后重入规则操作。 */
  #snapshot<T>(cause: Cause, read: () => T): DeepReadonly<T> {
    return this.query(() => immutable(read()), cause);
  }

  #current(entry: Pending): DecisionRequest | null {
    if (entry.request.revision !== this.world.snapshot.revision) this.invalidate(entry.request.id);
    return this.#pending.has(entry.request.id) ? entry.request : null;
  }

  #reject(reason: 'closed' | 'stale' | 'invalid' | 'required', message: string): ReplyResult {
    return { kind: 'rejected', reason, message };
  }
}
