import { expect, it, vi } from 'vitest';
import { resolveCounter, Use, Resolve, useCard } from '../../src/sdk';
import { contestCounter, installCounterspells, Counter } from '../../src/rules/cards/counter';
import { finishGame } from '../../src/rules/game/end';
import { pay } from '../../src/rules/costs/pay';
import type { CardEffect, Context, EffectRef } from '../../src/sdk';
import type { CounterResult } from '../../src/rules/cards/counter';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use, conserved, die } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Cost } from '../../src/rules/costs/pay';
import { testTiming } from '../fixtures/timing';

type Game = ReturnType<typeof cardGame>;
type Boundary = 'dead' | 'finished' | 'cancelled';
const boundaries = ['dead', 'finished', 'cancelled'] as const;
const intent = {
  actor: 'a',
  choice: { kind: 'physical', card: 'duel' },
  targets: ['b'],
  timing: { kind: 'effect' },
} as const;
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

function create() {
  const game = cardGame({
    hands: {
      a: [card('duel', 'duel')],
      c: [card('counter', 'nullification'), card('cost', 'peach')],
    },
  });
  installCounterspells(game.room);
  return game;
}

function captureEffect(game: Game) {
  const captured: { effect?: CardEffect } = {};
  game.room.on(Resolve.starting, {
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

it.each(boundaries)(
  '真实决斗的反制开窗中 %s 后，不再执行同窗候选或支付其费用',
  async (boundary) => {
    const game = create();
    const captured = captureEffect(game);
    game.room.on(Counter.opening, {
      id: 'a-invalidate',
      owner: null,
      eligible: () => true,
      run: (ctx) => invalidate(ctx, boundary, captured.effect!),
    });
    const later = vi.fn(async (ctx: Context) => {
      await pay(ctx, { actor: 'c', cards: ['cost'], to: 'discard', reason: 'stale counter' });
    });
    game.room.on(Counter.opening, { id: 'z-later', owner: null, eligible: () => true, run: later });
    const finished: CounterResult[] = [];
    game.room.on(Counter.finished, {
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
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
    expect(game.room.history.facts(Cost.paid)).toHaveLength(0);
    conserved(game);
  },
);

it.each(boundaries)('同窗候选已支付再令反制 %s，保留真实费用但不运行其后候选', async (boundary) => {
  const game = create();
  const captured = captureEffect(game);
  game.room.on(Counter.opening, {
    id: 'a-pay-and-stop',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      expect(
        (
          await pay(ctx, {
            actor: 'c',
            cards: ['cost'],
            to: 'discard',
            reason: 'committed counter opening cost',
          })
        ).kind,
      ).toBe('paid');
      await invalidate(ctx, boundary, captured.effect!);
    },
  });
  const later = vi.fn();
  game.room.on(Counter.opening, { id: 'z-later', owner: null, eligible: () => true, run: later });

  await use(game, intent);
  expect(later.mock.calls.length).toBe(0);
  expect(game.room.world.position('cost')).toBe('discard');
  expect(game.room.world.position('counter')).toBe('c:hand');
  expect(game.room.history.facts(Cost.paid)).toHaveLength(1);
  conserved(game);
});

it.each(['a', 'd'])('开窗中 %s 死亡不撤销已宣告决斗对存活目标的反制机会', async (player) => {
  const game = create();
  game.room.on(Counter.opening, {
    id: 'a-other-dies',
    owner: null,
    eligible: (_ctx, opportunity) => opportunity.depth === 0,
    run: (ctx) => die(ctx, player),
  });
  const later = vi.fn();
  game.room.on(Counter.opening, {
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
  installCounterspells(game.room);
  const later: string[] = [];
  game.room.on(Counter.opening, {
    id: 'a-nested-use',
    owner: null,
    eligible: (_ctx, opportunity) => opportunity.root.target === 'b',
    async run(ctx) {
      expect(
        await useCard(ctx, {
          ...intent,
          actor: 'c',
          choice: { kind: 'physical', card: 'inner' },
          targets: ['d'],
        }),
      ).toMatchObject({ kind: 'used', use: { effects: [{ state: 'resolved' }] } });
    },
  });
  game.room.on(Counter.opening, {
    id: 'b-stop-outer',
    owner: null,
    eligible: (_ctx, opportunity) => opportunity.root.target === 'd',
    run: (ctx) => die(ctx, 'b'),
  });
  game.room.on(Counter.opening, {
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
  expect(game.room.history.facts(Counter.finished).map((fact) => fact.data.detail)).toMatchObject([
    { kind: 'unopposed', subject: { effect: { target: 'd' } } },
    { kind: 'unavailable', subject: { effect: { target: 'b' } } },
  ]);
  conserved(game);
});

it('候选局部中止不等于取消反制机会，后续候选和正常决斗仍执行', async () => {
  const game = create();
  game.room.on(Counter.opening, {
    id: 'a-abort-candidate',
    owner: null,
    eligible: () => true,
    run: (ctx) => ctx.abort('only this candidate'),
  });
  const later = vi.fn();
  game.room.on(Counter.opening, { id: 'z-later', owner: null, eligible: () => true, run: later });
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
  installCounterspells(game.room);
  game.room.on(Counter.finished, {
    id: 'a-finish-game',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await finishGame(ctx, { winners: ['d'], reason: 'after sealed counter' });
    },
  });
  const later = vi.fn();
  game.room.on(Counter.finished, {
    id: 'z-completed',
    owner: null,
    eligible: () => true,
    run: later,
  });

  await use(game, intent);
  expect(later).toHaveBeenCalledTimes(1);
  expect(later.mock.calls[0]![1]).toMatchObject({ kind: 'unopposed', by: null });
  expect(game.room.history.facts(Counter.finished)[0]!.data.detail).toMatchObject({
    kind: 'unopposed',
  });
  expect(game.room.world.player('b').hp).toBe(4);
  conserved(game);
});

it('没有 World 修改的相关性闭包也持续收束同窗候选', async () => {
  const game = cardGame({ hands: { a: [] } });
  class Input {
    root = root;
    subject = { kind: 'effect' as const, effect: root };
    write = false;
    #relevant = true;

    relevant(ctx: Context) {
      if (this.write) ctx.commit(testTiming('probe.counter-query-write'), [], null);
      return this.#relevant;
    }

    close() {
      this.#relevant = false;
    }
  }
  const input = new Input();
  const later = vi.fn();
  game.room.on(Counter.opening, {
    id: 'a-change-draft',
    owner: null,
    eligible: () => true,
    run: (ctx, opportunity) => {
      input.write = true;
      expect(() => opportunity.available(ctx)).toThrow('Pure queries');
      input.write = false;
      input.close();
      input.relevant = () => true;
    },
  });
  game.room.on(Counter.opening, { id: 'z-later', owner: null, eligible: () => true, run: later });
  await game.room.run('counter', async (ctx) => {
    expect(await contestCounter(ctx, input)).toMatchObject({
      kind: 'unavailable',
      by: null,
    });
  });
  expect(later.mock.calls.length).toBe(0);
  expect(game.room.history.facts(testTiming('probe.counter-query-write'))).toEqual([]);
  conserved(game);
});

it('反制机会在普通后效中检查相关性也拒绝异步结果，不提交越过资格的事实', async () => {
  const game = cardGame({ hands: { a: [] } });
  let asynchronous = false;
  game.room.on(Counter.opening, {
    id: 'probe:read-availability',
    owner: null,
    eligible: () => true,
    run: (ctx, opportunity) => {
      asynchronous = true;
      if (opportunity.available(ctx)) ctx.commit(testTiming('probe.counter-after-async'), [], null);
    },
  });
  await expect(
    game.room.run('counter', (ctx) =>
      contestCounter(ctx, {
        root,
        subject: { kind: 'effect', effect: root },
        relevant(): boolean {
          // @ts-expect-error 模拟未经类型检查的异步相关性回调。
          return asynchronous ? Promise.resolve(false) : true;
        },
      }),
    ),
  ).rejects.toThrow('Queries cannot await');
  expect(game.room.status).toBe('faulted');
  expect(game.room.history.facts(testTiming('probe.counter-after-async'))).toEqual([]);
  expect(game.room.history.facts(Counter.finished)).toEqual([]);
  expect(game.room.decisions.pending).toEqual([]);
  expect(game.room.world.snapshot.zones).toEqual(game.initial.zones);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it.each(boundaries)(
  '无懈已经宣告后原机会 %s，内外层均如实返回失效且保留用牌归属',
  async (boundary) => {
    const game = create();
    const captured = captureEffect(game);
    game.room.on(Use.declared, {
      id: 'after-counter-commit',
      owner: null,
      eligible: (_ctx, plan) => plan.card.name === 'standard:nullification',
      run: (ctx) => invalidate(ctx, boundary, captured.effect!),
    });
    const running = use(game, intent);
    const request = await nextRequest(game.room);
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'counter' });
    await running;

    const completed = game.room.history.facts(Counter.finished).map((fact) => fact.data.detail);
    expect(completed).toMatchObject([
      { kind: 'unavailable', subject: { kind: 'use' }, by: null },
      { kind: 'unavailable', subject: { kind: 'effect' }, by: { actor: 'c' } },
    ]);
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
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
          execute: (ctx, { use: plan }) => resolveCounter(ctx, plan),
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
  const running = game.room.run(
    'counter',
    async (ctx) =>
      await contestCounter(ctx, {
        root,
        subject: { kind: 'effect', effect: root },
        relevant: () => relevant,
        names: ['probe:prepared-counter'],
      }),
  );
  const request = await nextRequest(game.room);
  expect(request.player).toBe('d');
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'prepared' });
  expect(await running).toMatchObject({ value: { kind: 'unavailable', by: null } });
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(0);
  expect(game.room.world.position('prepared')).toBe('d:hand');
  conserved(game);
});
