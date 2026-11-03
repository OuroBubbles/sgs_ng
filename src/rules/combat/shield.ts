import type { WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import { defineState, readState, stateChange } from '../state/state';
import { isGameOver } from '../game/end';

const shield = defineState(
  'combat:shield',
  0,
  (value): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
);
const target = (player: string) => ({ owner: player, source: 'profile', lifetime: null });

export interface ShieldChange {
  readonly player: string;
  readonly before: number;
  readonly after: number;
  readonly amount: number;
  readonly reason: string;
  /** 自动吸收伤害时关联已提交的 DamageResult.id。 */
  readonly damage?: string;
}
export interface ShieldInput {
  readonly player: string;
  /** 正数增加，负数减少；减少至零为止。规则库不施加全局上限。 */
  readonly amount: number;
  readonly reason: string;
}
export type ShieldResult = ShieldChange & {
  readonly kind: 'changed' | 'unchanged' | 'unavailable';
  readonly attemptedAmount: number;
};
export const shieldChanged = defineWindow<ShieldChange>('shield.changed');

export function shieldOf(world: WorldReader, player: string): number {
  world.player(player);
  return readState(world, shield, target(player));
}

/** 绝对值 Change，可与费用或伤害同次提交；本身不开放变更窗口。 */
export function shieldChange(ctx: Context, player: string, value: number) {
  return stateChange(ctx, shield, target(player), value);
}

export function changeShield(ctx: Context, request: ShieldInput): Promise<ShieldResult> {
  const input = immutable(request);
  return ctx.flow('shield.change', async (at) => {
    if (!Number.isSafeInteger(input.amount) || !input.reason.trim())
      throw new Error('Invalid shield change.');
    const before = shieldOf(at.world, input.player);
    const available = at.world.player(input.player).alive && !isGameOver(at.world);
    const after = available ? Math.max(0, before + input.amount) : before;
    if (!Number.isSafeInteger(after)) throw new Error('Shield amount exceeds safe integer range.');
    const amount = after - before;
    const result: ShieldResult = immutable({
      player: input.player,
      before,
      after,
      amount,
      reason: input.reason,
      attemptedAmount: input.amount,
      kind: !available ? 'unavailable' : amount ? 'changed' : 'unchanged',
    });
    if (amount) {
      at.commit('shield.changed', [shieldChange(at, input.player, after)], result);
      await at.window(shieldChanged, result, { subject: input.player });
    }
    return result;
  });
}
