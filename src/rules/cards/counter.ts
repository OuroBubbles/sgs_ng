import { immutable } from '../../core/model/value';
import type { Context, FlowResult, Room } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import type { CardBook } from './book';
import { effectStarting } from './book';
import { effectReference, useReference } from './types';
import type { CounterOpportunity, CounterSubject, EffectRef, CardUseRef } from './types';
import type { UsePlanView } from './plan';
import { withLifetime } from '../scopes/lifetime';
import { isGameOver } from '../game/end';

export interface CounterResult {
  /** 本机会封口时的结论；原效果已失效时不能将无效反制误报为未受反制。 */
  readonly kind: 'unopposed' | 'countered' | 'unavailable';
  readonly subject: CounterSubject;
  /** 已实际使用的反制牌，机会随后失效也保留其身份和材料归属。 */
  readonly by: CardUseRef | null;
}
export interface CounterOutcome {
  readonly kind: 'counter';
  readonly effective: boolean;
  readonly against: CounterSubject;
}
export interface CounterRequest {
  readonly depth?: number;
  readonly subject: CounterSubject;
  readonly root: EffectRef;
  readonly names?: readonly string[];
  readonly relevant?: (ctx: Context) => boolean;
}
export const counterOpening = defineWindow<CounterOpportunity>('counter.opening');
export const counterFinished = defineWindow<CounterResult>('counter.finished');

/** 一个机会对应一个具体效果或用牌。每张反制牌在自身用牌本体中嵌套下一机会，材料不提前离场。 */
export function contestCounter(
  ctx: Context,
  book: CardBook,
  request: CounterRequest,
): Promise<FlowResult<CounterResult>> {
  return withLifetime(ctx, 'counter', async (child, lifetime) => {
    const subject = immutable(request.subject);
    const root = effectReference(request.root);
    const restricted = subject.kind === 'effect' ? subject.effect : subject.use;
    const names = immutable(request.names ?? ['standard:nullification']);
    const allowedNames = names.filter((name) => !restricted.prohibitedCounters?.includes(name));
    if (!allowedNames.length) {
      const result: CounterResult = {
        kind:
          !isGameOver(child.world) &&
          child.world.player(root.target).alive &&
          child.query(() => request.relevant?.(child) ?? true)
            ? 'unopposed'
            : 'unavailable',
        subject,
        by: null,
      };
      child.commit('counter.finished', [], result);
      await child.window(counterFinished, immutable(result), { subject: root.target });
      return immutable(result);
    }
    const relevant = request.relevant ?? (() => true);
    const opportunity: CounterOpportunity = Object.freeze({
      depth: request.depth ?? 0,
      lifetime,
      subject,
      root,
      names,
      available: (at: Context) =>
        at.world === child.world &&
        lifetime.active &&
        !isGameOver(at.world) &&
        at.world.player(root.target).alive &&
        relevant(at),
    });
    const live = () => child.query(() => opportunity.available(child));
    // 开窗后效也可能令原效果失效；持续收束本次机会，不撤销已经提交的费用。
    if (live())
      await child.window(counterOpening, opportunity, {
        subject: root.actor,
        active: opportunity.available,
      });
    let result: CounterResult = { kind: live() ? 'unopposed' : 'unavailable', subject, by: null };
    for (const actor of child.actionOrder(root.actor)) {
      if (!live()) {
        result = { kind: 'unavailable', subject, by: null };
        break;
      }
      if (!child.world.player(actor).alive) continue;
      const used = await book.askUse(child, {
        actor,
        names: allowedNames,
        targets: [],
        timing: { kind: 'counter', opportunity },
        prompt:
          subject.kind === 'effect'
            ? `是否反制【${book.definition(root.card.name).label}】对 ${root.target} 的效果？`
            : `是否反制 ${subject.use.actor} 的【${book.definition(subject.use.card.name).label}】？`,
      });
      if (used.kind === 'aborted') return child.abort(used.reason);
      if (used.value.kind !== 'used') continue;
      const outcome = used.value.use.outcome;
      if (
        !outcome ||
        typeof outcome !== 'object' ||
        !('kind' in outcome) ||
        outcome.kind !== 'counter' ||
        !('effective' in outcome) ||
        typeof outcome.effective !== 'boolean'
      )
        throw new Error('Counter card returned an invalid outcome.');
      result = {
        kind: outcome.effective ? 'countered' : 'unopposed',
        subject,
        by: useReference(used.value.use),
      };
      break;
    }
    // 最后一席准备失败或嵌套用牌也可能关闭原机会，此后不一定还有下一轮循环。
    if (!live()) result = { ...result, kind: 'unavailable' };
    child.commit('counter.finished', [], result);
    await child.window(counterFinished, immutable(result), { subject: root.target });
    return immutable(result);
  });
}
/** 反制牌本体也开放反制；只返回自己是否生效，不直接改写上层的控制句柄。 */
export async function resolveCounter(
  ctx: Context,
  use: UsePlanView,
  book: CardBook,
): Promise<CounterOutcome> {
  if (use.timing.kind !== 'counter')
    throw new Error('Counter card requires an active opportunity.');
  const opportunity = use.timing.opportunity;
  const reply = await contestCounter(ctx, book, {
    depth: opportunity.depth + 1,
    subject: { kind: 'use', use: useReference(use) },
    root: opportunity.root,
    relevant: opportunity.available,
    names: opportunity.names,
  });
  if (reply.kind === 'aborted') return ctx.abort(reply.reason);
  return immutable({
    kind: 'counter',
    effective: reply.value.kind === 'unopposed',
    against: opportunity.subject,
  });
}
export function installCounterspells(
  room: Room,
  book: CardBook,
  names: readonly string[] = ['standard:nullification'],
): () => void {
  const counterNames = immutable(names);
  return room.on(effectStarting, {
    id: 'standard:counterspell',
    owner: null,
    group: 'counter',
    eligible: (ctx, { effect, use, available }) =>
      available(ctx) &&
      book.definition(effect.card.name).counterable === true &&
      counterNames.some((name) => !effect.prohibitedCounters?.includes(name)) &&
      (!book.definition(effect.card.name).delayed || use.stage === 'delayed'),
    async run(ctx, { effect, available }) {
      const root = effectReference(effect);
      const result = await contestCounter(ctx, book, {
        subject: { kind: 'effect', effect: root },
        root,
        names: counterNames,
        relevant: available,
      });
      if (result.kind === 'aborted') return ctx.abort(result.reason);
      if (result.value.kind === 'countered' && effect.state === 'ready')
        effect.cancel(ctx, 'standard:nullification');
    },
  });
}
