import type { CardMove, Zone, Change } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context, FlowResult } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';

export interface MoveResult {
  readonly kind: 'moved' | 'unchanged';
  readonly moves: readonly CardMove[];
  readonly before: readonly Zone[];
  readonly after: readonly Zone[];
}

export const cardsMoved = defineWindow<MoveResult>('cards.moved', ['attachments', 'main']);

export interface MoveDeclaration {
  readonly kind: string;
  readonly data: unknown;
  /** 与移动同次提交的领域元数据；额外移动必须放在 moves 中，不能绕过移动后效。 */
  readonly changes?: readonly Exclude<Change, { readonly kind: 'move' }>[];
}

/** 批内整体验证/提交，提交后才开放后效；离场信息来自明确的 before 快照。 */
export function moveCards(
  ctx: Context,
  moves: readonly CardMove[],
  reason: string,
  declaration?: MoveDeclaration,
): Promise<FlowResult<MoveResult>> {
  return ctx.flow(
    'moveCards',
    async (child) => {
      const effective = immutable(moves.filter((move) => move.cards.length));
      const ids = new Set(effective.flatMap((move) => [move.from, move.to]));
      const before = child.world.snapshot.zones.filter((zone) => ids.has(zone.id));
      if (!effective.length && !declaration?.changes?.length)
        return immutable({ kind: 'unchanged', moves: effective, before, after: before });

      child.commit(
        declaration?.kind ?? 'cards.moved',
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
      if (effective.length) await child.window(cardsMoved, result);
      return result;
    },
    reason,
  );
}
