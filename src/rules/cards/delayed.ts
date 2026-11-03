import type { Change, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context, Room } from '../../core/runtime/room';
import type { PhaseView } from '../turn/turn';
import { defineState, stateChange } from '../state/state';
import { isGameOver } from '../game/end';
import type { CardBook } from './book';
import type {
  CardDefinition,
  CardEffect,
  CardUseRef,
  EffectRef,
  EffectSnapshot,
  SemanticCard,
} from './types';
import { moveCards, Cards } from './move';
import { withProcessing } from './processing';
import { Death } from '../combat/life-events';
import { defineEvent } from '../../core/runtime/event';
import { timing } from '../../core/runtime/event';

export const Delayed = defineEvent('delayed', {
  placed: timing<unknown>(),
  effectDeclared: timing<unknown>(),
  effectFinished: timing<unknown>(),
  removed: timing<unknown>(),
  resolving: timing<unknown>(),
});

/** 判定阶段的具名输入；正常生效保留可操作效果，取消后效使用已封口快照。 */
export interface DelayedInput<Effect extends EffectRef = CardEffect> {
  readonly effect: Effect;
  readonly book: CardBook;
  readonly phase: PhaseView;
}
export interface DelayedRules {
  readonly resolve: (ctx: Context, input: DelayedInput) => unknown;
  readonly cancelled?: (ctx: Context, input: DelayedInput<EffectSnapshot>) => unknown;
}
export interface DelayedCard {
  readonly id: string;
  readonly owner: string;
  readonly source: CardUseRef;
  readonly cards: readonly string[];
  readonly stateId: string;
}
const binding = defineState<CardUseRef | null>(
  'core:delayed-card',
  null,
  (value): value is CardUseRef | null =>
    value === null ||
    (typeof value === 'object' &&
      'useId' in value &&
      typeof value.useId === 'string' &&
      'card' in value),
);

/** 每张延时牌拥有独立的持久区域与宣告快照；材料名不覆盖转化后的牌名。 */
export function delayedCards(
  world: WorldReader,
  owner?: string,
  includeBroken = false,
): readonly DelayedCard[] {
  return world.snapshot.states
    .filter((state) => state.key === binding.id && (owner === undefined || state.owner === owner))
    .flatMap((state) => {
      const zone = world.snapshot.zones.find(
        (zone) => zone.id === state.source && zone.kind === 'judgment',
      );
      const source = state.value as CardUseRef | null;
      if (!zone || zone.owner === null || !source) return [];
      if (zone.owner !== state.owner) throw new Error('Delayed owner does not match its zone.');
      if (!includeBroken && !source.card.materials.every((id) => zone.cards.includes(id)))
        return [];
      return [{ id: zone.id, owner: zone.owner, source, cards: zone.cards, stateId: state.id }];
    });
}

export function canPlaceDelayed(
  ctx: Context,
  book: CardBook,
  source: CardUseRef,
  owner: string,
): boolean {
  return ctx.query(
    () =>
      ctx.world.player(owner).alive &&
      !isGameOver(ctx.world) &&
      !book.isTargetProhibited(ctx, source.actor, owner, source.card) &&
      !delayedCards(ctx.world, owner).some((entry) => entry.source.card.name === source.card.name),
  );
}

export function placeDelayed(
  ctx: Context,
  book: CardBook,
  source: CardUseRef,
  owner: string,
): Promise<'placed' | 'unavailable'> {
  const input = immutable(source);
  return ctx.flow('delayed.place', async (child) => {
    if (!book.definition(input.card.name).delayed)
      throw new Error('Card has no delayed definition.');
    if (
      !canPlaceDelayed(child, book, input, owner) ||
      input.card.materials.some((id) => child.world.position(id) !== input.processing)
    )
      return 'unavailable';
    const zone = `judgment:${child.cause.flowId}`;
    const changes: Exclude<Change, { kind: 'move' }>[] = [
      { kind: 'createZone', zone: { id: zone, kind: 'judgment', owner, scopeId: null, cards: [] } },
      stateChange(child, binding, { owner, source: zone, lifetime: null }, input),
    ];
    await moveCards(
      child,
      [{ cards: input.card.materials, from: input.processing, to: zone, place: 'bottom' }],
      input.card.name,
      { kind: Delayed.placed, data: { zone, owner, source: input }, changes },
    );

    return 'placed';
  });
}

/** 获得/弃置一个逻辑判定牌时整体处置实时材料，并同次移除身份，零材料牌也可移除。 */
export function moveDelayed(
  ctx: Context,
  id: string,
  to: string,
): Promise<
  | {
      readonly kind: 'moved';
      readonly owner: string;
      readonly card: SemanticCard;
      readonly cards: readonly string[];
    }
  | { readonly kind: 'unavailable' }
> {
  return ctx.flow('delayed.move', async (child) => {
    const entry = delayedCards(child.world, undefined, true).find((entry) => entry.id === id);
    if (!entry) return { kind: 'unavailable' };
    const result = immutable({
      kind: 'moved' as const,
      owner: entry.owner,
      card: entry.source.card,
      cards: entry.cards,
    });
    await moveCards(
      child,
      [{ cards: entry.cards, from: entry.id, to, place: 'bottom' }],
      'delayed card removed',
      {
        kind: Delayed.removed,
        data: { ...result, zone: entry.id, to },
        changes: [
          { kind: 'removeState', state: entry.stateId },
          { kind: 'removeZone', zone: entry.id },
        ],
      },
    );

    return result;
  });
}

export function delayedCard(
  input: {
    readonly id: string;
    readonly label: string;
    readonly self?: boolean;
  } & DelayedRules,
): CardDefinition {
  const { id, label, self = false, resolve, cancelled } = input;
  const source = (effect: CardEffect): CardUseRef => ({
    useId: effect.useId,
    actor: effect.actor,
    card: effect.card,
    processing: effect.processing,
    ...(effect.prohibitedCounters?.length ? { prohibitedCounters: effect.prohibitedCounters } : {}),
  });
  return {
    id,
    type: 'trick',
    label,
    counterable: true,
    delayed: {
      resolve: resolve.bind(input),
      ...(cancelled === undefined ? {} : { cancelled: cancelled.bind(input) }),
    },
    use: {
      count: { min: self ? 0 : 1, max: self ? 0 : 1 },
      ...(self ? { fixedTargets: (_ctx: Context, { actor }) => [actor] } : {}),
      target: (ctx, { request, target }) =>
        (self ? target === request.actor : target !== request.actor) &&
        !delayedCards(ctx.world, target).some(
          (entry) => entry.source.card.name === request.card.name,
        ),
      canUse: (_ctx, { request }) =>
        request.targets.length === 1 ? null : 'Delayed card requires a target.',
      async resolve(ctx, { effect, book }) {
        await placeDelayed(ctx, book, source(effect), effect.target);
      },
    },
  };
}

/** 判定阶段只处理开始时已有的实例，后置者先结算；移入的新实例留待下次判定阶段。 */
export async function resolveJudgmentPhase(
  ctx: Context,
  phase: PhaseView,
  book: CardBook,
): Promise<void> {
  const pending = [...delayedCards(ctx.world, phase.owner)].reverse();
  for (const snapshot of pending) {
    if (!ctx.world.player(phase.owner).alive || phase.turn?.ended || isGameOver(ctx.world)) break;
    const entry = delayedCards(ctx.world, phase.owner).find((entry) => entry.id === snapshot.id);
    if (!entry) continue;
    const rules = book.definition(entry.source.card.name).delayed;
    if (!rules) throw new Error('Placed card lost its delayed definition.');
    await withProcessing(ctx, [], async (at, processing) => {
      await moveCards(
        at,
        [{ cards: entry.cards, from: entry.id, to: processing.zone, place: 'bottom' }],
        entry.source.card.name,
        {
          kind: Delayed.resolving,
          data: { entry, processing: processing.zone },
          changes: [
            { kind: 'removeState', state: entry.stateId },
            { kind: 'removeZone', zone: entry.id },
          ],
        },
      );

      const result = await book.resolveDelayed(
        at,
        { ...entry.source, processing: processing.zone },
        phase.owner,
        (child, { effect }) => rules.resolve(child, { effect, book, phase }),
      );

      for (const effect of result.effects)
        if (effect.state === 'cancelled' && rules.cancelled)
          await rules.cancelled(at, { effect, book, phase });
    });
  }
}

/** 材料被直接拆走时关闭破损实例；不靠另一份技能授予列表维持有效性。 */
export function installDelayedCards(room: Room): () => void {
  const releaseMoved = room.on(Cards.moved, {
    id: 'core:delayed-cleanup',
    owner: null,
    group: 'attachments',
    eligible: (ctx) =>
      delayedCards(ctx.world, undefined, true).some((entry) =>
        entry.source.card.materials.some((id) => ctx.world.position(id) !== entry.id),
      ),
    async run(ctx) {
      for (const entry of delayedCards(ctx.world, undefined, true))
        if (entry.source.card.materials.some((id) => ctx.world.position(id) !== entry.id))
          await moveDelayed(ctx, entry.id, 'discard');
    },
  });
  const releaseBuried = room.on(Death.buried, {
    id: 'core:delayed-burial',
    owner: null,
    eligible: (ctx, death) => delayedCards(ctx.world, death.player, true).length > 0,
    async run(ctx, death) {
      for (const entry of delayedCards(ctx.world, death.player, true))
        await moveDelayed(ctx, entry.id, 'discard');
    },
  });
  return () => {
    releaseMoved();
    releaseBuried();
  };
}
