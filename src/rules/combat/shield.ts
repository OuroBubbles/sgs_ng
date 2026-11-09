import type { WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineMark } from '../state/mark';
import { isGameOver } from '../game/end';
import { defineEvent, timing } from '../../core/runtime/event';

const shield = defineMark('combat:shield', 0);

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
export const Shield = defineEvent('shield', {
  changed: timing<ShieldChange>(),
});

export function shieldOf(world: WorldReader, player: string): number {
  world.player(player);
  return shield.of(world, player);
}

/** 绝对值 Change，可与费用或伤害同次提交；本身不开放变更窗口。 */
export function shieldChange(ctx: Context, player: string, value: number) {
  return shield.change(ctx, player, value);
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
      at.commit(Shield.changed, [shieldChange(at, input.player, after)], result);
      await at.window(Shield.changed, result, { subject: input.player });
    }
    return result;
  });
}
