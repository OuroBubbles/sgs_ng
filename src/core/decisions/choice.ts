import type { Decision } from './hub';
import type { ChoiceItem } from './selection';
import { immutable } from '../model/value';

/** 具名选项是普通选择，不借用触发排序，也不把校验闭包送到客户端。 */
export function chooseOne<T extends string>(input: {
  readonly player: string;
  readonly prompt: string;
  readonly options: readonly (ChoiceItem & { readonly id: T })[];
  readonly reason: string;
  readonly optional?: boolean;
  readonly available?: () => boolean;
}): Decision<T> {
  const { player, prompt, options: entries, reason, optional, available } = input;
  // 各字段已只读，泛型 ID 是标量字符串；避免映射类型丢失其具体子类型。
  const options = immutable(
    Array.from(entries, ({ id, label }) => ({ id, label })),
  ) as typeof entries;
  if (
    !reason ||
    !options.length ||
    options.some((option) => !option.id || !option.label) ||
    new Set(options.map((option) => option.id)).size !== options.length
  )
    throw new Error('Choice options require distinct IDs and readable labels.');
  return {
    player,
    prompt,
    kind: 'choose-option',
    optional: optional ?? false,
    data: { options, reason },
    ...(available ? { available: available.bind(input) } : {}),
    validate: (value) => {
      const found = options.find((option) => option.id === value);
      return found ? { ok: true, value: found.id } : { ok: false, reason: '请选择一个有效选项。' };
    },
  };
}
