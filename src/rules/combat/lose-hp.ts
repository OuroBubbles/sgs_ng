import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { isGameOver } from '../game/end';
import { enterDying } from './life';
import { Hp } from './recover';

export interface HpLossInput {
  readonly player: string;
  readonly amount: number;
  readonly reason: string;
}
export interface HpLossResult {
  readonly kind: 'lost' | 'unavailable';
  readonly input: HpLossInput;
  readonly amount: number;
  readonly beforeHp: number;
  readonly afterHp: number;
}

export function loseHp(ctx: Context, request: HpLossInput): Promise<HpLossResult> {
  return ctx.flow(
    'loseHp',
    async (child) => {
      const input = immutable(request);
      if (!Number.isSafeInteger(input.amount) || input.amount < 1 || !input.reason)
        throw new Error('Invalid HP loss.');
      const player = child.world.player(input.player);
      const amount = player.alive && !isGameOver(child.world) ? input.amount : 0;
      const result: HpLossResult = immutable({
        kind: amount ? 'lost' : 'unavailable',
        input,
        amount,
        beforeHp: player.hp,
        afterHp: player.hp - amount,
      });
      if (!amount) return result;
      const fact = child.commit(
        Hp.lost,
        [{ kind: 'vitality', player: input.player, hp: result.afterHp }],
        result,
      );
      if (result.afterHp <= 0) {
        await enterDying(child, {
          player: input.player,
          killer: null,
          cause: { kind: 'hp-loss', seq: fact.seq, data: result },
        });
      }
      if (!isGameOver(child.world)) await child.window(Hp.lost, result, { subject: input.player });
      return result;
    },
    request.reason,
  );
}
