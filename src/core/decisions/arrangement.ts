import type { Decision, Validation } from './hub';
import type { ChoiceItem } from './selection';
import { normalizeChoiceCount } from './count';
import type { ChoiceCount } from './count';
import { immutable, isStringArray } from '../model/value';
import { assignGroups } from './assignment';

export interface ArrangementGroup extends ChoiceItem {
  readonly count: ChoiceCount;
}
export interface ArrangementChoice {
  readonly groups: readonly { readonly id: string; readonly items: readonly string[] }[];
}
export interface ArrangementSpec {
  readonly items: () => readonly ChoiceItem[];
  readonly groups: readonly ArrangementGroup[] | (() => readonly ArrangementGroup[]);
  /** 普通纯函数：物品是否可进入该组；张数限制仍由组自己的 count 表达。 */
  readonly canPlace?: (item: string, group: string) => boolean;
}

interface ArrangementState {
  readonly items: readonly ChoiceItem[];
  readonly groups: readonly ArrangementGroup[];
  readonly allowed: readonly (readonly boolean[])[];
}

function normalizeGroups(input: readonly ArrangementGroup[]): readonly ArrangementGroup[] {
  const groups = immutable(
    Array.from(input, ({ id, label, count }) => ({
      id,
      label,
      count: normalizeChoiceCount(count, 'arrangement'),
    })),
  );
  if (groups.some((g) => !g.id) || new Set(groups.map((g) => g.id)).size !== groups.length)
    throw new Error('Arrangement requires distinct named groups.');
  return groups;
}

/** 全部候选恰好分配一次，各组内部顺序有意义；模型只验证选择，不移动实体。 */
export class ArrangementSelection {
  readonly #groups: () => readonly ArrangementGroup[];
  readonly #items: ArrangementSpec['items'];
  readonly #canPlace: ArrangementSpec['canPlace'];

  constructor(spec: ArrangementSpec) {
    const groups = spec.groups;
    if (typeof groups === 'function') {
      const read = groups.bind(spec);
      this.#groups = () => normalizeGroups(read());
    } else {
      if (!groups.length) throw new Error('Arrangement requires distinct named groups.');
      const fixed = normalizeGroups(groups);
      this.#groups = () => fixed;
    }
    this.#items = spec.items.bind(spec);
    this.#canPlace = spec.canPlace?.bind(spec);
  }

  #state(): ArrangementState {
    const items = immutable(
      Array.from(this.#items(), ({ id, label }) => ({
        id,
        label,
      })),
    );
    const groups = this.#groups();
    if (
      items.some((item) => !item.id) ||
      new Set(items.map((item) => item.id)).size !== items.length
    )
      throw new Error('Arrangement items require distinct stable IDs.');
    const allowed = items.map((item) =>
      groups.map((group) => {
        const accepted = this.#canPlace ? this.#canPlace(item.id, group.id) : true;
        if (typeof accepted !== 'boolean')
          throw new Error('Arrangement canPlace must return a boolean.');
        return accepted;
      }),
    );
    return { items, groups, allowed };
  }
  #initial(state: ArrangementState): ArrangementChoice | null {
    if (!state.groups.length) return null;
    const owners = assignGroups(
      state.allowed,
      state.groups.map(({ count }) => ({
        min: count.min,
        max: count.max === 'all' ? state.items.length : count.max,
      })),
    );
    if (!owners) return null;
    return immutable({
      groups: state.groups.map((group, index) => ({
        id: group.id,
        items: state.items.filter((_item, item) => owners[item] === index).map((item) => item.id),
      })),
    });
  }
  /** 初始方案本身是可完成性见证；普通观星仍按原序全部留在牌顶。 */
  initial(): ArrangementChoice {
    const state = this.#state();
    return (
      this.#initial(state) ??
      immutable({ groups: state.groups.map((g) => ({ id: g.id, items: [] })) })
    );
  }
  validate(input: unknown): Validation<ArrangementChoice> {
    if (!input || typeof input !== 'object' || !('groups' in input) || !Array.isArray(input.groups))
      return { ok: false, reason: 'Expected ordered groups.' };
    const groups: { id: string; items: string[] }[] = [];
    const rawGroups: readonly unknown[] = input.groups;
    for (const value of rawGroups) {
      if (
        !value ||
        typeof value !== 'object' ||
        !('id' in value) ||
        typeof value.id !== 'string' ||
        !('items' in value) ||
        !Array.isArray(value.items)
      )
        return { ok: false, reason: 'Expected stable group and item IDs.' };
      const items: readonly unknown[] = value.items;
      if (!isStringArray(items))
        return { ok: false, reason: 'Expected stable group and item IDs.' };
      groups.push({ id: value.id, items: [...items] });
    }
    const state = this.#state();
    if (
      !state.groups.length ||
      groups.length !== state.groups.length ||
      new Set(groups.map((g) => g.id)).size !== groups.length ||
      groups.some((g) => !state.groups.some((expected) => expected.id === g.id))
    )
      return { ok: false, reason: 'Expected each declared group exactly once.' };
    const candidates = state.items;
    const assigned = groups.flatMap((g) => g.items);
    if (
      assigned.length !== candidates.length ||
      new Set(assigned).size !== assigned.length ||
      assigned.some((id) => !candidates.some((item) => item.id === id))
    )
      return { ok: false, reason: 'Assign every current item exactly once.' };
    for (const [index, group] of state.groups.entries()) {
      const selected = groups.find((g) => g.id === group.id)!.items;
      if (selected.length < group.count.min)
        return {
          ok: false,
          reason: `${group.label}至少需要 ${group.count.min} 项，当前 ${selected.length} 项。`,
        };
      if (group.count.max !== 'all' && selected.length > group.count.max)
        return {
          ok: false,
          reason: `${group.label}最多可放 ${group.count.max} 项，当前 ${selected.length} 项。`,
        };
      const forbidden = selected.find(
        (id) => !state.allowed[candidates.findIndex((item) => item.id === id)]![index],
      );
      if (forbidden)
        return {
          ok: false,
          reason: `${candidates.find((item) => item.id === forbidden)!.label}不能分配到${group.label}。`,
        };
    }
    return {
      ok: true,
      value: immutable({
        groups: state.groups.map((g) => groups.find((value) => value.id === g.id)!),
      }),
    };
  }
  decision(
    player: string,
    prompt: string,
    {
      optional = false,
      reason,
      presentation = 'order',
    }: {
      readonly optional?: boolean;
      readonly reason?: string;
      /** 只选择客户端的分组呈现，不改变合法性、支付或移牌。 */
      readonly presentation?: 'order' | 'distribution';
    } = {},
  ): Decision<ArrangementChoice> {
    return {
      player,
      prompt,
      kind: 'arrange',
      optional,
      available: () => this.#initial(this.#state()) !== null,
      describe: () => {
        const state = this.#state();
        return {
          model: 'arrange',
          presentation,
          items: state.items,
          groups: state.groups,
          destinations: Object.fromEntries(
            state.items.map((item, index) => [
              item.id,
              state.groups
                .filter((_g, group) => state.allowed[index]![group])
                .map((group) => group.id),
            ]),
          ),
          initial: this.#initial(state) ?? {
            groups: state.groups.map((g) => ({ id: g.id, items: [] })),
          },
          ...(reason === undefined ? {} : { reason }),
        };
      },
      feedback: (input) => {
        const result = this.validate(input);
        return { valid: result.ok, reason: result.ok ? '' : result.reason };
      },
      validate: (input) => this.validate(input),
    };
  }
}
