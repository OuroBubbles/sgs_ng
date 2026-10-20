import { expect, it, vi } from 'vitest';
import {
  contestCounter,
  counterFinished,
  counterOpening,
  effectStarting,
  finishGame,
  installCounterspells,
  kill,
  pay,
  resolveCounter,
  useDeclared,
} from '../../src/sdk';
import type { CardEffect, Context, CounterResult, EffectRef } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';

type Game = ReturnType<typeof cardGame>;
type Boundary = 'dead' | 'finished' | 'cancelled';
const boundaries = ['dead', 'finished', 'cancelled'] as const;
const intent = {
  actor: 'a',
  choice: { kind: 'physical', card: 'duel' },
  targets: ['b'],
  timing: { kind: 'effect' },
} as const;

function create() {
  const game = cardGame({
    hands: {
      a: [card('duel', 'duel')],
      c: [card('counter', 'nullification'), card('cost', 'peach')],
    },
  });
  installCounterspells(game.room, game.book);
  return game;
}

async function die(ctx: Context, player: string) {
  ctx.unwrap(
    await kill(ctx, {
      player,
      killer: null,
      reason: 'rule',
      cause: { kind: 'rule', seq: null, data: null },
    }),
  );
}

function captureEffect(game: Game) {
  const captured: { effect?: CardEffect } = {};
  game.room.on(effectStarting, {
    id: 'capture-root',
    owner: null,
    eligible: () => true,
    run: (_ctx, { effect }) => {
      captured.effect = effect;
    },
  });
  return captured;
}

async function invalidate(ctx: Context, boundary: Boundary, effect: CardEffect) {
  if (boundary === 'dead') await die(ctx, effect.target);
  else if (boundary === 'finished')
    await finishGame(ctx, { winners: ['d'], reason: 'counter boundary' });
  else effect.cancel(ctx, 'root cancelled during counter opening');
}

function conserved(game: Game) {
  expect(game.room.status).toBe('ready');
  expect(game.room.decisions.pending).toEqual([]);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(game.room.world.snapshot.zones.flatMap((zone) => zone.cards).sort()).toEqual(
    game.initial.cards.map((item) => item.id).sort(),
  );
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
}

it.each(boundaries)(
  '真实决斗的反制开窗中 %s 后，不再执行同窗候选或支付其费用',
  async (boundary) => {
    const game = create();
    const captured = captureEffect(game);
    game.room.on(counterOpening, {
      id: 'a-invalidate',
      owner: null,
      eligible: () => true,
      run: (ctx) => invalidate(ctx, boundary, captured.effect!),
    });
    const later = vi.fn(async (ctx: Context) => {
      ctx.unwrap(
        await pay(ctx, { actor: 'c', cards: ['cost'], to: 'discard', reason: 'stale counter' }),
      );
    });
    game.room.on(counterOpening, { id: 'z-later', owner: null, eligible: () => true, run: later });
    const finished: CounterResult[] = [];
    game.room.on(counterFinished, {
      id: 'completed',
      owner: null,
      eligible: () => true,
      run: (_ctx, result) => {
        finished.push(result);
      },
    });

    await use(game, intent);
    expect(later.mock.calls.length).toBe(0);
    expect(finished).toMatchObject([{ kind: 'unavailable', by: null }]);
    expect(game.room.world.position('cost')).toBe('c:hand');
    expect(game.room.world.position('counter')).toBe('c:hand');
    expect(game.room.world.position('duel')).toBe('discard');
    expect(game.room.history.facts('card.used')).toHaveLength(1);
    expect(game.room.history.facts('cost.paid')).toHaveLength(0);
    conserved(game);
  },
);

it.each(boundaries)('同窗候选已支付再令反制 %s，保留真实费用但不运行其后候选', async (boundary) => {
  const game = create();
  const captured = captureEffect(game);
  game.room.on(counterOpening, {
    id: 'a-pay-and-stop',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      expect(
        ctx.unwrap(
          await pay(ctx, {
            actor: 'c',
            cards: ['cost'],
            to: 'discard',
            reason: 'committed counter opening cost',
          }),
        ).kind,
      ).toBe('paid');
      await invalidate(ctx, boundary, captured.effect!);
    },
  });
  const later = vi.fn();
  game.room.on(counterOpening, { id: 'z-later', owner: null, eligible: () => true, run: later });

  await use(game, intent);
  expect(later.mock.calls.length).toBe(0);
  expect(game.room.world.position('cost')).toBe('discard');
  expect(game.room.world.position('counter')).toBe('c:hand');
  expect(game.room.history.facts('cost.paid')).toHaveLength(1);
  conserved(game);
});

it.each(['a', 'd'])('开窗中 %s 死亡不撤销已宣告决斗对存活目标的反制机会', async (player) => {
  const game = create();
  game.room.on(counterOpening, {
    id: 'a-other-dies',
    owner: null,
    eligible: (_ctx, opportunity) => opportunity.depth === 0,
    run: (ctx) => die(ctx, player),
  });
  const later = vi.fn();
  game.room.on(counterOpening, {
    id: 'z-later',
    owner: null,
    eligible: (_ctx, opportunity) => opportunity.depth === 0,
    run: later,
  });

  const running = use(game, intent);
  const request = await nextRequest(game.room);
  expect(request.player).toBe('c');
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'counter' }),
  ).toEqual({ kind: 'accepted' });
  expect(await running).toMatchObject({
    value: { use: { effects: [{ state: 'cancelled' }] } },
  });
  expect(later).toHaveBeenCalledTimes(1);
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('counter')).toBe('discard');
  conserved(game);
});

it('内层用牌令外层反制目标死亡，只收束外层候选，内层仍完整结算', async () => {
  const game = cardGame({
    hands: { a: [card('duel', 'duel')], c: [card('inner', 'duel')] },
  });
  installCounterspells(game.room, game.book);
  const later: string[] = [];
  game.room.on(counterOpening, {
    id: 'a-nested-use',
    owner: null,
    eligible: (_ctx, opportunity) => opportunity.root.target === 'b',
    async run(ctx) {
      expect(
        ctx.unwrap(
          await game.book.use(ctx, {
            ...intent,
            actor: 'c',
            choice: { kind: 'physical', card: 'inner' },
            targets: ['d'],
          }),
        ),
      ).toMatchObject({ kind: 'used', use: { effects: [{ state: 'resolved' }] } });
    },
  });
  game.room.on(counterOpening, {
    id: 'b-stop-outer',
    owner: null,
    eligible: (_ctx, opportunity) => opportunity.root.target === 'd',
    run: (ctx) => die(ctx, 'b'),
  });
  game.room.on(counterOpening, {
    id: 'z-later',
    owner: null,
    eligible: () => true,
    run: (_ctx, opportunity) => {
      later.push(opportunity.root.target);
    },
  });

  await use(game, intent);
  expect(later).toEqual(['d']);
  expect(game.room.world.player('d').hp).toBe(3);
  expect(game.room.history.facts('counter.finished').map((fact) => fact.data.detail)).toMatchObject(
    [
      { kind: 'unopposed', subject: { effect: { target: 'd' } } },
      { kind: 'unavailable', subject: { effect: { target: 'b' } } },
    ],
  );
  conserved(game);
});

it('候选局部中止不等于取消反制机会，后续候选和正常决斗仍执行', async () => {
  const game = create();
  game.room.on(counterOpening, {
    id: 'a-abort-candidate',
    owner: null,
    eligible: () => true,
    run: (ctx) => ctx.abort('only this candidate'),
  });
  const later = vi.fn();
  game.room.on(counterOpening, { id: 'z-later', owner: null, eligible: () => true, run: later });
  const running = use(game, intent);
  const request = await nextRequest(game.room);
  game.room.decisions.cancel(request.id, request.token);
  await running;

  expect(later).toHaveBeenCalledTimes(1);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('counter')).toBe('c:hand');
  conserved(game);
});

it('反制完成是已封口公共事实，完成后效终局不重写结果或吞掉后续完成候选', async () => {
  const game = cardGame({ hands: { a: [card('duel', 'duel')] } });
  installCounterspells(game.room, game.book);
  game.room.on(counterFinished, {
    id: 'a-finish-game',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await finishGame(ctx, { winners: ['d'], reason: 'after sealed counter' });
    },
  });
  const later = vi.fn();
  game.room.on(counterFinished, {
    id: 'z-completed',
    owner: null,
    eligible: () => true,
    run: later,
  });

  await use(game, intent);
  expect(later).toHaveBeenCalledTimes(1);
  expect(later.mock.calls[0]![1]).toMatchObject({ kind: 'unopposed', by: null });
  expect(game.room.history.facts('counter.finished')[0]!.data.detail).toMatchObject({
    kind: 'unopposed',
  });
  expect(game.room.world.player('b').hp).toBe(4);
  conserved(game);
});

it('没有 World 修改的相关性闭包也持续收束同窗候选', async () => {
  const game = cardGame({ hands: { a: [] } });
  const root: EffectRef = {
    useId: 'probe-use',
    effectId: 'probe-effect',
    actor: 'a',
    target: 'b',
    processing: 'discard',
    card: {
      name: 'standard:duel',
      suit: 'none',
      rank: 0,
      color: 'none',
      nature: 'normal',
      source: null,
      materials: [],
    },
  };
  let relevant = true;
  const later = vi.fn();
  game.room.on(counterOpening, {
    id: 'a-change-draft',
    owner: null,
    eligible: () => true,
    run: () => {
      relevant = false;
    },
  });
  game.room.on(counterOpening, { id: 'z-later', owner: null, eligible: () => true, run: later });
  await game.room.run('counter', async (ctx) => {
    expect(
      ctx.unwrap(
        await contestCounter(ctx, game.book, {
          root,
          subject: { kind: 'effect', effect: root },
          relevant: () => relevant,
        }),
      ),
    ).toMatchObject({ kind: 'unavailable', by: null });
  });
  expect(later.mock.calls.length).toBe(0);
  conserved(game);
});

it.each(boundaries)(
  '无懈已经宣告后原机会 %s，内外层均如实返回失效且保留用牌归属',
  async (boundary) => {
    const game = create();
    const captured = captureEffect(game);
    game.room.on(useDeclared, {
      id: 'after-counter-commit',
      owner: null,
      eligible: (_ctx, plan) => plan.card.name === 'standard:nullification',
      run: (ctx) => invalidate(ctx, boundary, captured.effect!),
    });
    const running = use(game, intent);
    const request = await nextRequest(game.room);
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'counter' });
    await running;

    const completed = game.room.history.facts('counter.finished').map((fact) => fact.data.detail);
    expect(completed).toMatchObject([
      { kind: 'unavailable', subject: { kind: 'use' }, by: null },
      { kind: 'unavailable', subject: { kind: 'effect' }, by: { actor: 'c' } },
    ]);
    expect(game.room.history.facts('card.used')).toHaveLength(2);
    expect(game.room.world.position('counter')).toBe('discard');
    expect(game.room.world.position('cost')).toBe('c:hand');
    conserved(game);
  },
);

it('最后询问席位的反制在准备中失效，未支付时也不误报未受反制', async () => {
  let relevant = true;
  const game = cardGame({
    hands: {
      a: [],
      d: [{ ...card('prepared', 'nullification'), name: 'probe:prepared-counter' }],
    },
    definitions: [
      {
        id: 'probe:prepared-counter',
        type: 'trick',
        label: '准备反制',
        use: {
          count: { min: 0, max: 0 },
          timings: ['counter'],
          target: () => false,
          prepare: () => {
            relevant = false;
            return { ok: true, value: null };
          },
          execute: (ctx, plan, book) => resolveCounter(ctx, plan, book),
        },
      },
    ],
  });
  const root: EffectRef = {
    useId: 'probe-use',
    effectId: 'probe-effect',
    actor: 'a',
    target: 'b',
    processing: 'discard',
    card: {
      name: 'standard:duel',
      suit: 'none',
      rank: 0,
      color: 'none',
      nature: 'normal',
      source: null,
      materials: [],
    },
  };
  const running = game.room.run('counter', async (ctx) =>
    ctx.unwrap(
      await contestCounter(ctx, game.book, {
        root,
        subject: { kind: 'effect', effect: root },
        relevant: () => relevant,
        names: ['probe:prepared-counter'],
      }),
    ),
  );
  const request = await nextRequest(game.room);
  expect(request.player).toBe('d');
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'prepared' });
  expect(await running).toMatchObject({ value: { kind: 'unavailable', by: null } });
  expect(game.room.history.facts('card.used')).toHaveLength(0);
  expect(game.room.world.position('prepared')).toBe('d:hand');
  conserved(game);
});
