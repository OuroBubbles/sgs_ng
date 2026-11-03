import { immutable } from '../model/value';

export interface ChoiceCount {
  readonly min: number;
  readonly max: number | 'all';
}

/** 一次读取并固定实际使用的范围；候选是否足够由各选择模型实时判断。 */
export function normalizeChoiceCount(count: ChoiceCount, label: string): ChoiceCount {
  const { min, max } = count;
  if (
    !Number.isSafeInteger(min) ||
    min < 0 ||
    (max !== 'all' && (!Number.isSafeInteger(max) || max < min))
  )
    throw new Error(`Invalid ${label} count.`);
  return immutable({ min, max });
}
