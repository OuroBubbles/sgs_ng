import type { Decision, Validation } from './hub';
import { immutable, isStringArray } from '../model/value';
import { syncQueryValue } from '../runtime/query';
import { normalizeChoiceCount } from './count';
import type { ChoiceCount } from './count';

export interface ChoiceItem {
  readonly id: string;
  readonly label: string;
}
export interface JointChoice {
  readonly cards: readonly string[];
  readonly targets: readonly string[];
}

/** 复杂约束的三种职责不能互相冒充；可完成性由作者的普通算法提供，不隐式穷举幂集。 */
export interface JointConstraints {
  /** 额外前缀约束可省略；canComplete 仍必须明确判断合法完成路径。 */
  readonly partial?: (choice: JointChoice) => string | null;
  readonly complete: (choice: JointChoice) => string | null;
  readonly canComplete: (choice: JointChoice) => boolean;
}

interface CompleteSelectionSpec {
  readonly cards: () => readonly (string | ChoiceItem)[];
  readonly targets: () => readonly (string | ChoiceItem)[];
  readonly cardCount: ChoiceCount;
  readonly targetCount: ChoiceCount;
  readonly constraints?: JointConstraints;
}

/** 候选可直接返回稳定 ID，也可提供标签；未使用的维度可整组省略，候选与数量成对声明。 */
export type JointSelectionSpec = Pick<CompleteSelectionSpec, 'constraints'> &
  (
    | Pick<CompleteSelectionSpec, 'cards' | 'cardCount'>
    | { readonly cards?: never; readonly cardCount?: never }
  ) &
  (
    | Pick<CompleteSelectionSpec, 'targets' | 'targetCount'>
    | { readonly targets?: never; readonly targetCount?: never }
  );

export interface ChoiceCandidate extends ChoiceItem {
  readonly selected: boolean;
  readonly selectable: boolean;
}
export interface SelectionFeedback {
  readonly selection: JointChoice;
  readonly refreshed: JointChoice;
  readonly valid: boolean;
  readonly complete: boolean;
  readonly reason: string;
  readonly cards: readonly ChoiceCandidate[];
  readonly targets: readonly ChoiceCandidate[];
}

const empty: JointChoice = Object.freeze({ cards: Object.freeze([]), targets: Object.freeze([]) });
interface Candidates {
  readonly cards: readonly ChoiceItem[];
  readonly targets: readonly ChoiceItem[];
  readonly ids: Readonly<Record<'cards' | 'targets', ReadonlySet<string>>>;
}

function parse(input: unknown): Validation<JointChoice> {
  if (!input || typeof input !== 'object' || !('cards' in input) || !('targets' in input))
    return { ok: false, reason: 'Expected cards and targets.' };
  const { cards, targets } = input;
  if (!isStringArray(cards) || !isStringArray(targets))
    return { ok: false, reason: 'Expected stable choice IDs.' };
  return { ok: true, value: immutable({ cards, targets }) };
}

function maximum(count: ChoiceCount, candidates: readonly ChoiceItem[]): number {
  return count.max === 'all' ? candidates.length : count.max;
}

/** 同次读取固定字段，索引与预览共用；原型 getter 与普通对象使用同一入口。 */
function choiceItem(input: string | ChoiceItem): ChoiceItem {
  return typeof input === 'string'
    ? { id: input, label: input }
    : { id: input.id, label: input.label };
}

/** 相同模型驱动候选、部分反馈和最终验证；它不负责支付，也不持有可写实体。 */
export class JointSelection {
  #spec: CompleteSelectionSpec;

  constructor(spec: JointSelectionSpec = {}) {
    const { cards, targets, cardCount, targetCount, constraints } = spec;
    if ((cards === undefined) !== (cardCount === undefined))
      throw new Error('Selection cards and cardCount must be provided together.');
    if ((targets === undefined) !== (targetCount === undefined))
      throw new Error('Selection targets and targetCount must be provided together.');

    let fixedConstraints: JointConstraints | undefined;
    if (constraints) {
      const { partial, complete, canComplete } = constraints;
      fixedConstraints = Object.freeze({
        ...(partial ? { partial: partial.bind(constraints) } : {}),
        complete: complete.bind(constraints),
        canComplete: canComplete.bind(constraints),
      });
    }

    this.#spec = Object.freeze({
      cards: cards?.bind(spec) ?? (() => []),
      targets: targets?.bind(spec) ?? (() => []),
      cardCount: normalizeChoiceCount(cardCount ?? { min: 0, max: 0 }, 'selection'),
      targetCount: normalizeChoiceCount(targetCount ?? { min: 0, max: 0 }, 'selection'),
      ...(fixedConstraints ? { constraints: fixedConstraints } : {}),
    });
  }

  #candidates(): Candidates {
    const cardInput = syncQueryValue(this.#spec.cards(), 'selection.cards');
    const targetInput = syncQueryValue(this.#spec.targets(), 'selection.targets');
    const cards = cardInput.map(choiceItem);
    const targets = targetInput.map(choiceItem);
    // 索引只属于本次读取；候选变化后重新建立，不能缓存上一次预览的资格。
    const ids = {
      cards: new Set(cards.map((item) => item.id)),
      targets: new Set(targets.map((item) => item.id)),
    };
    for (const [list, index] of [
      [cards, ids.cards],
      [targets, ids.targets],
    ] as const) {
      if (index.size !== list.length) throw new Error('Candidates require distinct stable IDs.');
      for (const item of list)
        if (!item?.id) throw new Error('Candidates require distinct stable IDs.');
    }
    return { cards, targets, ids };
  }

  #reason(choice: JointChoice, candidates: Candidates): string | null {
    for (const key of ['cards', 'targets'] as const) {
      const count = key === 'cards' ? this.#spec.cardCount : this.#spec.targetCount;
      const ids = choice[key];
      if (new Set(ids).size !== ids.length) return 'Duplicate choice.';
      if (ids.some((id) => !candidates.ids[key].has(id)))
        return 'Selected item is no longer a candidate.';
      if (ids.length > maximum(count, candidates[key])) return 'Too many selected items.';
      if (candidates[key].length < count.min) return 'No legal completion.';
    }
    const partial = syncQueryValue(this.#spec.constraints?.partial?.(choice), 'selection.partial');
    if (partial) return partial;
    if (
      this.#spec.constraints &&
      !syncQueryValue(this.#spec.constraints.canComplete(choice), 'selection.canComplete')
    )
      return 'No legal completion.';
    return null;
  }

  #complete(choice: JointChoice): string | null {
    if (
      choice.cards.length < this.#spec.cardCount.min ||
      choice.targets.length < this.#spec.targetCount.min
    )
      return 'Selection is incomplete.';
    return syncQueryValue(this.#spec.constraints?.complete(choice), 'selection.complete') ?? null;
  }

  /** 只判断空前缀能否继续，不投影逐项选中状态，也不要求选择已完成。 */
  available(): boolean {
    return this.#reason(empty, this.#candidates()) === null;
  }

  inspect(input: unknown): SelectionFeedback {
    const parsed = parse(input);
    const selection = parsed.ok ? parsed.value : empty;
    const candidates = this.#candidates();
    const reason = !parsed.ok ? parsed.reason : this.#reason(selection, candidates);
    const completeReason = reason ?? this.#complete(selection);
    const project = (key: 'cards' | 'targets') => {
      const selectedIds = new Set(selection[key]);
      return candidates[key].map((item) => {
        const selected = selectedIds.has(item.id);
        const toggled = {
          ...selection,
          [key]: selected
            ? selection[key].filter((id) => id !== item.id)
            : [...selection[key], item.id],
        };
        return {
          ...item,
          selected,
          selectable: selected || this.#reason(toggled, candidates) === null,
        };
      });
    };
    return immutable({
      selection,
      refreshed: {
        cards: selection.cards.filter((id) => candidates.ids.cards.has(id)),
        targets: selection.targets.filter((id) => candidates.ids.targets.has(id)),
      },
      valid: reason === null,
      complete: completeReason === null,
      reason: completeReason ?? '',
      cards: project('cards'),
      targets: project('targets'),
    });
  }

  validate(input: unknown): Validation<JointChoice> {
    const parsed = parse(input);
    if (!parsed.ok) return parsed;
    const reason = this.#reason(parsed.value, this.#candidates()) ?? this.#complete(parsed.value);
    return reason === null ? { ok: true, value: parsed.value } : { ok: false, reason };
  }

  /** 同次取得数量描述与当前草稿的投影；不传草稿时描述初始空选择。 */
  describe(input: unknown = empty) {
    return {
      model: 'cards-targets',
      cardCount: this.#spec.cardCount,
      targetCount: this.#spec.targetCount,
      preview: this.inspect(input),
    };
  }

  /** 请求选项与分组选择一样放在第三个对象中；默认不可主动取消。 */
  decision(
    player: string,
    prompt: string,
    {
      optional = false,
      cancelLabel,
      reason,
    }: {
      readonly optional?: boolean;
      readonly cancelLabel?: string;
      readonly reason?: string;
    } = {},
  ): Decision<JointChoice> {
    const describe = () => ({
      ...this.describe(),
      ...(cancelLabel === undefined ? {} : { cancelLabel }),
      ...(reason === undefined ? {} : { reason }),
    });
    return {
      player,
      prompt,
      optional,
      kind: 'cards-targets',
      describe,
      feedback: (input) => this.inspect(input),
      available: () => this.available(),
      validate: (input) => this.validate(input),
    };
  }
}
