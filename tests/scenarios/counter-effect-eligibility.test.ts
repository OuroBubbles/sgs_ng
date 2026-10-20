import { expect, it, vi } from 'vitest';
import {
  cardQueries,
  counterFinished,
  counterOpening,
  defaultPhaseBody,
  defineSkill,
  delayedCard,
  effectFinished,
  effectStarting,
  installCounterspells,
  kill,
  loseHp,
  modify,
  moveCards,
  recover,
  runPhase,
  useDeclarations,
} from '../../src/sdk';
import type { Context, UseIntent } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use } from '../fixtures/cards';

type Game = ReturnType<typeof cardGame>;
const source = { kind: 'general', id: 'counter-eligibility-probe' } as const;
const ban = defineSkill({
  id: 'probe:counter-target-ban',
  name: '禁止目标',
  effects: [],
  modifiers: [
    modify(cardQueries.prohibitTarget, (_ctx, request, self) =>
      request.target === self.owner ? true : undefined,
    ),
  ],
});
const cases = [
  ['god_salvation', 'healed'],
  ['snatch', 'last-card-gone'],
  ['dismantlement', 'last-card-gone'],
  ['duel', 'prohibited'],
  ['snatch', 'source-dead'],
  ['dismantlement', 'source-dead'],
] as const;
type Boundary = (typeof cases)[number][1];

function create(name: string, counters = 2) {
  const game = cardGame({
    hands: {
      a: [card('root', name)],
      b: [card('held', 'peach')],
      c: [card('n1', 'nullification')],
      d: counters > 1 ? [card('n2', 'nullification')] : [],
    },
    skills: [ban],
  });
  installCounterspells(game.room, game.book);
  return game;
}

function intent(name: string): UseIntent {
  return {
    actor: 'a',
    choice: { kind: 'physical', card: 'root' },
    targets: name === 'god_salvation' ? [] : ['b'],
    timing: { kind: 'effect' },
  };
}

async function change(ctx: Context, game: Game, boundary: Boundary) {
  switch (boundary) {
    case 'healed':
      ctx.unwrap(await recover(ctx, { from: 'c', to: 'b', amount: 2 }));
      return;
    case 'last-card-gone':
      ctx.unwrap(
        await moveCards(
          ctx,
          [{ cards: ['held'], from: 'b:hand', to: 'c:hand', place: 'bottom' }],
          'target lost last card during counter',
        ),
      );
      return;
    case 'prohibited':
      await game.skills.grant(ctx, { owner: 'b', skill: ban.id, source });
      return;
    case 'source-dead':
      ctx.unwrap(
        await kill(ctx, {
          player: 'a',
          killer: null,
          reason: 'rule',
          cause: { kind: 'rule', seq: null, data: null },
        }),
      );
  }
}

/** 接受实际出现的无懈，记录旧实现不该开放的请求，不靠超时证明失效。 */
async function drain<T>(game: Game, running: Promise<T>) {
  let settled = false;
  const observed = running.finally(() => {
    settled = true;
  });
  const asked: string[] = [];
  try {
    for (let step = 0; step < 8 && !settled; step++) {
      await vi.waitFor(() => {
        expect(settled || game.room.decisions.pending.length === 1).toBe(true);
      });
      if (settled) break;
      const request = game.room.decisions.pending[0]!;
      expect(request.kind).toBe('use-card');
      expect(['c', 'd']).toContain(request.player);
      asked.push(request.player);
      expect(
        game.room.decisions.submit(request.id, request.token, {
          kind: 'physical',
          card: request.player === 'c' ? 'n1' : 'n2',
        }),
      ).toEqual({ kind: 'accepted' });
    }
    expect(settled).toBe(true);
    return { result: await observed, asked };
  } catch (error) {
    game.room.abort('counter test failed');
    await observed.catch(() => {});
    throw error;
  }
}

function conserved(game: Game) {
  expect(game.room.status).toBe('ready');
  expect(game.room.decisions.pending).toEqual([]);
  expect(useDeclarations(game.room.world)).toEqual([]);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(game.room.world.snapshot.zones.flatMap((zone) => zone.cards).sort()).toEqual(
    game.initial.cards.map((item) => item.id).sort(),
  );
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(() => structuredClone(game.room.history.facts())).not.toThrow();
}

for (const [name, boundary] of cases) {
  it.each([0, 1])(
    `${name} 的第 %s 层反制中 ${boundary}，停止无效征询且保留已用无懈`,
    async (depth) => {
      const game = create(name);
      if (boundary === 'healed')
        await game.room.run('wound', async (ctx) => {
          ctx.unwrap(await loseHp(ctx, { player: 'b', amount: 2, reason: 'initial wound' }));
        });
      game.room.on(counterOpening, {
        id: 'a-change-root-eligibility',
        owner: null,
        eligible: (_ctx, opportunity) => opportunity.depth === depth,
        run: (ctx) => change(ctx, game, boundary),
      });
      const later = vi.fn();
      game.room.on(counterOpening, {
        id: 'z-later',
        owner: null,
        eligible: (_ctx, opportunity) => opportunity.depth === depth,
        run: later,
      });

      const { asked } = await drain(game, use(game, intent(name)));
      expect(later.mock.calls.length).toBe(0);
      expect(asked).toEqual(depth === 0 ? [] : ['c']);
      expect(game.room.world.position('n1')).toBe(depth === 0 ? 'c:hand' : 'discard');
      expect(game.room.world.position('n2')).toBe('d:hand');
      expect(game.room.history.facts('card.used')).toHaveLength(1 + depth);
      const finished = game.room.history.facts('counter.finished').map((fact) => fact.data.detail);
      expect(finished).toHaveLength(1 + depth);
      expect(finished).toMatchObject(
        depth === 0
          ? [{ kind: 'unavailable', by: null }]
          : [
              { kind: 'unavailable', subject: { kind: 'use' }, by: null },
              { kind: 'unavailable', subject: { kind: 'effect' }, by: { actor: 'c' } },
            ],
      );
      expect(
        game.room.history
          .facts('card.effect')
          .map((fact) => fact.data.detail as { target: string; state: string })
          .find((effect) => effect.target === 'b'),
      ).toMatchObject({ state: 'skipped' });
      conserved(game);
    },
  );
}

it.each(['healed', 'last-card-gone', 'source-dead'] as const)(
  '决斗反制中 %s 不属于该牌失效条件，不误伤正常无懈',
  async (boundary) => {
    const game = create('duel', 1);
    if (boundary === 'healed')
      await game.room.run('wound', async (ctx) => {
        ctx.unwrap(await loseHp(ctx, { player: 'b', amount: 2, reason: 'initial wound' }));
      });
    game.room.on(counterOpening, {
      id: 'change-unrelated-condition',
      owner: null,
      eligible: (_ctx, opportunity) => opportunity.depth === 0,
      run: (ctx) => change(ctx, game, boundary),
    });
    const { asked, result } = await drain(game, use(game, intent('duel')));
    expect(asked).toEqual(['c']);
    expect(result).toMatchObject({ value: { use: { effects: [{ state: 'cancelled' }] } } });
    expect(
      game.room.history.facts('counter.finished').map((fact) => fact.data.detail),
    ).toMatchObject([{ kind: 'unopposed' }, { kind: 'countered', by: { actor: 'c' } }]);
    conserved(game);
  },
);

it('同一候选中桃园目标先治满再失去体力，不把中途的假值缓存为永久失效', async () => {
  const game = create('god_salvation', 1);
  await game.room.run('wound', async (ctx) => {
    ctx.unwrap(await loseHp(ctx, { player: 'b', amount: 2, reason: 'initial wound' }));
  });
  game.room.on(counterOpening, {
    id: 'temporarily-inapplicable',
    owner: null,
    eligible: (_ctx, opportunity) => opportunity.depth === 0,
    async run(ctx) {
      await change(ctx, game, 'healed');
      ctx.unwrap(await loseHp(ctx, { player: 'b', amount: 1, reason: 'wounded again' }));
    },
  });
  const { asked } = await drain(game, use(game, intent('god_salvation')));
  expect(asked).toEqual(['c']);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts('counter.finished').at(-1)!.data.detail).toMatchObject({
    kind: 'countered',
  });
  conserved(game);
});

it('普通作者 canResolve 闭包没有修改 World，也能关闭嵌套反制机会', async () => {
  let relevant = true;
  const game = cardGame({
    hands: {
      a: [{ ...card('root', 'duel'), name: 'probe:conditional' }],
      c: [card('n1', 'nullification')],
    },
    definitions: [
      {
        id: 'probe:conditional',
        type: 'trick',
        label: '条件锦囊',
        counterable: true,
        use: {
          count: { min: 1, max: 1 },
          target: () => true,
          canResolve: () => relevant,
          resolve: () => {},
        },
      },
    ],
  });
  installCounterspells(game.room, game.book);
  game.room.on(counterOpening, {
    id: 'change-author-predicate',
    owner: null,
    eligible: () => true,
    run: () => {
      relevant = false;
    },
  });
  const { asked } = await drain(game, use(game, intent('probe:conditional')));
  expect(asked).toEqual([]);
  expect(game.room.world.position('n1')).toBe('c:hand');
  expect(game.room.history.facts('counter.finished')[0]!.data.detail).toMatchObject({
    kind: 'unavailable',
  });
  conserved(game);
});

it('延时牌后续生效使用本次 resolver 的资格，不错误套回放置时的 canResolve', async () => {
  let placementAllowed = true;
  const delayed = delayedCard({
    id: 'probe:conditional-delayed',
    label: '条件延时牌',
    resolve(ctx) {
      ctx.commit('probe.delayed-body', [], null);
    },
  });
  const game = cardGame({
    hands: {
      a: [{ ...card('root', 'indulgence'), name: delayed.id }],
      c: [card('n1', 'nullification')],
    },
    definitions: [{ ...delayed, use: { ...delayed.use!, canResolve: () => placementAllowed } }],
  });
  installCounterspells(game.room, game.book);
  await use(game, intent(delayed.id));
  placementAllowed = false;
  const { asked } = await drain(
    game,
    game.room.run('judgment-phase', (ctx) =>
      runPhase(ctx, game.book, 'b', 'judge', defaultPhaseBody),
    ),
  );
  expect(asked).toEqual(['c']);
  expect(game.room.history.facts('counter.finished').at(-1)!.data.detail).toMatchObject({
    kind: 'countered',
  });
  expect(game.room.history.facts('probe.delayed-body')).toHaveLength(0);
  conserved(game);
});

it('反制结论封口后的公共后效治满桃园目标，不倒改已完成的反制与材料事实', async () => {
  const game = create('god_salvation', 1);
  await game.room.run('wound', async (ctx) => {
    ctx.unwrap(await loseHp(ctx, { player: 'b', amount: 2, reason: 'initial wound' }));
  });
  game.room.on(counterFinished, {
    id: 'heal-after-sealed-result',
    owner: null,
    eligible: (_ctx, result) => result.subject.kind === 'effect' && result.kind === 'countered',
    run: (ctx) => change(ctx, game, 'healed'),
  });
  const { asked, result } = await drain(game, use(game, intent('god_salvation')));
  expect(asked).toEqual(['c']);
  expect(result).toMatchObject({
    value: {
      use: {
        effects: [
          { target: 'a', state: 'skipped' },
          { target: 'b', state: 'cancelled' },
          { target: 'c', state: 'skipped' },
          { target: 'd', state: 'skipped' },
        ],
      },
    },
  });
  expect(game.room.history.facts('counter.finished').at(-1)!.data.detail).toMatchObject({
    kind: 'countered',
    by: { actor: 'c' },
  });
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('n1')).toBe('discard');
  conserved(game);
});

it('启动资格只适用于原 World 和未结束的待决效果，公共完成与事实不保留执行闭包', async () => {
  const game = create('duel', 1);
  const foreign = cardGame({ hands: { a: [] } });
  let available: ((ctx: Context) => boolean) | undefined;
  game.room.on(effectStarting, {
    id: 'capture-pending-effect',
    owner: null,
    eligible: () => true,
    async run(ctx, event) {
      available = event.available;
      expect(ctx.query(() => event.available(ctx))).toBe(true);
      await foreign.room.run('foreign-query', (at) => {
        expect(at.query(() => event.available(at))).toBe(false);
      });
    },
  });
  game.room.on(effectFinished, {
    id: 'check-completed-effect',
    owner: null,
    eligible: () => true,
    run(ctx) {
      expect(ctx.query(() => available!(ctx))).toBe(false);
    },
  });
  await drain(game, use(game, intent('duel')));
  await game.room.run('closed-query', (ctx) => {
    expect(ctx.query(() => available!(ctx))).toBe(false);
  });
  conserved(game);
});
