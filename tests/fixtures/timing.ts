import { timing } from '../../src/sdk';
import type { Timing } from '../../src/sdk';

/** 测试专用的单个时点（任意 id）；规则代码一律通过 defineEvent 声明。 */
export const testTiming = <T>(id: string, groups: readonly string[] = []): Timing<T> =>
  Object.freeze({ id, ...timing<T>(...groups) });
