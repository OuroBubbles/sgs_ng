import { immutable } from '../../core/model/value';
import type { Context, FlowResult } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import { isGameOver } from '../game/end';
import { reshuffle } from './draw';
import { cardsMoved } from './move';
import { withProcessing } from './processing';
import type { Processing } from './processing';

export interface RevealInput {
  readonly count: number;
  readonly reason: string;
}
export interface RevealedCards {
  readonly zone: string;
  readonly cards: readonly string[];
  readonly reason: string;
}
export const cardsRevealed = defineWindow<RevealedCards>('cards.revealed');

/** 牌堆顶公开牌与拥有它们的处理区共同生存，普通闭包可管理共享牌池，不借用角色手牌。 */
export function withRevealedCards<T>(
  ctx: Context,
  request: RevealInput,
  body: (ctx: Context, pool: Processing) => T | Promise<T>,
): Promise<FlowResult<T>> {
  const input = immutable(request);
  if (!Number.isSafeInteger(input.count) || input.count < 0 || !input.reason)
    throw new Error('Invalid reveal request.');
  return withProcessing(ctx, [], 'discard', async (at, pool) => {
    if (!isGameOver(at.world)) {
      if (
        at.world.zone('draw').cards.length < input.count &&
        at.world.zone('discard').cards.length
      ) {
        const shuffled = await reshuffle(at);
        if (shuffled.kind === 'aborted') return at.abort(shuffled.reason);
      }
      const cards = isGameOver(at.world) ? [] : at.world.zone('draw').cards.slice(0, input.count);
      const before = [at.world.zone('draw'), at.world.zone(pool.zone)];
      const event = immutable({ zone: pool.zone, cards, reason: input.reason });
      const moves = cards.length
        ? [{ cards, from: 'draw', to: pool.zone, place: 'bottom' as const }]
        : [];
      at.commit(
        'cards.revealed',
        moves.map((move) => ({ kind: 'move', ...move })),
        event,
      );
      if (moves.length)
        await at.window(
          cardsMoved,
          immutable({
            kind: 'moved',
            moves,
            before,
            after: [at.world.zone('draw'), at.world.zone(pool.zone)],
          }),
        );
      await at.window(cardsRevealed, event);
    }
    return body(at, pool);
  });
}
