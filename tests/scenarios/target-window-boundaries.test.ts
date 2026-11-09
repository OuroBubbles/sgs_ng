import { expect, it, vi } from 'vitest';
import {
  cardQueries,
  defineSkill,
  finishGame,
  installCounterspells,
  loseHp,
  modify,
  moveCards,
  pay,
  recover,
  Use,
  Target,
  Resolve,
  useCard,
} from '../../src/sdk';
import type { CardEffect, Context, UseIntent, UsePlanView } from '../../src/sdk';
import { standardGeneralSkills } from '../fixtures/standard';
import { card, cardGame, use, conserved, die } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Counter } from '../../src/sdk';
import { Hp } from '../../src/sdk';

type Game = ReturnType<typeof cardGame>;
type Boundary = 'dead' | 'finished' | 'cancelled' | 'removed' | 'replaced' | 'prohibited';
const boundaries: readonly Boundary[] = [
  'dead',
  'finished',
  'cancelled',
  'removed',
  'replaced',
  'prohibited',
];
const points = [
  ['指定前', Target.specifying],
  ['确认前', Target.confirming],
  ['指定后', Target.specified],
  ['确认后', Target.confirmed],
  ['效果启动', Resolve.starting],
] as const;
const source = { kind: 'general', id: 'boundary-probe' } as const;
const ban = defineSkill({
  id: 'probe:target-ban',
  name: '禁止目标',
  triggers: [],
  modifiers: [
    modify(cardQueries.prohibitTarget, (_ctx, { input: request, self }) =>
      request.target === self.owner ? true : undefined,
    ),
  ],
});
const slash: UseIntent = {
  actor: 'a',
  choice: { kind: 'physical', card: 'slash' },
  targets: ['b'],
  timing: { kind: 'effect', ignoreDistance: true },
};

function create() {
  const game = cardGame({
    hands: {
      a: [card('slash', 'slash')],
      c: [card('paid', 'peach'), card('unpaid', 'peach')],
    },
    skills: [ban],
  });
  game.room.on(Use.declared, {
    id: 'other-target',
    owner: null,
    eligible: () => true,
    run(ctx, plan) {
      plan.addTarget(ctx, 'd', 'second independent target');
    },
  });
  return game;
}

async function invalidate(
  ctx: Context,
  game: Game,
  plan: UsePlanView,
  effect: CardEffect,
  boundary: Boundary,
) {
  switch (boundary) {
    case 'dead':
      return die(ctx, 'b');
    case 'finished':
      await finishGame(ctx, { winners: ['c'], reason: 'target window boundary' });
      return;
    case 'cancelled':
      return effect.cancel(ctx, 'cancel this identity');
    case 'removed':
      return plan.removeTarget(ctx, effect.effectId, 'remove this identity');
    case 'replaced':
      plan.replaceTarget(ctx, effect.effectId, 'c', 'replace this identity', {
        ignoreDistance: true,
      });
      return;
    case 'prohibited':
      await game.skills.grant(ctx, { owner: 'b', skill: ban.id, source });
  }
}

for (const [label, window] of points) {
  it.each(boundaries)(
    `${label} 中 %s 后停止旧身份候选，已付费用保留且其他身份独立`,
    async (boundary) => {
      const game = create();
      game.room.on(window, {
        id: 'a-invalidate',
        owner: null,
        eligible: (_ctx, { effect }) => effect.target === 'b',
        async run(ctx, { use: plan, effect }) {
          expect(
            (
              await pay(ctx, {
                actor: 'c',
                cards: ['paid'],
                to: 'discard',
                reason: 'already committed target candidate',
              })
            ).kind,
          ).toBe('paid');
          await invalidate(ctx, game, plan, effect, boundary);
        },
      });
      const later = vi.fn(async (ctx: Context) => {
        await pay(ctx, {
          actor: 'c',
          cards: ['unpaid'],
          to: 'discard',
          reason: 'stale target candidate',
        });
      });
      game.room.on(window, {
        id: 'z-later',
        owner: null,
        eligible: (_ctx, { effect }) => effect.target === 'b',
        run: later,
      });

      expect(await use(game, slash)).toMatchObject({ value: { kind: 'used' } });
      expect(later.mock.calls.length).toBe(0);
      expect(game.room.world.position('paid')).toBe('discard');
      expect(game.room.world.position('unpaid')).toBe('c:hand');
      expect(game.room.world.position('slash')).toBe('discard');
      expect(game.room.world.player('b').hp).toBe(4);
      expect(game.room.world.player('d').hp).toBe(boundary === 'finished' ? 4 : 3);
      expect(game.room.world.player('c').hp).toBe(boundary === 'replaced' ? 3 : 4);
      const effects = game.room.history.facts(CardEvent.effect).map((fact) => fact.data.detail);
      expect(effects).toHaveLength(boundary === 'replaced' ? 3 : 2);
      expect(effects[0]).toMatchObject({
        target: 'b',
        state: ['cancelled', 'removed', 'replaced'].includes(boundary) ? 'cancelled' : 'skipped',
      });
      conserved(game);
    },
  );

  it.each(['source-dead', 'local-abort'] as const)(
    `${label} 中 %s 不等于旧目标失效，不吞掉后续候选和独立伤害`,
    async (boundary) => {
      const game = create();
      game.room.on(window, {
        id: 'a-local-change',
        owner: null,
        eligible: (_ctx, { effect }) => effect.target === 'b',
        run: (ctx) =>
          boundary === 'source-dead' ? die(ctx, 'a') : ctx.abort('only this candidate'),
      });
      const later = vi.fn();
      game.room.on(window, {
        id: 'z-later',
        owner: null,
        eligible: (_ctx, { effect }) => effect.target === 'b',
        run: later,
      });

      await use(game, slash);
      expect(later).toHaveBeenCalledTimes(1);
      expect(game.room.world.player('b').hp).toBe(3);
      expect(game.room.world.player('d').hp).toBe(3);
      conserved(game);
    },
  );
}

it('真实流离支付并转移后，不再执行旧目标同窗的后席候选，新目标补齐四层', async () => {
  const game = cardGame({
    hands: { a: [card('slash', 'slash')], b: [card('cost', 'peach')] },
    skills: standardGeneralSkills,
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'b', skill: 'standard:liuli', source }),
  );
  const later = vi.fn();
  game.room.on(Target.confirming, {
    id: 'old-target-later-seat',
    owner: 'd',
    eligible: (_ctx, { effect }) => effect.target === 'b',
    run: later,
  });
  const running = use(game, slash);
  const request = await nextRequest(game.room);
  expect(request).toMatchObject({ player: 'b', kind: 'cards-targets' });
  game.room.decisions.submit(request.id, request.token, { cards: ['cost'], targets: ['c'] });
  expect(await running).toMatchObject({
    value: { use: { effects: [{ state: 'cancelled' }, { target: 'c', state: 'resolved' }] } },
  });
  expect(later.mock.calls.length).toBe(0);
  expect(game.room.world.position('cost')).toBe('discard');
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.player('c').hp).toBe(3);
  expect(
    game.room.history
      .facts(CardEvent.targeting)
      .map((fact) => fact.data.detail as { target: string; stage: string })
      .filter((entry) => entry.target === 'c')
      .map((entry) => entry.stage),
  ).toEqual(['specifying', 'confirming', 'specified', 'confirmed']);
  conserved(game);
});

it('仁王盾取消黑杀后不进入效果启动后组，公共完成窗口仍报告取消身份', async () => {
  const game = cardGame({
    hands: { a: [card('slash', 'slash')] },
    equipment: { b: [card('shield', 'nioh_shield')] },
  });
  const after = vi.fn();
  game.room.on(Resolve.starting, {
    id: 'after-block',
    owner: null,
    group: 'after',
    eligible: () => true,
    run: after,
  });
  const completed = vi.fn();
  game.room.on(Resolve.finished, {
    id: 'public-completion',
    owner: null,
    eligible: () => true,
    run: completed,
  });

  await use(game, slash);
  expect(after.mock.calls.length).toBe(0);
  expect(completed).toHaveBeenCalledTimes(1);
  expect(completed.mock.calls[0]![1]).toMatchObject({ effect: { state: 'cancelled' } });
  expect(game.room.world.position('shield')).toBe('b:equipment');
  expect(game.room.world.player('b').hp).toBe(4);
  conserved(game);
});

it('真实无懈取消决斗后，停止效果启动后组但保留完整反制用牌和完成事实', async () => {
  const game = cardGame({
    hands: { a: [card('duel', 'duel')], c: [card('counter', 'nullification')] },
  });
  installCounterspells(game.room);
  const after = vi.fn();
  game.room.on(Resolve.starting, {
    id: 'after-counter',
    owner: null,
    group: 'after',
    eligible: () => true,
    run: after,
  });
  const running = use(game, { ...slash, choice: { kind: 'physical', card: 'duel' } });
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'counter' });
  expect(await running).toMatchObject({ value: { use: { effects: [{ state: 'cancelled' }] } } });
  expect(after.mock.calls.length).toBe(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(game.room.history.facts(Counter.finished)).toHaveLength(2);
  expect(game.room.world.position('counter')).toBe('discard');
  expect(game.room.world.player('b').hp).toBe(4);
  conserved(game);
});

it('桃园启动候选已令目标满体力，canResolve 失效立即收束同窗后续候选', async () => {
  const game = cardGame({ hands: { a: [card('salvation', 'god_salvation')] } });
  await game.room.run('wound', async (ctx) => {
    await loseHp(ctx, { player: 'b', amount: 2, reason: 'initial wound' });
  });
  game.room.on(Resolve.starting, {
    id: 'a-heal-first',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    async run(ctx) {
      await recover(ctx, { from: 'c', to: 'b', amount: 2 });
    },
  });
  const later = vi.fn();
  game.room.on(Resolve.starting, {
    id: 'z-later',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    run: later,
  });

  await use(game, { ...slash, choice: { kind: 'physical', card: 'salvation' }, targets: [] });
  expect(later.mock.calls.length).toBe(0);
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(Hp.recovered)).toHaveLength(1);
  conserved(game);
});

it('canResolve 只约束实际效果，不提前跳过满体力桃园目标的四层声明窗口', async () => {
  const game = cardGame({ hands: { a: [card('salvation', 'god_salvation')] } });
  game.room.on(Target.specified, {
    id: 'wound-before-resolving',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    async run(ctx) {
      await loseHp(ctx, { player: 'b', amount: 1, reason: 'target-stage wound' });
    },
  });
  await use(game, { ...slash, choice: { kind: 'physical', card: 'salvation' }, targets: [] });
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(Hp.recovered)).toHaveLength(1);
  conserved(game);
});

for (const name of ['snatch', 'dismantlement']) {
  it.each(['source-dead', 'last-card-gone'] as const)(
    `${name} 启动中 %s，由自身 canResolve 收束后续候选，而非一律要求用牌者存活`,
    async (boundary) => {
      const game = cardGame({
        hands: { a: [card('trick', name)], b: [card('held', 'jink')] },
      });
      game.room.on(Resolve.starting, {
        id: 'a-close-card-body',
        owner: null,
        eligible: () => true,
        async run(ctx) {
          if (boundary === 'source-dead') await die(ctx, 'a');
          else
            await moveCards(
              ctx,
              [{ cards: ['held'], from: 'b:hand', to: 'c:hand', place: 'bottom' }],
              'last available target card moved',
            );
        },
      });
      const later = vi.fn();
      game.room.on(Resolve.starting, {
        id: 'z-later',
        owner: null,
        eligible: () => true,
        run: later,
      });
      expect(
        await use(game, { ...slash, choice: { kind: 'physical', card: 'trick' } }),
      ).toMatchObject({
        value: { use: { effects: [{ state: 'skipped' }] } },
      });
      expect(later.mock.calls.length).toBe(0);
      expect(game.room.world.position('held')).toBe(
        boundary === 'source-dead' ? 'b:hand' : 'c:hand',
      );
      conserved(game);
    },
  );
}

it('内层杀的目标窗口令外层目标死亡，只收束外层而不打断内层结算', async () => {
  const game = cardGame({
    hands: { a: [card('slash', 'slash')], c: [card('inner', 'slash')] },
  });
  const later: string[] = [];
  game.room.on(Target.confirming, {
    id: 'a-inner-use',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    async run(ctx) {
      await useCard(ctx, {
        ...slash,
        actor: 'c',
        choice: { kind: 'physical', card: 'inner' },
        targets: ['d'],
      });
    },
  });
  game.room.on(Target.confirming, {
    id: 'b-stop-outer',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'd',
    run: (ctx) => die(ctx, 'b'),
  });
  game.room.on(Target.confirming, {
    id: 'z-later',
    owner: null,
    eligible: () => true,
    run: (_ctx, { effect }) => {
      later.push(effect.target);
    },
  });
  await use(game, slash);
  expect(later).toEqual(['d']);
  expect(game.room.world.player('d').hp).toBe(3);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  conserved(game);
});

it('公共效果完成后效中终局，后续完成候选仍看到同一已封口结果', async () => {
  const game = create();
  game.room.on(Resolve.finished, {
    id: 'a-finish-after-effect',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    async run(ctx) {
      await finishGame(ctx, { winners: ['c'], reason: 'after completed effect' });
    },
  });
  const later = vi.fn();
  game.room.on(Resolve.finished, {
    id: 'z-public-completion',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    run: later,
  });
  await use(game, slash);
  expect(later).toHaveBeenCalledTimes(1);
  expect(later.mock.calls[0]![1]).toMatchObject({ effect: { target: 'b', state: 'resolved' } });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.player('d').hp).toBe(4);
  conserved(game);
});
