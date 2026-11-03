import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import type { CardBook } from '../cards/book';
import type { EffectRef, Purpose } from '../cards/types';
import { effectReference } from '../cards/types';
import type { ResponseResult } from '../cards/response';
import { isResponseSatisfied } from '../cards/response';
import { damage } from './damage';
import type { DamageResult } from './damage';
import { isGameOver } from '../game/end';
import { defineEvent, timing } from '../../core/runtime/event';

type Answered = Extract<ResponseResult, { kind: 'responded' | 'used' }>;
export interface DefenseDraft {
  readonly effect: EffectRef;
  readonly responses: readonly Answered[];
  readonly broken: boolean;
  readonly reason: string | null;
  breakDefense(reason: string): void;
}
export interface AttackResult {
  readonly effect: EffectRef;
  readonly responses: readonly Answered[];
  readonly kind: 'defended' | 'undefended' | 'unavailable';
  readonly brokenBy: string | null;
  readonly damage: DamageResult | null;
}
export const Attack = defineEvent('attack', {
  defended: timing<DefenseDraft, Pick<DefenseDraft, 'effect' | 'responses'>>(),
  defenseBroken: timing<unknown>(),
  finished: timing<unknown>(),
});

/** 作者可保留完整响应/突破管线，仅以普通函数指定命中后的伤害。 */
export type AttackDamage = (ctx: Context, effect: EffectRef) => Promise<DamageResult>;
const defaultDamage: AttackDamage = (ctx, effect) =>
  damage(ctx, {
    from: effect.actor,
    to: effect.target,
    amount: 1,
    nature: effect.card.nature,
    card: effect,
  });

/** 完整满足响应后才开放防御结果；突破只恢复原效果，追加用牌拥有独立 UseId。 */
export async function resolveAttack(
  ctx: Context,
  target: EffectRef,
  book: CardBook,
  response: { readonly name: string; readonly purpose: Purpose },
  deal: AttackDamage = defaultDamage,
): Promise<void> {
  const effect = effectReference(target);
  await ctx.flow('attack', async (at) => {
    const responses: Answered[] = [];
    const live = () => at.world.player(effect.target).alive && !isGameOver(at.world);
    const count = book.responseTimes(at, effect, effect.target, response.name);
    let defended = count > 0;
    for (let i = 0; i < count && live(); i++) {
      const answer = await (response.purpose === 'use'
        ? book.useResponse(at, effect.target, [response.name], effect)
        : book.respond(at, effect.target, [response.name], effect));
      if (!isResponseSatisfied(answer)) {
        defended = false;
        break;
      }
      responses.push(answer);
    }
    let open = true;
    let brokenBy: string | null = null;
    const draft: DefenseDraft = Object.freeze({
      effect,
      responses: immutable(responses),
      get broken() {
        return brokenBy !== null;
      },
      get reason() {
        return brokenBy;
      },
      breakDefense(reason: string) {
        at.assertActive();
        if (!open || !reason) throw new Error('Defense result is sealed or missing a reason.');
        brokenBy ??= reason;
      },
    });
    if (defended && live()) {
      at.commit(Attack.defended, [], { effect, responses });
      await at.window(Attack.defended, draft, { subject: effect.actor });
    }
    open = false;
    if (brokenBy) at.commit(Attack.defenseBroken, [], { effect, reason: brokenBy });
    const kind: AttackResult['kind'] = !live()
      ? 'unavailable'
      : defended && !draft.broken
        ? 'defended'
        : 'undefended';
    let dealt: DamageResult | null = null;
    if (kind === 'undefended') {
      dealt = await deal(at, effect);
    }
    at.commit(Attack.finished, [], {
      effect,
      responses,
      kind,
      brokenBy,
      damage: dealt,
    } satisfies AttackResult);
  });
}
