import type { CardMove, Zone, Change } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineEvent, timing } from '../../core/runtime/event';
import type { Timing } from '../../core/runtime/event';
import type { DrawDraft, DrawResult } from './draw';
import type { RevealedCards } from './reveal';
import type { PaymentReceipt } from '../costs/pay';
import type { SemanticCard, TimingSnapshot, UseSnapshot } from './types';

export interface MoveResult {
  readonly kind: 'moved' | 'unchanged';
  readonly moves: readonly CardMove[];
  /** 本批次提交前存在的受影响区域；含来源和接收区，不随后续结算改变。 */
  readonly before: readonly Zone[];
  /** 同次提交后的区域快照；本批次新建/移除的区域按实际存在性出现。 */
  readonly after: readonly Zone[];
}

/** cards.moved 写入历史的记录；declaration 来自 MoveDeclaration.data。 */
export interface MoveRecord<D = unknown> {
  readonly moves: readonly CardMove[];
  readonly before: readonly Zone[];
  readonly declaration?: D;
}
/** 随移动同次提交的领域宣告，历史记录携带宣告数据 D。 */
export interface Declared<D> extends MoveRecord<D> {
  readonly declaration: D;
}
/** 声明一个随移动写入的历史事实，其宣告数据为 D。 */
export const declared = <D>() => timing<unknown, Declared<D>>();

export interface GivenCards {
  readonly actor: string;
  readonly target: string;
  readonly count: number;
  readonly cards?: readonly string[];
  readonly visible?: boolean;
  readonly reason: string;
}
export interface TakenCard {
  readonly actor: string;
  readonly target: string;
  readonly card: string;
  readonly open: boolean;
  readonly reason: string;
}
export interface RemovedDelayed {
  readonly actor: string;
  readonly target: string;
  readonly card: SemanticCard;
  readonly cards: readonly string[];
}

export const Cards = defineEvent('cards', {
  drawing: timing<DrawDraft>(),
  drawn: timing<DrawResult>(),
  moved: timing<MoveResult, MoveRecord>('attachments', 'main'),
  revealed: timing<RevealedCards>(),

  discarded: timing<PaymentReceipt>(),
  given: declared<GivenCards>(),
  peeked: declared<{
    readonly player: string;
    readonly reason: string;
    readonly zone: string;
    readonly cards: readonly string[];
  }>(),
  arranged: declared<{
    readonly player: string;
    readonly reason: string;
    readonly top: readonly string[];
    readonly bottom: readonly string[];
  }>(),
  distributed: declared<{
    readonly actor: string;
    readonly reason: string;
    readonly allocations: readonly { readonly target: string; readonly count: number }[];
  }>(),
});

/** 用牌与打出宣告的公共字段；打出没有 useId 与目标。 */
export interface CardPlay {
  readonly card: SemanticCard;
  readonly processing: string;
  readonly useId?: string;
  readonly targets?: readonly string[];
  readonly beneficiary?: string;
  readonly parameters?: unknown;
  readonly context?: TimingSnapshot;
}
export const CardEvent = defineEvent('card', {
  used: timing<PaymentReceipt<CardPlay>>(),
  responded: timing<PaymentReceipt<CardPlay>>(),
  chosen: timing<unknown>(),
  finished: timing<unknown, UseSnapshot>(),
  targeting: timing<unknown>(),
  effect: timing<unknown>(),
  planChanged: timing<unknown>(),
  targetReplaced: timing<unknown>(),
  taken: declared<TakenCard>(),
  takenPublic: declared<{
    readonly actor: string;
    readonly cards: readonly string[];
    readonly reason: string;
  }>(),
  takenDelayed: timing<unknown, RemovedDelayed>(),
});

export interface MoveDeclaration<D = unknown> {
  readonly kind: Timing<unknown, Declared<D>>;
  readonly data: D;
  /** 与移动同次提交的领域元数据；额外移动必须放在 moves 中，不能绕过移动后效。 */
  readonly changes?: readonly Exclude<Change, { readonly kind: 'move' }>[];
}

/** 批内整体验证/提交，提交后才开放后效；离场信息来自明确的 before 快照。 */
export function moveCards<D>(
  ctx: Context,
  moves: readonly CardMove[],
  reason: string,
  declaration?: MoveDeclaration<D>,
): Promise<MoveResult> {
  return ctx.flow(
    'moveCards',
    async (child) => {
      const effective = immutable(moves.filter((move) => move.cards.length));
      const ids = new Set(effective.flatMap((move) => [move.from, move.to]));
      const before = child.world.snapshot.zones.filter((zone) => ids.has(zone.id));
      if (!effective.length && !declaration?.changes?.length)
        return immutable({ kind: 'unchanged', moves: effective, before, after: before });

      child.commit<MoveRecord<unknown>>(
        declaration?.kind ?? Cards.moved,
        [
          ...effective.map((move): Change => ({ kind: 'move', ...move })),
          ...(declaration?.changes ?? []),
        ],
        { moves: effective, before, ...(declaration ? { declaration: declaration.data } : {}) },
      );
      const after = child.world.snapshot.zones.filter((zone) => ids.has(zone.id));
      const result: MoveResult = immutable({
        kind: effective.length ? 'moved' : 'unchanged',
        moves: effective,
        before,
        after,
      });
      if (effective.length) await child.window(Cards.moved, result);
      return result;
    },
    reason,
  );
}
