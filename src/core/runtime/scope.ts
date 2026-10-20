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
    this.path = Object.freeze([...(parent?.path ?? []), id]);
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
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, `Cleanup failed: ${this.id}`);
  }
}
