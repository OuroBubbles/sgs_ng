export class AsyncQueryError extends Error {
  constructor(label?: string) {
    super(label ? `Queries cannot await (${label}).` : 'Queries cannot await.');
  }
}

/** 在组合之前检查单项返回值，避免 Promise 被布尔运算、数组或行为对象访问掩盖。 */
export function syncQueryValue<T>(value: T, label?: string): T {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  ) {
    // 违规续体仍可能拒绝；执行侧由最外层查询立即冻结，只读投影则关闭自身上下文。
    Promise.resolve(value).catch(() => undefined);
    throw new AsyncQueryError(label);
  }
  return value;
}
