import { immutable } from '../model/value';

export class RuleAbort extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** 资源清理同步、幂等且后进先出；会产生新结算的规则善后留给调用方显式 await。 */
export class Scope {
  readonly path: readonly string[];
  #open = true;
  #reason = 'Scope closed.';
  #cleanups = new Set<() => void>();
  #detach: (() => void) | null = null;

  constructor(
    readonly id: string,
    readonly parent: Scope | null,
  ) {
    // 同一作用域的因果路径由历史记录共享，不在每条事实和轨迹中重复复制。
    this.path = immutable([...(parent?.path ?? []), id]);
    if (parent) this.#detach = parent.onClose(() => this.close(parent.reason));
  }

  get active(): boolean {
    return this.#open && (this.parent?.active ?? true);
  }
  get reason(): string {
    return this.#reason;
  }

  assertActive(): void {
    if (!this.active) throw new RuleAbort(this.#reason);
  }

  onClose(cleanup: () => void): () => void {
    this.assertActive();
    this.#cleanups.add(cleanup);
    return () => {
      this.#cleanups.delete(cleanup);
    };
  }

  close(reason = 'Scope closed.'): void {
    if (!this.#open) return;
    this.#open = false;
    this.#reason = reason;
    this.#detach?.();
    this.#detach = null;
    const cleanups = [...this.#cleanups].reverse();
    this.#cleanups.clear();
    const failures: unknown[] = [];
    for (const cleanup of cleanups) {
      try {
        const result: unknown = cleanup();
        if (
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          'then' in result &&
          typeof result.then === 'function'
        ) {
          // 异步规则善后必须由流程等待；这里只释放同步资源，并接住违规续体的拒绝。
          Promise.resolve(result).catch(() => undefined);
          throw new Error('Resource cleanup cannot await.');
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      const details = failures
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join('; ');
      throw new AggregateError(failures, `Cleanup failed: ${this.id}: ${details}`);
    }
  }
}
