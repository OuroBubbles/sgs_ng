import type { WorldReader } from '../../core/model/state';
import { immutable, isStringArray } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import { defineState, readState, stateChange } from '../state/state';

export interface GameResult {
  readonly winners: readonly string[];
  readonly reason: string;
}
export const gameResult = defineState<GameResult | null>(
  'core:game-result',
  null,
  (value): value is GameResult | null =>
    value === null ||
    (typeof value === 'object' &&
      value !== null &&
      'winners' in value &&
      isStringArray(value.winners) &&
      'reason' in value &&
      typeof value.reason === 'string'),
);
export const gameTarget = Object.freeze({ owner: null, source: 'game', lifetime: null });
export const gameFinished = defineWindow<GameResult>('game.finished');
export function resultOf(world: WorldReader): GameResult | null {
  return readState(world, gameResult, gameTarget);
}
export function isGameOver(world: WorldReader): boolean {
  return resultOf(world) !== null;
}

/** 结果只确定一次；运行时是否收束由装配器接入，规则善后仍可完成提交。 */
export async function finishGame(ctx: Context, input: GameResult): Promise<GameResult> {
  const existing = resultOf(ctx.world);
  if (existing) return existing;
  const result = immutable(input);
  if (!result.reason || new Set(result.winners).size !== result.winners.length)
    throw new Error('Invalid game result.');
  for (const id of result.winners) ctx.world.player(id);
  ctx.commit('game.finished', [stateChange(ctx, gameResult, gameTarget, result)], result);
  await ctx.window(gameFinished, result);
  return result;
}
