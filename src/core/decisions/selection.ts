import type { Decision, Validation } from './hub';
import { immutable } from '../model/value';

export interface ChoiceItem {
  readonly id: string;
  readonly label: string;
}
export interface JointChoice {
  readonly cards: readonly string[];
  readonly targets: readonly string[];
}
export interface ChoiceCount {
  readonly min: number;
  readonly max: number | 'all';
}

/** 复杂约束的三种职责不能互相冒充；可完成性由作者的普通算法提供，不隐式穷举幂集。 */
export interface JointConstraints {
  readonly partial: (choice: JointChoice) => string | null;
  readonly complete: (choice: JointChoice) => string | null;
  readonly canComplete: (choice: JointChoice) => boolean;
}

export interface JointSelectionSpec {
  readonly cards: () => readonly ChoiceItem[];
  readonly targets: () => readonly ChoiceItem[];
  readonly cardCount: ChoiceCount;
  readonly targetCount: ChoiceCount;
  readonly constraints?: JointConstraints;
}

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
}

function parse(input: unknown): Validation<JointChoice> {
  if (!input || typeof input !== 'object' || !('cards' in input) || !('targets' in input))
    return { ok: false, reason: 'Expected cards and targets.' };
  const { cards, targets } = input;
  if (
    !Array.isArray(cards) ||
    !cards.every((id): id is string => typeof id === 'string') ||
    !Array.isArray(targets) ||
    !targets.every((id): id is string => typeof id === 'string')
  )
    return { ok: false, reason: 'Expected stable choice IDs.' };
  return { ok: true, value: immutable({ cards, targets }) };
}

function maximum(count: ChoiceCount, candidates: readonly ChoiceItem[]): number {
  return count.max === 'all' ? candidates.length : count.max;
}

/** 相同模型驱动候选、部分反馈和最终验证；它不负责支付，也不持有可写实体。 */
export class JointSelection {
  #spec: JointSelectionSpec;

  constructor(spec: JointSelectionSpec) {
    for (const count of [spec.cardCount, spec.targetCount]) {
      if (
        !Number.isSafeInteger(count.min) ||
        count.min < 0 ||
        (count.max !== 'all' && (!Number.isSafeInteger(count.max) || count.max < count.min))
      )
        throw new Error('Invalid selection count.');
    }
    this.#spec = Object.freeze({
      ...spec,
      cardCount: Object.freeze({ ...spec.cardCount }),
      targetCount: Object.freeze({ ...spec.targetCount }),
      ...(spec.constraints ? { constraints: Object.freeze({ ...spec.constraints }) } : {}),
    });
  }

  #candidates(): Candidates {
    const cards = this.#spec.cards();
    const targets = this.#spec.targets();
    for (const list of [cards, targets]) {
      if (
        list.some((item) => !item.id) ||
        new Set(list.map((item) => item.id)).size !== list.length
      )
        throw new Error('Candidates require distinct stable IDs.');
    }
    return { cards, targets };
  }

  #reason(choice: JointChoice, candidates: Candidates): string | null {
    for (const key of ['cards', 'targets'] as const) {
      const count = key === 'cards' ? this.#spec.cardCount : this.#spec.targetCount;
      const ids = choice[key];
      if (new Set(ids).size !== ids.length) return 'Duplicate choice.';
      if (ids.some((id) => !candidates[key].some((item) => item.id === id)))
        return 'Selected item is no longer a candidate.';
      if (ids.length > maximum(count, candidates[key])) return 'Too many selected items.';
      if (candidates[key].length < count.min) return 'No legal completion.';
    }
    const partial = this.#spec.constraints?.partial(choice);
    if (partial) return partial;
    if (this.#spec.constraints && !this.#spec.constraints.canComplete(choice))
      return 'No legal completion.';
    return null;
  }

  #complete(choice: JointChoice): string | null {
    if (
      choice.cards.length < this.#spec.cardCount.min ||
      choice.targets.length < this.#spec.targetCount.min
    )
      return 'Selection is incomplete.';
    return this.#spec.constraints?.complete(choice) ?? null;
  }

  inspect(input: unknown): SelectionFeedback {
    const parsed = parse(input);
    const selection = parsed.ok ? parsed.value : empty;
    const candidates = this.#candidates();
    const reason = !parsed.ok ? parsed.reason : this.#reason(selection, candidates);
    const completeReason = reason ?? this.#complete(selection);
    const project = (key: 'cards' | 'targets') =>
      candidates[key].map((item) => {
        const selected = selection[key].includes(item.id);
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
    return immutable({
      selection,
      refreshed: {
        cards: selection.cards.filter((id) => candidates.cards.some((item) => item.id === id)),
        targets: selection.targets.filter((id) =>
          candidates.targets.some((item) => item.id === id),
        ),
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

  decision(
    player: string,
    prompt: string,
    optional = false,
    { cancelLabel, reason }: { readonly cancelLabel?: string; readonly reason?: string } = {},
  ): Decision<JointChoice> {
    const describe = () => ({
      model: 'cards-targets',
      cardCount: this.#spec.cardCount,
      targetCount: this.#spec.targetCount,
      preview: this.inspect(empty),
      ...(cancelLabel === undefined ? {} : { cancelLabel }),
      ...(reason === undefined ? {} : { reason }),
    });
    return {
      player,
      prompt,
      optional,
      kind: 'cards-targets',
      data: null,
      describe,
      feedback: (input) => this.inspect(input),
      available: () => this.#reason(empty, this.#candidates()) === null,
      validate: (input) => this.validate(input),
    };
  }
}
