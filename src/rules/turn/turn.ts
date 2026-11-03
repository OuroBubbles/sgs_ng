import { JointSelection } from '../../core/decisions/selection';
import { immutable, isStringArray } from '../../core/model/value';
import type { Change } from '../../core/model/state';
import type { Context } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import { parseCardChoice } from '../cards/book';
import type { CardBook } from '../cards/book';
import { draw } from '../cards/draw';
import { resolveJudgmentPhase } from '../cards/delayed';
import { ownedCards } from '../cards/types';
import type { CardChoice, UseTiming } from '../cards/types';
import { payDiscard } from '../costs/pay';
import { isGameOver } from '../game/end';
import {
  activeOffers,
  activeAvailable,
  validateActive,
  inspectActive,
  activate,
} from '../skills/active';
import type { ActiveChoice } from '../skills/active';
import { withLifetime, assertLifetime } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';
import { defineState, readState, stateChange } from '../state/state';
import { activeTurn, activeTarget, validTurnOrigin } from './state';
import type { TurnOrigin } from './state';
export { activeTurn, activeTarget, validTurnOrigin } from './state';
export type { TurnOrigin } from './state';

export const phaseKinds = ['prepare', 'judge', 'draw', 'play', 'discard', 'finish'] as const;
export type PhaseKind = (typeof phaseKinds)[number];
export interface TurnOptions {
  /** 阶段按声明顺序执行，可重复或为空；每次阶段仍有独立生存期。 */
  readonly phases?: readonly PhaseKind[];
  readonly origin?: TurnOrigin;
  readonly body?: PhaseBody;
}
export interface TurnView {
  readonly id: string;
  readonly owner: string;
  readonly lifetime: Lifetime;
  readonly origin: TurnOrigin;
  readonly phases: readonly PhaseKind[];
  readonly ended: boolean;
  readonly reason: string | null;
  end(ctx: Context, reason: string): void;
  skipNext(ctx: Context, kind: PhaseKind, reason: string): void;
}
export interface PhaseSnapshot {
  readonly id: string;
  readonly owner: string;
  readonly kind: PhaseKind;
  readonly skipped: boolean;
  readonly replaced: boolean;
  readonly reason: string | null;
}
export interface PhaseView {
  readonly id: string;
  readonly owner: string;
  readonly kind: PhaseKind;
  readonly lifetime: Lifetime;
  readonly turn: TurnView | null;
  readonly skipped: boolean;
  readonly replaced: boolean;
  skip(ctx: Context, reason: string): void;
  skipChange(ctx: Context, reason: string): Change;
  /** 仅在 phaseStarted 中声明替代默认阶段体；不会冒充跳阶段或强行中断正在运行的子流程。 */
  replace(ctx: Context, reason: string): void;
  replaceChange(ctx: Context, reason: string): Change;
  playTiming(): Extract<UseTiming, { kind: 'play' }>;
  snapshot(): PhaseSnapshot;
}
export interface PhaseResult {
  readonly phase: PhaseSnapshot;
  readonly exit: 'completed' | 'skipped' | 'replaced' | 'aborted';
  readonly reason: string | null;
}
export interface TurnResult {
  readonly id: string;
  readonly owner: string;
  readonly origin: TurnOrigin;
  readonly ended: boolean;
  readonly reason: string | null;
  readonly phases: readonly PhaseResult[];
}
/** 等待阶段体完成；阶段结果仍由阶段流程产生。 */
export type PhaseBody = (ctx: Context, phase: PhaseView, book: CardBook) => unknown;
const currentPhases = new WeakMap<Context['world'], PhaseView>();
/** 只返回当前 World、当前祖先路径内仍存活的阶段；嵌套阶段返回最内层。 */
export function currentPhase(ctx: Context): PhaseView | null {
  if (!ctx.scope.active) return null;
  const phase = currentPhases.get(ctx.world);
  return phase?.lifetime.active && ctx.cause.scopePath.includes(phase.id) ? phase : null;
}
export const phaseBefore = defineWindow<PhaseView>('phase.before');
export const phaseStarted = defineWindow<PhaseView>('phase.started');
export const phaseEnding = defineWindow<PhaseView>('phase.ending');
export const turnStarted = defineWindow<TurnView>('turn.started');
export const turnEnding = defineWindow<TurnView>('turn.ending');

interface ActivePhase {
  readonly id: string;
  readonly owner: string;
  readonly kind: PhaseKind;
  readonly stage: 'before' | 'acting';
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';
export const activePhase = defineState<ActivePhase | null>(
  'core:active-phase',
  null,
  (value): value is ActivePhase | null =>
    value === null ||
    (isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.owner === 'string' &&
      phaseKinds.some((kind) => value.kind === kind) &&
      (value.stage === 'before' || value.stage === 'acting')),
);
const phaseSkip = defineState<string | null>(
  'core:phase-skip',
  null,
  (value): value is string | null =>
    value === null || (typeof value === 'string' && value.length > 0),
);
const phaseReplacement = defineState<string | null>(
  'core:phase-replacement',
  null,
  (value): value is string | null =>
    value === null || (typeof value === 'string' && value.length > 0),
);
const turnEnd = defineState<string | null>(
  'core:turn-end',
  null,
  (value): value is string | null =>
    value === null || (typeof value === 'string' && value.length > 0),
);
const plannedSkip = defineState<string | null>(
  'core:planned-phase-skip',
  null,
  (value): value is string | null =>
    value === null || (typeof value === 'string' && value.length > 0),
);

class PhaseControl implements PhaseView {
  #closed: PhaseSnapshot | null = null;
  #before = true;
  #replacementOpen = false;
  constructor(
    readonly owner: string,
    readonly kind: PhaseKind,
    readonly lifetime: Lifetime,
    readonly turn: TurnView | null,
    private readonly ctx: Context,
  ) {}
  get id(): string {
    return this.lifetime.id;
  }
  get skipped(): boolean {
    return this.#closed?.skipped ?? readState(this.ctx.world, phaseSkip, this.#target()) !== null;
  }
  get replaced(): boolean {
    return (
      this.#closed?.replaced ?? readState(this.ctx.world, phaseReplacement, this.#target()) !== null
    );
  }
  replace(ctx: Context, reason: string): void {
    this.#assertReplacement(ctx, reason);
    if (this.replaced) return;
    ctx.commit('phase.replace.declared', [this.replaceChange(ctx, reason)], {
      id: this.id,
      owner: this.owner,
      reason,
    });
  }
  replaceChange(ctx: Context, reason: string): Change {
    this.#assertReplacement(ctx, reason);
    if (this.replaced) throw new Error('Phase body is already replaced.');
    return stateChange(ctx, phaseReplacement, this.#target(), reason);
  }
  #assertReplacement(ctx: Context, reason: string): void {
    assertLifetime(ctx, this.lifetime);
    if (!this.#replacementOpen || this.#closed || this.skipped || !reason)
      throw new Error('Phase body can only be replaced at its start.');
  }
  skip(ctx: Context, reason: string): void {
    this.#assertBefore(ctx, reason);
    if (this.skipped) return;
    ctx.commit('phase.skip.declared', [this.skipChange(ctx, reason)], {
      id: this.id,
      owner: this.owner,
      reason,
    });
  }
  skipChange(ctx: Context, reason: string): Change {
    this.#assertBefore(ctx, reason);
    if (this.skipped) throw new Error('Phase is already skipped.');
    return stateChange(ctx, phaseSkip, this.#target(), reason);
  }
  #target() {
    return { owner: this.owner, source: null, lifetime: this.lifetime };
  }
  #assertBefore(ctx: Context, reason: string): void {
    assertLifetime(ctx, this.lifetime);
    if (!this.#before || this.#closed || !reason)
      throw new Error('Phase can only be skipped before it starts.');
  }
  start(): void {
    this.#before = false;
    this.#replacementOpen = !this.skipped;
  }
  finishStart(): void {
    this.#replacementOpen = false;
  }
  playTiming(): Extract<UseTiming, { kind: 'play' }> {
    if (
      this.kind !== 'play' ||
      this.#before ||
      this.#closed ||
      this.skipped ||
      !this.lifetime.active
    )
      throw new Error('No active play timing.');
    return Object.freeze({ kind: 'play', owner: this.owner, phase: this.lifetime });
  }
  snapshot(): PhaseSnapshot {
    if (this.#closed) return this.#closed;
    return immutable({
      id: this.id,
      owner: this.owner,
      kind: this.kind,
      skipped: this.skipped,
      replaced: this.replaced,
      reason:
        readState(this.ctx.world, phaseSkip, this.#target()) ??
        readState(this.ctx.world, phaseReplacement, this.#target()),
    });
  }
  close(): void {
    this.#closed = this.snapshot();
  }
}

/** 主动用牌的主持侧决策；回复不携带 actor、timing 或 generated 指令。 */
export async function playPhase(ctx: Context, phase: PhaseView, book: CardBook): Promise<void> {
  const timing = phase.playTiming();
  while (ctx.world.player(phase.owner).alive && !phase.turn?.ended && !isGameOver(ctx.world)) {
    const describe = () => ({
      phase: phase.snapshot(),
      offers: [...book.offers(ctx, phase.owner, timing), ...activeOffers(ctx, book, phase)],
      targets: ctx.world.snapshot.players
        .filter((player) => player.alive)
        .map((player) => ({ id: player.id, hp: player.hp })),
    });
    const answer = await ctx.ask<
      | ActiveChoice
      | {
          readonly choice: CardChoice;
          readonly targets: readonly string[];
          readonly parameters?: unknown;
        }
    >({
      player: phase.owner,
      kind: 'play-action',
      prompt: '使用牌、发动技能，或结束出牌阶段',
      describe,
      optional: true,
      available: () =>
        book.hasOffers(ctx, phase.owner, timing) || activeAvailable(ctx, book, phase),
      feedback: (input) => {
        if (isRecord(input) && 'instance' in input) {
          return inspectActive(ctx, book, phase, input);
        }
        if (!isRecord(input) || !isStringArray(input.targets)) return null;
        const choice = parseCardChoice(input.choice);
        return choice.ok
          ? book
              .useSelection(ctx, {
                actor: phase.owner,
                choice: choice.value,
                timing,
              })
              .feedback?.({ cards: [], targets: input.targets })
          : null;
      },
      validate: (input) => {
        if (isRecord(input) && 'instance' in input) return validateActive(ctx, book, phase, input);
        if (!isRecord(input) || !isStringArray(input.targets))
          return { ok: false, reason: 'Expected card choice and targets.' };
        const choice = parseCardChoice(input.choice);
        if (!choice.ok) return choice;
        const selected = book
          .useSelection(ctx, { actor: phase.owner, choice: choice.value, timing })
          .validate({ cards: [], targets: input.targets });
        return selected.ok
          ? { ok: true, value: { choice: choice.value, ...selected.value } }
          : selected;
      },
    });
    if (answer.kind !== 'chosen') break;
    if ('instance' in answer.value) {
      await activate(ctx, book, phase, answer.value);

      continue;
    }
    await book.use(ctx, {
      actor: phase.owner,
      choice: answer.value.choice,
      targets: answer.value.targets,
      timing,
      ...(answer.value.parameters === undefined ? {} : { parameters: answer.value.parameters }),
    });
  }
}

/** 默认阶段体：判定区结算、摸牌、主动用牌和弃牌各自复用规则管线。 */
export async function defaultPhaseBody(
  ctx: Context,
  phase: PhaseView,
  book: CardBook,
): Promise<void> {
  switch (phase.kind) {
    case 'draw':
      await draw(ctx, { player: phase.owner, count: 2, reason: 'draw-phase', phase });
      break;
    case 'play':
      await playPhase(ctx, phase, book);
      break;
    case 'discard': {
      const cards = ownedCards(ctx.world, phase.owner);
      const excess = Math.max(0, cards.length - book.handLimit(ctx, phase.owner));
      if (!excess) break;
      const selectable = () =>
        ownedCards(ctx.world, phase.owner).filter((card) =>
          book.canDiscard(ctx, {
            actor: phase.owner,
            owner: phase.owner,
            card,
            reason: 'discard-phase',
          }),
        );
      const count = Math.min(excess, selectable().length);
      if (count < excess)
        ctx.commit('discard.limited', [], { actor: phase.owner, required: excess, count });
      if (!count) break;
      const model = new JointSelection({
        cards: () => selectable().map((id) => ({ id, label: ctx.world.card(id).name })),
        cardCount: { min: count, max: count },
      });
      const answer = await ctx.ask(model.decision(phase.owner, `弃置 ${count} 张手牌`));
      if (answer.kind === 'chosen')
        await payDiscard(ctx, {
          actor: phase.owner,
          cards: answer.value.cards,
          reason: 'discard-phase',
          areas: ['hand'],
          factKind: 'cards.discarded',
          declaration: { phaseId: phase.id },
          legal: () => model.validate(answer.value).ok,
        });
      break;
    }
    case 'prepare':
    case 'finish':
      break;
    case 'judge':
      await resolveJudgmentPhase(ctx, phase, book);
      break;
  }
}

export function runPhase(
  ctx: Context,
  book: CardBook,
  owner: string,
  kind: PhaseKind,
  body: PhaseBody = defaultPhaseBody,
  turn: TurnView | null = null,
): Promise<PhaseResult> {
  return ctx.flow('phase', async (host) => {
    const previous = readState(host.world, activePhase, activeTarget);
    let control: PhaseControl | null = null;
    const result = await host.attempt('phase.body', (at) =>
      withLifetime(at, kind, async (child, lifetime): Promise<PhaseResult> => {
        const phase = new PhaseControl(owner, kind, lifetime, turn, child);
        const previousControl = currentPhases.get(child.world);
        currentPhases.set(child.world, phase);
        child.defer(() => {
          if (previousControl) currentPhases.set(child.world, previousControl);
          else currentPhases.delete(child.world);
        });
        child.defer(() => phase.close());
        control = phase;
        child.commit(
          'phase.before',
          [
            stateChange(child, activePhase, activeTarget, {
              id: phase.id,
              owner,
              kind,
              stage: 'before',
            }),
          ],
          phase.snapshot(),
        );
        if (turn && turn.owner === owner) {
          const target = { owner, source: kind, lifetime: turn.lifetime };
          const reason = readState(child.world, plannedSkip, target);
          if (reason)
            child.commit(
              'phase.skip.planned',
              [phase.skipChange(child, reason), stateChange(child, plannedSkip, target, null)],
              { id: phase.id, owner, kind, reason },
            );
        }
        await child.window(phaseBefore, phase, { subject: owner });
        if (
          !phase.skipped &&
          (!child.world.player(owner).alive || turn?.ended || isGameOver(child.world))
        )
          phase.skip(
            child,
            !child.world.player(owner).alive
              ? 'Owner no longer alive.'
              : isGameOver(child.world)
                ? 'Game finished.'
                : 'Turn ended.',
          );
        phase.start();
        if (phase.skipped) {
          child.commit('phase.skipped', [], phase.snapshot());
          return { phase: phase.snapshot(), exit: 'skipped', reason: phase.snapshot().reason };
        }
        child.commit(
          'phase.started',
          [
            stateChange(child, activePhase, activeTarget, {
              id: phase.id,
              owner,
              kind,
              stage: 'acting',
            }),
          ],
          phase.snapshot(),
        );
        await child.window(phaseStarted, phase, { subject: owner });
        phase.finishStart();
        if (
          !phase.replaced &&
          child.world.player(owner).alive &&
          !turn?.ended &&
          !isGameOver(child.world)
        )
          await body(child, phase, book);
        await child.window(phaseEnding, phase, { subject: owner });
        return {
          phase: phase.snapshot(),
          exit: phase.replaced ? 'replaced' : 'completed',
          reason: phase.snapshot().reason,
        };
      }),
    );
    const phase = (control as PhaseControl | null)?.snapshot();
    if (!phase) throw new Error('Phase did not initialize.');
    const summary: PhaseResult =
      result.kind === 'resolved' ? result.value : { phase, exit: 'aborted', reason: result.reason };
    host.commit(
      'phase.finished',
      [stateChange(host, activePhase, activeTarget, previous)],
      summary,
    );
    return immutable(summary);
  });
}

export function runTurn(
  ctx: Context,
  book: CardBook,
  owner: string,
  options: TurnOptions = {},
): Promise<TurnResult> {
  const phases = immutable(options.phases ?? phaseKinds);
  const origin = immutable(options.origin ?? { kind: 'normal' });
  const body = options.body ?? defaultPhaseBody;
  if (!phases.every((kind) => phaseKinds.includes(kind)) || !validTurnOrigin(origin))
    throw new Error('Invalid turn plan.');
  return ctx.flow('turn', async (host) => {
    const previous = readState(host.world, activeTurn, activeTarget);
    const result = await host.attempt('turn.body', (at) =>
      withLifetime(at, 'turn', async (child, lifetime) => {
        const target = { owner, source: null, lifetime };
        let finalReason: string | null = null;
        child.defer(() => {
          finalReason = readState(child.world, turnEnd, target);
        });
        const turn: TurnView = Object.freeze({
          id: lifetime.id,
          owner,
          lifetime,
          origin,
          phases,
          get ended() {
            return this.reason !== null;
          },
          get reason() {
            return lifetime.active ? readState(child.world, turnEnd, target) : finalReason;
          },
          end: (at: Context, reason: string) => {
            assertLifetime(at, lifetime);
            if (!reason) throw new Error('Ending a turn requires a reason.');
            if (readState(at.world, turnEnd, target) !== null) return;
            at.commit('turn.end.declared', [stateChange(at, turnEnd, target, reason)], {
              id: lifetime.id,
              owner,
              reason,
            });
          },
          skipNext: (at: Context, kind: PhaseKind, reason: string) => {
            assertLifetime(at, lifetime);
            if (!phaseKinds.includes(kind) || !reason)
              throw new Error('Invalid planned phase skip.');
            at.commit(
              'phase.skip.scheduled',
              [stateChange(at, plannedSkip, { owner, source: kind, lifetime }, reason)],
              { turn: lifetime.id, owner, kind, reason },
            );
          },
        });
        child.commit(
          'turn.started',
          [stateChange(child, activeTurn, activeTarget, { id: turn.id, owner, origin })],
          { id: turn.id, owner, origin, phases },
        );
        await child.window(turnStarted, turn, { subject: owner });
        const results: PhaseResult[] = [];
        for (const kind of phases) {
          if (turn.ended || !child.world.player(owner).alive || isGameOver(child.world)) break;
          const phase = await runPhase(child, book, owner, kind, body, turn);

          results.push(phase);
        }
        await child.window(turnEnding, turn, { subject: owner });
        return immutable({
          id: turn.id,
          owner,
          origin,
          ended: turn.ended,
          reason: turn.reason,
          phases: results,
        });
      }),
    );
    host.commit('turn.finished', [stateChange(host, activeTurn, activeTarget, previous)], {
      owner,
      exit: result.kind,
      result: result.kind === 'resolved' ? result.value : result.reason,
    });
    if (result.kind === 'aborted') return host.abort(result.reason);
    return result.value;
  });
}
