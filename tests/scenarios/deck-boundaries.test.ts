import { expect, it } from 'vitest';
import {
  cardsDrawn,
  cardsMoved,
  draw,
  drawing,
  finishGame,
  judge,
  kill,
  moveCards,
  withPrivateTopCards,
  withRevealedCards,
} from '../../src/sdk';
import type { Context, DrawDraft } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use } from '../fixtures/cards';

type Game = ReturnType<typeof cardGame>;
type Boundary = 'dead' | 'finished';

function create() {
  return cardGame({
    hands: { a: [] },
    draw: [card('top', 'slash')],
    discard: [card('x', 'jink'), card('y', 'peach', 'heart')],
  });
}
async function invalidate(ctx: Context, boundary: Boundary) {
  if (boundary === 'finished') await finishGame(ctx, { winners: ['b'], reason: 'deck boundary' });
  else
    ctx.unwrap(
      await kill(ctx, {
        player: 'a',
        killer: null,
        reason: 'rule',
        cause: { kind: 'rule', seq: null, data: null },
      }),
    );
}
function atReshuffle(game: Game, run: (ctx: Context) => Promise<void>) {
  game.room.on(cardsMoved, {
    id: 'reshuffle-aftereffect',
    owner: null,
    eligible: (_ctx, moved) =>
      moved.moves.some((move) => move.from === 'discard' && move.to === 'draw'),
    run,
  });
}
function conserved(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(game.room.world.snapshot.states.some((state) => state.key === 'core:private-pool')).toBe(
    false,
  );
  const located = game.room.world.snapshot.zones.flatMap((zone) => zone.cards).sort();
  expect(located).toEqual(game.initial.cards.map((card) => card.id).sort());
  expect(game.room.status).toBe('ready');
}

it.each(['dead', 'finished'] as const)(
  '摸牌在洗牌后效令摸牌者 %s 后不再移牌，不伪造摸牌完成',
  async (boundary) => {
    const game = create();
    atReshuffle(game, (ctx) => invalidate(ctx, boundary));
    let completed = 0;
    game.room.on(cardsDrawn, {
      id: 'draw-aftereffect',
      owner: null,
      eligible: () => true,
      run: () => {
        completed++;
      },
    });
    await game.room.run('draw', async (ctx) => {
      expect(ctx.unwrap(await draw(ctx, { player: 'a', count: 3, reason: 'probe' }))).toMatchObject(
        { kind: 'unavailable', count: 3, cards: [] },
      );
    });
    expect(game.room.world.zone('a:hand').cards).toEqual([]);
    expect(game.room.world.zone('draw').cards).toHaveLength(3);
    expect(game.room.history.facts('deck.reshuffled')).toHaveLength(1);
    expect(game.room.history.facts('draw.completed')).toHaveLength(0);
    expect(completed).toBe(0);
    conserved(game);
  },
);

it.each(['dead', 'finished'] as const)(
  '摸牌者起初 %s 时不开放摸牌数窗口，也不洗牌',
  async (boundary) => {
    const game = create();
    await game.room.run('invalidate', (ctx) => invalidate(ctx, boundary));
    let windows = 0;
    game.room.on(drawing, {
      id: 'count-observer',
      owner: null,
      eligible: () => true,
      run: () => {
        windows++;
      },
    });
    await game.room.run('draw', async (ctx) => {
      expect(ctx.unwrap(await draw(ctx, { player: 'a', count: 3, reason: 'probe' }))).toMatchObject(
        { kind: 'unavailable', cards: [] },
      );
    });
    expect(windows).toBe(0);
    expect(game.room.history.facts('deck.reshuffled')).toHaveLength(0);
    expect(game.room.history.facts('draw.completed')).toHaveLength(0);
    conserved(game);
  },
);

it.each(['dead', 'finished'] as const)(
  '摸牌数窗口导致 %s 时停止该窗口后续候选，保留已发生的修改',
  async (boundary) => {
    const game = create();
    let later = false;
    game.room.on(drawing, {
      id: 'a-invalidate',
      owner: null,
      eligible: () => true,
      async run(ctx, draft) {
        draft.setCount(2, 'first');
        await invalidate(ctx, boundary);
      },
    });
    game.room.on(drawing, {
      id: 'b-later',
      owner: null,
      eligible: () => true,
      run: () => {
        later = true;
      },
    });
    await game.room.run('draw', async (ctx) => {
      expect(ctx.unwrap(await draw(ctx, { player: 'a', count: 1, reason: 'probe' }))).toMatchObject(
        { kind: 'unavailable', count: 2, cards: [], edits: [{ reason: 'first' }] },
      );
    });
    expect(later).toBe(false);
    expect(game.room.history.facts('deck.reshuffled')).toHaveLength(0);
    conserved(game);
  },
);

it('洗牌后嵌套摸牌消耗牌顶，外层读取最新牌序与余量，不借旧牌顶', async () => {
  const game = create();
  atReshuffle(game, async (ctx) => {
    const nested = ctx.unwrap(await draw(ctx, { player: 'b', count: 1, reason: 'nested' }));
    expect(nested.cards).toEqual(['top']);
  });
  await game.room.run('draw', async (ctx) => {
    const result = ctx.unwrap(await draw(ctx, { player: 'a', count: 3, reason: 'outer' }));
    expect(result.kind).toBe('drawn');
    expect(result.count).toBe(3);
    expect([...result.cards].sort()).toEqual(['x', 'y']);
  });
  expect(game.room.world.zone('b:hand').cards).toEqual(['top']);
  expect(game.room.history.facts('draw.completed')).toHaveLength(2);
  conserved(game);
});

it.each(['dead', 'finished'] as const)(
  '已经提交的摸牌在移牌后效 %s 后仍保留真实完成事实，不改写为未摸牌',
  async (boundary) => {
    const game = create();
    let after = 0;
    game.room.on(cardsMoved, {
      id: 'after-commit',
      owner: null,
      eligible: (_ctx, moved) => moved.moves.some((move) => move.to === 'a:hand'),
      run: (ctx) => invalidate(ctx, boundary),
    });
    game.room.on(cardsDrawn, {
      id: 'observe-committed',
      owner: null,
      eligible: () => true,
      run: () => {
        after++;
      },
    });
    await game.room.run('draw', async (ctx) => {
      expect(ctx.unwrap(await draw(ctx, { player: 'a', count: 1, reason: 'probe' }))).toMatchObject(
        { kind: 'drawn', count: 1, cards: ['top'] },
      );
    });
    expect(game.room.history.facts('draw.completed')).toHaveLength(1);
    expect(after).toBe(1);
    expect(game.room.world.position('top')).toBe(boundary === 'dead' ? 'discard' : 'a:hand');
    conserved(game);
  },
);

it.each(['dead', 'finished'] as const)(
  '私有牌池在洗牌后 %s 不取走牌，body 仍能完成空池善后',
  async (boundary) => {
    const game = create();
    atReshuffle(game, (ctx) => invalidate(ctx, boundary));
    let called = false;
    await game.room.run('pool', async (ctx) => {
      ctx.unwrap(
        await withPrivateTopCards(ctx, { player: 'a', count: 3, reason: 'probe' }, (_at, pool) => {
          called = true;
          expect(pool.remaining()).toEqual([]);
        }),
      );
    });
    expect(called).toBe(true);
    expect(game.room.world.zone('draw').cards).toHaveLength(3);
    conserved(game);
  },
);

it('公开牌池在洗牌后终局不取走牌，body 收到空池且处理区正常关闭', async () => {
  const game = create();
  atReshuffle(game, (ctx) => invalidate(ctx, 'finished'));
  let called = false;
  await game.room.run('reveal', async (ctx) => {
    ctx.unwrap(
      await withRevealedCards(ctx, { count: 3, reason: 'probe' }, (_at, pool) => {
        called = true;
        expect(pool.remaining()).toEqual([]);
      }),
    );
  });
  expect(called).toBe(true);
  expect(game.room.world.zone('draw').cards).toHaveLength(3);
  conserved(game);
});

it.each(['dead', 'finished'] as const)(
  '判定在洗牌后 %s 不揭示判定牌，结果不可用且处理区正常关闭',
  async (boundary) => {
    const game = create();
    await game.room.run('empty-draw', (ctx) =>
      moveCards(ctx, [{ cards: ['top'], from: 'draw', to: 'b:hand', place: 'bottom' }], 'setup'),
    );
    atReshuffle(game, (ctx) => invalidate(ctx, boundary));
    await game.room.run('judge', async (ctx) => {
      expect(
        ctx.unwrap(
          await judge(ctx, game.book, { player: 'a', reason: 'probe', match: () => true }),
        ),
      ).toMatchObject({ kind: 'unavailable', card: null, matched: null });
    });
    expect(game.room.history.facts('judgment.revealed')).toHaveLength(0);
    expect(game.room.world.zone('draw').cards).toHaveLength(2);
    conserved(game);
  },
);

it('摸牌数草案在洗牌后效阶段已封口，不能迟改本次请求', async () => {
  const game = create();
  let draft: DrawDraft | undefined;
  game.room.on(drawing, {
    id: 'capture',
    owner: null,
    eligible: () => true,
    run: (_ctx, current) => {
      draft = current;
    },
  });
  atReshuffle(game, () => {
    expect(() => draft!.setCount(9, 'late')).toThrow();
    return Promise.resolve();
  });
  await game.room.run('draw', async (ctx) => {
    const result = ctx.unwrap(await draw(ctx, { player: 'a', count: 3, reason: 'probe' }));
    expect(result.count).toBe(3);
    expect(result.cards).toHaveLength(3);
  });
  conserved(game);
});

it.each(['dead', 'finished'] as const)(
  '真实无中生有在洗牌后 %s 不摸牌，已支付实体仍完成用牌和处理区善后',
  async (boundary) => {
    const game = cardGame({
      hands: { a: [card('spell', 'ex_nihilo', 'heart')] },
      draw: [card('top', 'slash')],
      discard: [card('x', 'jink'), card('y', 'peach', 'heart')],
    });
    atReshuffle(game, (ctx) => invalidate(ctx, boundary));
    expect(
      await use(game, {
        actor: 'a',
        choice: { kind: 'physical', card: 'spell' },
        targets: ['a'],
        timing: { kind: 'effect' },
      }),
    ).toMatchObject({ kind: 'resolved', value: { kind: 'used' } });
    expect(game.room.world.zone('a:hand').cards).toEqual([]);
    expect(game.room.world.position('spell')).toBe('discard');
    expect(game.room.history.facts('card.used')).toHaveLength(1);
    expect(game.room.history.facts('draw.completed')).toHaveLength(0);
    expect(game.room.world.zone('draw').cards).toHaveLength(3);
    conserved(game);
  },
);
