export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/** ID 列表的每个位置都必须是字符串；every 会跳过稀疏数组的空槽。 */
export function isStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++)
    if (typeof value[index] !== 'string') return false;
  return true;
}

// 只信任本模块创建的完整冻结图；外部 Object.freeze 不能证明子对象不可变。
const snapshots = new WeakSet<object>();

/** 普通数据复制并深冻；既有快照可共享，调用者的可变输入始终与结果隔离。 */
export function immutable<T>(value: T): DeepReadonly<T> {
  // null 表示正在复制；完成后保存副本，同一张表兼顾循环检查与共享引用。
  const copies = new Map<object, object | null>();

  function copy(node: unknown): unknown {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return node;
    if (typeof node === 'number' && Number.isFinite(node)) return node;
    if (typeof node !== 'object' || node === null) throw new Error('Expected plain finite data.');
    if (snapshots.has(node)) return node;
    const previous = copies.get(node);
    if (previous === null) throw new Error('Cyclic game data.');
    if (previous) return previous;
    // 先固定数组形状，属性 getter 改变源 length 时也不改变本次复制的长度。
    const arrayCopy = Array.isArray(node) ? new Array(node.length) : null;
    if (!arrayCopy && Object.getPrototypeOf(node) !== Object.prototype)
      throw new Error('Game data must contain only plain objects and arrays.');

    const entries = Object.entries(node);
    copies.set(node, null);
    // 先固定值，再一次建立记录的自有字段；不触发继承 setter 或修改 __proto__。
    for (const entry of entries) entry[1] = copy(entry[1]);
    const result: object = arrayCopy ?? Object.fromEntries(entries);
    if (arrayCopy)
      for (const [key, child] of entries)
        Object.defineProperty(result, key, {
          value: child,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    Object.freeze(result);
    copies.set(node, result);
    snapshots.add(result);
    return result;
  }

  return copy(value) as DeepReadonly<T>;
}
