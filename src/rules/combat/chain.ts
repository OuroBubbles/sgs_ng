import type { WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineState, readState, stateChange } from '../state/state';
import { isGameOver } from '../game/end';
import { defineEvent, timing } from '../../core/runtime/event';

const chained = defineState('combat:chained', false);
const target = (player: string) => ({ owner: player, source: 'profile', lifetime: null });

export interface ChainChange {
  readonly player: string;
  readonly before: boolean;
  readonly after: boolean;
  readonly reason: string;
}
export type ChainResult = ChainChange & { readonly kind: 'changed' | 'unchanged' | 'unavailable' };
export const Chain = defineEvent('chain', {
  changed: timing<ChainChange>(),
});

export function isChained(world: WorldReader, player: string): boolean {
  world.player(player);
  return readState(world, chained, target(player));
}

/** 可与伤害、费用等同次提交；低层 Change 本身不开变更后窗口。 */
export function chainChange(ctx: Context, player: string, value: boolean) {
  return stateChange(ctx, chained, target(player), value);
}

/** 显式改变公开连环状态；无变化、不存活或终局不产生变更事实。 */
export function setChained(
  ctx: Context,
  player: string,
  value: boolean,
  reason: string,
): Promise<ChainResult> {
  return ctx.flow('chain.change', async (at) => {
    if (typeof value !== 'boolean' || !reason.trim())
      throw new Error('Invalid chain state change.');
    const before = isChained(at.world, player);
    const kind =
      !at.world.player(player).alive || isGameOver(at.world)
        ? 'unavailable'
        : before === value
          ? 'unchanged'
          : 'changed';
    const result: ChainResult = immutable({
      player,
      before,
      after: kind === 'changed' ? value : before,
      reason,
      kind,
    });
    if (kind === 'changed') {
      at.commit(Chain.changed, [chainChange(at, player, value)], result);
      await at.window(Chain.changed, result, { subject: player });
    }
    return result;
  });
}
