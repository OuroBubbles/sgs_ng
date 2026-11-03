import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import type { EffectRef } from '../cards/types';
import { effectReference } from '../cards/types';
import { isGameOver } from '../game/end';
import { defineEvent, timing } from '../../core/runtime/event';
import type { HpLossResult } from './lose-hp';

export interface RecoveryInput {
  readonly from: string | null;
  readonly to: string;
  readonly amount: number;
  readonly card?: EffectRef;
}
export interface RecoveryResult {
  readonly input: RecoveryInput;
  readonly kind: 'recovered' | 'unchanged' | 'unavailable';
  readonly amount: number;
  readonly beforeHp: number;
  readonly afterHp: number;
  readonly attemptedAmount: number;
  readonly edits: readonly RecoveryEdit[];
}
export interface RecoveryEdit {
  readonly before: number;
  readonly after: number;
  readonly reason: string;
}
export interface RecoveryDraft {
  readonly input: RecoveryInput;
  readonly amount: number;
  adjust(delta: number, reason: string): void;
  setAmount(amount: number, reason: string): void;
}
export const Hp = defineEvent('hp', {
  lost: timing<HpLossResult>(),
  recovering: timing<RecoveryDraft>(),
  recovered: timing<RecoveryResult>(),
});

export function recover(ctx: Context, request: RecoveryInput): Promise<RecoveryResult> {
  return ctx.flow('recover', async (child) => {
    const input = immutable({
      ...request,
      ...(request.card === undefined ? {} : { card: effectReference(request.card) }),
    });
    if (!Number.isSafeInteger(input.amount) || input.amount < 1)
      throw new Error('Recovery requires a positive integer.');
    if (input.from !== null) child.world.player(input.from);
    let open = true;
    let adjusted = input.amount;
    const edits: RecoveryEdit[] = [];
    const setAmount = (amount: number, reason: string) => {
      child.assertActive();
      if (!open || !Number.isSafeInteger(amount) || amount < 0 || !reason)
        throw new Error('Invalid or sealed recovery edit.');
      edits.push({ before: adjusted, after: amount, reason });
      adjusted = amount;
    };
    const draft: RecoveryDraft = Object.freeze({
      input,
      get amount() {
        return adjusted;
      },
      setAmount,
      adjust(delta: number, reason: string) {
        if (!Number.isSafeInteger(delta))
          throw new Error('Recovery adjustment must be an integer.');
        setAmount(Math.max(0, adjusted + delta), reason);
      },
    });
    // 待决回复失去目标便收束；零尝试值仍可由后续效果增加，不代表窗口失效。
    const active = (at: Context) => at.world.player(input.to).alive && !isGameOver(at.world);
    if (active(child)) await child.window(Hp.recovering, draft, { subject: input.to, active });
    open = false;
    const target = child.world.player(input.to);
    const available = active(child);
    const amount = available ? Math.min(adjusted, Math.max(0, target.maxHp - target.hp)) : 0;
    const result: RecoveryResult = immutable({
      input,
      kind: !available ? 'unavailable' : amount > 0 ? 'recovered' : 'unchanged',
      amount,
      beforeHp: target.hp,
      afterHp: target.hp + amount,
      attemptedAmount: adjusted,
      edits,
    });
    if (amount) {
      child.commit(
        'hp.recovered',
        [{ kind: 'vitality', player: input.to, hp: result.afterHp }],
        result,
      );
      await child.window(Hp.recovered, result, { subject: input.to });
    }
    return result;
  });
}
