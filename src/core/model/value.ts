export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/** 事实、状态和决策回复都是普通数据；运行中的闭包只留在运行时。 */
export function immutable<T>(value: T): T {
  const ancestors = new Set<object>();

  function check(node: unknown): void {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return;
    if (typeof node === 'number' && Number.isFinite(node)) return;
    if (typeof node !== 'object' || node === null) throw new Error('Expected plain finite data.');
    if (ancestors.has(node)) throw new Error('Cyclic game data.');
    if (!Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype)
      throw new Error('Game data must contain only plain objects and arrays.');

    ancestors.add(node);
    for (const child of Object.values(node)) check(child);
    ancestors.delete(node);
  }

  function freeze(node: unknown): void {
    if (node === null || typeof node !== 'object') return;
    for (const child of Object.values(node)) freeze(child);
    Object.freeze(node);
  }

  check(value);
  const copy = structuredClone(value);
  freeze(copy);
  return copy;
}
