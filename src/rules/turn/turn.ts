import { useSelection } from '../cards/use';
import { cardOffers, hasCardOffers, parseCardChoice } from '../cards/card';
import { handLimit } from '../cards/rule';
import { canDiscard } from '../cards/discard';
import { useCard } from '../cards/use';
import { JointSelection } from '../../core/decisions/selection';
import { immutable, isStringArray } from '../../core/model/value';
import type { Change } from '../../core/model/state';
import type { Context } from '../../core/runtime/room';
import { draw } from '../cards/draw';
import { resolveJudgmentPhase } from '../cards/delayed';
import { ownedCards } from '../cards/types';
import type { CardChoice, UseTarget, UseTiming } from '../cards/types';
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
import { defineMark } from '../state/mark';
import { activeTurn } from './state';
import type { TurnOrigin } from './state';
import { defineEvent, timing } from '../../core/runtime/event';
import { Cards } from '../cards/move';
import { Discard } from '../cards/discard';

export { activeTurn } from './state';
export type { TurnOrigin } from './state';

export const phaseKinds = ['prepare', 'judge', 'draw', 'play', 'discard', 'finish'] as const;
export type PhaseKind = (typeof phaseKinds)[number];
export interface TurnOptions {
  /** 阶段按声明顺序执行，可重复或为空；每次阶段仍有独立生存期。 */
  readonly phases?: readonly PhaseKind[];
  readonly origin?: TurnOrigin;
  readonly body?: PhaseBody;
  /** 推演副本接续原局进行中的回合与（首个）阶段：沿用它们的作用域状态，见 withLifetime 的 adopt。 */
  readonly resume?: { readonly turn: string; readonly phase?: string | null };
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
export type PhaseBody = (ctx: Context, phase: PhaseView) => unknown;
const currentPhases = new WeakMap<Context['world'], PhaseView>();
/** 只返回当前 World、当前祖先路径内仍存活的阶段；嵌套阶段返回最内层。 */
export function currentPhase(ctx: Context): PhaseView | null {
  if (!ctx.scope.active) return null;
  const phase = currentPhases.get(ctx.world);
  return phase?.lifetime.active && ctx.cause.scopePath.includes(phase.id) ? phase : null;
}
export const Phase = defineEvent('phase', {
  before: timing<PhaseView, PhaseSnapshot>(),
  started: timing<PhaseView, PhaseSnapshot>(),
  ending: timing<PhaseView>(),
  finished: timing<unknown>(),
  skipped: timing<unknown, PhaseSnapshot>(),
  skipPlanned: timing<unknown>(),
  skipScheduled: timing<unknown>(),
  skipDeclared: timing<unknown>(),
  replaceDeclared: timing<unknown>(),
});
/** 回合开始写入历史的快照。 */
export interface TurnStart {
  readonly id: string;
  readonly owner: string;
  readonly origin: TurnOrigin;
  readonly phases: readonly PhaseKind[];
}
export const Turn = defineEvent('turn', {
  started: timing<TurnView, TurnStart>(),
  ending: timing<TurnView>(),
  finished: timing<unknown>(),
  endDeclared: timing<unknown>(),
  /** 回合序列选定下一个回合（含轮数与是否额外）。 */
  advanced: timing<unknown>(),
  extraScheduled: timing<unknown>(),
  extraCancelled: timing<unknown>(),
  extraTaken: timing<unknown>(),
  extraSkipped: timing<unknown>(),
});

interface ActivePhase {
  readonly id: string;
  readonly owner: string;
  readonly kind: PhaseKind;
  readonly stage: 'before' | 'acting';
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';
/** 正在进行的阶段（全局标记）；嵌套阶段结束时恢复外层。 */
export const activePhase = defineMark<ActivePhase | null>('core:active-phase', null);
/** 阶段/回合上的原因标记：跳过、替代、结束回合、预定跳过；null 即未发生。 */
const phaseSkip = defineMark<string | null>('core:phase-skip', null);
const phaseReplacement = defineMark<string | null>('core:phase-replacement', null);
const turnEnd = defineMark<string | null>('core:turn-end', null);
const plannedSkip = defineMark<string | null>('core:planned-phase-skip', null);

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
    return this.#closed?.skipped ?? phaseSkip.of(this.ctx.world, this.owner, this.#slot()) !== null;
  }
  get replaced(): boolean {
    return (
      this.#closed?.replaced ??
      phaseReplacement.of(this.ctx.world, this.owner, this.#slot()) !== null
    );
  }
  replace(ctx: Context, reason: string): void {
    this.#assertReplacement(ctx, reason);
    if (this.replaced) return;
    ctx.commit(Phase.replaceDeclared, [this.replaceChange(ctx, reason)], {
      id: this.id,
      owner: this.owner,
      reason,
    });
  }
  replaceChange(ctx: Context, reason: string): Change {
    this.#assertReplacement(ctx, reason);
    if (this.replaced) throw new Error('Phase body is already replaced.');
    return phaseReplacement.change(ctx, this.owner, reason, this.#slot());
  }
  #assertReplacement(ctx: Context, reason: string): void {
    assertLifetime(ctx, this.lifetime);
    if (!this.#replacementOpen || this.#closed || this.skipped || !reason)
      throw new Error('Phase body can only be replaced at its start.');
  }
  skip(ctx: Context, reason: string): void {
    this.#assertBefore(ctx, reason);
    if (this.skipped) return;
    ctx.commit(Phase.skipDeclared, [this.skipChange(ctx, reason)], {
      id: this.id,
      owner: this.owner,
      reason,
    });
  }
  skipChange(ctx: Context, reason: string): Change {
    this.#assertBefore(ctx, reason);
    if (this.skipped) throw new Error('Phase is already skipped.');
    return phaseSkip.change(ctx, this.owner, reason, this.#slot());
  }
  #slot() {
    return { lifetime: this.lifetime };
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
        phaseSkip.of(this.ctx.world, this.owner, this.#slot()) ??
        phaseReplacement.of(this.ctx.world, this.owner, this.#slot()),
    });
  }
  close(): void {
    this.#closed = this.snapshot();
  }
}

/** 主动用牌的主持侧决策；回复不携带 actor、timing 或 generated 指令。 */
export async function playPhase(ctx: Context, phase: PhaseView): Promise<void> {
  const timing = phase.playTiming();
  while (ctx.world.player(phase.owner).alive && !phase.turn?.ended && !isGameOver(ctx.world)) {
    const describe = () => ({
      phase: phase.snapshot(),
      offers: [...cardOffers(ctx, phase.owner, timing), ...activeOffers(ctx, phase)],
      targets: ctx.world.snapshot.players
        .filter((player) => player.alive)
        .map((player) => ({ id: player.id, hp: player.hp })),
    });
    const answer = await ctx.ask<
      | ActiveChoice
      | {
          readonly choice: CardChoice;
          readonly targets: readonly UseTarget[];
        }
    >({
      player: phase.owner,
      kind: 'play-action',
      prompt: '使用牌、发动技能，或结束出牌阶段',
      describe,
      optional: true,
      available: () => hasCardOffers(ctx, phase.owner, timing) || activeAvailable(ctx, phase),
      feedback: (input) => {
        if (isRecord(input) && 'instance' in input) {
          return inspectActive(ctx, phase, input);
        }
        if (!isRecord(input) || !isStringArray(input.targets)) return null;
        const choice = parseCardChoice(input.choice);
        return choice.ok
          ? useSelection(ctx, { actor: phase.owner, choice: choice.value, timing }).feedback?.({
              cards: [],
              targets: input.targets,
            })
          : null;
      },
      validate: (input) => {
        if (isRecord(input) && 'instance' in input) return validateActive(ctx, phase, input);
        if (!isRecord(input) || !isStringArray(input.targets))
          return { ok: false, reason: 'Expected card choice and targets.' };
        const choice = parseCardChoice(input.choice);
        if (!choice.ok) return choice;
        const selected = useSelection(ctx, {
          actor: phase.owner,
          choice: choice.value,
          timing,
        }).validate({ cards: [], targets: input.targets });
        return selected.ok
          ? { ok: true, value: { choice: choice.value, ...selected.value } }
          : selected;
      },
    });
    if (answer.kind !== 'chosen') break;
    if ('instance' in answer.value) {
      await activate(ctx, phase, answer.value);

      continue;
    }
    await useCard(ctx, {
      actor: phase.owner,
      choice: answer.value.choice,
      targets: answer.value.targets,
      timing,
    });
  }
}

/** 默认阶段体：判定区结算、摸牌、主动用牌和弃牌各自复用规则管线。 */
export async function defaultPhaseBody(ctx: Context, phase: PhaseView): Promise<void> {
  switch (phase.kind) {
    case 'draw':
      await draw(ctx, { player: phase.owner, count: 2, reason: 'draw-phase', phase });
      break;
    case 'play':
      await playPhase(ctx, phase);
      break;
    case 'discard': {
      const cards = ownedCards(ctx.world, phase.owner);
      const excess = Math.max(0, cards.length - handLimit(ctx, phase.owner));
      if (!excess) break;
      const selectable = () =>
        ownedCards(ctx.world, phase.owner).filter((card) =>
          canDiscard(ctx, {
            actor: phase.owner,
            owner: phase.owner,
            card,
            reason: 'discard-phase',
          }),
        );
      const count = Math.min(excess, selectable().length);
      if (count < excess)
        ctx.commit(Discard.limited, [], { actor: phase.owner, required: excess, count });
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
          factKind: Cards.discarded,
          declaration: { phaseId: phase.id },
          legal: () => model.validate(answer.value).ok,
        });
      break;
    }
    case 'prepare':
    case 'finish':
      break;
    case 'judge':
      await resolveJudgmentPhase(ctx, phase);
      break;
  }
}

export function runPhase(
  ctx: Context,
  owner: string,
  kind: PhaseKind,
  body: PhaseBody = defaultPhaseBody,
  turn: TurnView | null = null,
  adopt: string | null = null,
): Promise<PhaseResult> {
  return ctx.flow('phase', async (host) => {
    const previous = activePhase.of(host.world);
    let control: PhaseControl | null = null;
    const result = await host.attempt('phase.body', (at) =>
      withLifetime(
        at,
        kind,
        async (child, lifetime): Promise<PhaseResult> => {
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
            Phase.before,
            [activePhase.change(child, null, { id: phase.id, owner, kind, stage: 'before' })],
            phase.snapshot(),
          );
          if (turn && turn.owner === owner) {
            const slot = { source: kind, lifetime: turn.lifetime };
            const reason = plannedSkip.of(child.world, owner, slot);
            if (reason)
              child.commit(
                Phase.skipPlanned,
                [phase.skipChange(child, reason), plannedSkip.change(child, owner, null, slot)],
                { id: phase.id, owner, kind, reason },
              );
          }
          await child.window(Phase.before, phase, { subject: owner });
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
            child.commit(Phase.skipped, [], phase.snapshot());
            return { phase: phase.snapshot(), exit: 'skipped', reason: phase.snapshot().reason };
          }
          child.commit(
            Phase.started,
            [activePhase.change(child, null, { id: phase.id, owner, kind, stage: 'acting' })],
            phase.snapshot(),
          );
          await child.window(Phase.started, phase, { subject: owner });
          phase.finishStart();
          if (
            !phase.replaced &&
            child.world.player(owner).alive &&
            !turn?.ended &&
            !isGameOver(child.world)
          )
            await body(child, phase);
          await child.window(Phase.ending, phase, { subject: owner });
          return {
            phase: phase.snapshot(),
            exit: phase.replaced ? 'replaced' : 'completed',
            reason: phase.snapshot().reason,
          };
        },
        adopt,
      ),
    );
    const phase = (control as PhaseControl | null)?.snapshot();
    if (!phase) throw new Error('Phase did not initialize.');
    const summary: PhaseResult =
      result.kind === 'resolved' ? result.value : { phase, exit: 'aborted', reason: result.reason };
    host.commit(Phase.finished, [activePhase.change(host, null, previous)], summary);
    return immutable(summary);
  });
}

export function runTurn(
  ctx: Context,
  owner: string,
  options: TurnOptions = {},
): Promise<TurnResult> {
  const phases = immutable(options.phases ?? phaseKinds);
  const origin: TurnOrigin = immutable(options.origin ?? { kind: 'normal' });
  const body = options.body ?? defaultPhaseBody;
  if (
    !phases.every((kind) => phaseKinds.includes(kind)) ||
    (origin.kind !== 'normal' && !(origin.kind === 'extra' && origin.id && origin.reason))
  )
    throw new Error('Invalid turn plan.');
  return ctx.flow('turn', async (host) => {
    const previous = activeTurn.of(host.world);
    const result = await host.attempt('turn.body', (at) =>
      withLifetime(
        at,
        'turn',
        async (child, lifetime) => {
          const slot = { lifetime };
          let finalReason: string | null = null;
          child.defer(() => {
            finalReason = turnEnd.of(child.world, owner, slot);
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
              return lifetime.active ? turnEnd.of(child.world, owner, slot) : finalReason;
            },
            end: (at: Context, reason: string) => {
              assertLifetime(at, lifetime);
              if (!reason) throw new Error('Ending a turn requires a reason.');
              if (turnEnd.of(at.world, owner, slot) !== null) return;
              at.commit(Turn.endDeclared, [turnEnd.change(at, owner, reason, slot)], {
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
                Phase.skipScheduled,
                [plannedSkip.change(at, owner, reason, { source: kind, lifetime })],
                { turn: lifetime.id, owner, kind, reason },
              );
            },
          });
          child.commit(
            Turn.started,
            [activeTurn.change(child, null, { id: turn.id, owner, origin })],
            { id: turn.id, owner, origin, phases },
          );
          await child.window(Turn.started, turn, { subject: owner });
          const results: PhaseResult[] = [];
          for (const [index, kind] of phases.entries()) {
            if (turn.ended || !child.world.player(owner).alive || isGameOver(child.world)) break;
            const adopt = index === 0 ? (options.resume?.phase ?? null) : null;
            const phase = await runPhase(child, owner, kind, body, turn, adopt);

            results.push(phase);
          }
          await child.window(Turn.ending, turn, { subject: owner });
          return immutable({
            id: turn.id,
            owner,
            origin,
            ended: turn.ended,
            reason: turn.reason,
            phases: results,
          });
        },
        options.resume?.turn,
      ),
    );
    host.commit(Turn.finished, [activeTurn.change(host, null, previous)], {
      owner,
      exit: result.kind,
      result: result.kind === 'resolved' ? result.value : result.reason,
    });
    if (result.kind === 'aborted') return host.abort(result.reason);
    return result.value;
  });
}
