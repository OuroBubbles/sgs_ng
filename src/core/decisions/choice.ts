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
  const options = immutable(input.options);
  if (
    !input.reason ||
    !options.length ||
    options.some((option) => !option.id || !option.label) ||
    new Set(options.map((option) => option.id)).size !== options.length
  )
    throw new Error('Choice options require distinct IDs and readable labels.');
  return {
    player: input.player,
    prompt: input.prompt,
    kind: 'choose-option',
    optional: input.optional ?? false,
    data: { options, reason: input.reason },
    ...(input.available ? { available: input.available } : {}),
    validate: (value) => {
      const found = options.find((option) => option.id === value);
      return found ? { ok: true, value: found.id } : { ok: false, reason: '请选择一个有效选项。' };
    },
  };
}
