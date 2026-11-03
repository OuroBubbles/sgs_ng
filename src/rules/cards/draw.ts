import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { moveCards, Cards } from './move';
import { isGameOver } from '../game/end';
import type { PhaseSnapshot, PhaseView } from '../turn/turn';
import { assertLifetime } from '../scopes/lifetime';
import { defineEvent } from '../../core/runtime/event';
import { timing } from '../../core/runtime/event';

export const Draw = defineEvent('draw', {
  completed: timing<unknown>(),
});

export const Deck = defineEvent('deck', {
  reshuffled: timing<unknown>(),
});

export interface DrawInput {
  readonly player: string;
  readonly count: number;
  readonly reason: string;
  readonly phase?: PhaseSnapshot;
}
export interface DrawRequest extends Omit<DrawInput, 'phase'> {
  /** 只有阶段规则的这次摸牌显式传入；阶段内嵌套的技能摸牌不会自动继承。 */
  readonly phase?: PhaseView;
}
export interface DrawDraft {
  readonly input: DrawInput;
  readonly phase: PhaseView | null;
  readonly count: number;
  readonly edits: readonly {
    readonly before: number;
    readonly after: number;
    readonly reason: string;
  }[];
  setCount(count: number, reason: string): void;
}
export interface DrawResult {
  readonly kind: 'drawn' | 'unavailable';
  readonly input: DrawInput;
  /** 封口后的请求数量；牌不足或提交前失效时，不等于实际摸到的数量。 */
  readonly count: number;
  /** 本次确实移入手牌的实体；移牌后效又将其取走或埋葬，不改写这份快照。 */
  readonly cards: readonly string[];
  readonly edits: DrawDraft['edits'];
}

class Draft implements DrawDraft {
  #count: number;
  #open = true;
  #edits: { before: number; after: number; reason: string }[] = [];
  constructor(
    readonly input: DrawInput,
    readonly phase: PhaseView | null,
    private readonly ctx: Context,
  ) {
    this.#count = input.count;
  }
  get count(): number {
    return this.#count;
  }
  get edits(): DrawDraft['edits'] {
    return immutable(this.#edits);
  }
  setCount(count: number, reason: string): void {
    this.ctx.assertActive();
    if (!this.#open || !Number.isSafeInteger(count) || count < 0 || !reason)
      throw new Error('Invalid draw count change.');
    this.#edits.push({ before: this.#count, after: count, reason });
    this.#count = count;
  }
  seal(): void {
    this.#open = false;
  }
}

/** 丢弃区洗入牌堆底，不触及任何处理区。牌序由已提交移动记录直接重建。 */
export function reshuffle(ctx: Context): Promise<readonly string[]> {
  return ctx.flow('reshuffle', async (child) => {
    const discard = child.world.zone('discard');
    const drawPile = child.world.zone('draw');
    const cards = [...discard.cards];
    if (!cards.length) return cards;
    for (let i = cards.length - 1; i > 0; i--) {
      const j = child.randomInt(i + 1);
      const a = cards[i];
      const b = cards[j];
      if (a === undefined || b === undefined) throw new Error('Shuffle index out of bounds.');
      cards[i] = b;
      cards[j] = a;
    }
    const move = { cards, from: 'discard', to: 'draw', place: 'bottom' as const };
    child.commit(Deck.reshuffled, [{ kind: 'move', ...move }], { cards });
    await child.window(
      Cards.moved,
      immutable({
        kind: 'moved',
        moves: [move],
        before: [drawPile, discard],
        after: [child.world.zone('draw'), child.world.zone('discard')],
      }),
    );
    return immutable(cards);
  });
}

/** 提交前重查摸牌者/终局资格；提交后的后效不能把已发生的摸牌改成 unavailable。 */
export function draw(ctx: Context, request: DrawRequest): Promise<DrawResult> {
  return ctx.flow(
    'draw',
    async (child) => {
      const phase = request.phase ?? null;
      if (phase) {
        assertLifetime(child, phase.lifetime);
        if (phase.owner !== request.player || phase.skipped)
          throw new Error('Draw phase does not belong to this player or has been skipped.');
      }
      const input: DrawInput = immutable({
        player: request.player,
        count: request.count,
        reason: request.reason,
        ...(phase ? { phase: phase.snapshot() } : {}),
      });
      if (!Number.isSafeInteger(input.count) || input.count < 0)
        throw new Error('Invalid draw count.');
      const draft = new Draft(input, phase, child);
      const live = () => child.world.player(input.player).alive && !isGameOver(child.world);
      const unavailable = (): DrawResult =>
        immutable({
          kind: 'unavailable',
          input,
          count: draft.count,
          cards: [],
          edits: draft.edits,
        });
      if (!live()) return unavailable();
      await child.window(Cards.drawing, draft, { subject: input.player, active: live });
      draft.seal();
      if (!live()) return unavailable();
      const hand = child.world.snapshot.zones.find(
        (zone) => zone.kind === 'hand' && zone.owner === input.player,
      );
      if (!hand) throw new Error('Draw requires a hand zone.');
      if (
        child.world.zone('draw').cards.length < draft.count &&
        child.world.zone('discard').cards.length
      )
        await reshuffle(child);
      // 洗牌会开放移牌后效，可能嵌套摸牌、杀死摸牌者或结束整局。
      // 提交前重查资格并读取最新牌序；已提交移牌后的死亡则不抹掉真实摸牌事实。
      if (!live()) return unavailable();
      const cards = child.world.zone('draw').cards.slice(0, draft.count);
      if (cards.length)
        await moveCards(
          child,
          [{ cards, from: 'draw', to: hand.id, place: 'bottom' }],
          input.reason,
        );
      const result: DrawResult = immutable({
        kind: 'drawn',
        input,
        count: draft.count,
        cards,
        edits: draft.edits,
      });
      child.commit(Draw.completed, [], result);
      if (cards.length) await child.window(Cards.drawn, result, { subject: input.player });
      return result;
    },
    request.reason,
  );
}
