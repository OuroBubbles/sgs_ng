import { expect, it } from 'vitest';
import { judge, moveCards, withProcessing, finishGame, kill, Judgment, Cards } from '../../src/sdk';
import { card, cardGame } from '../fixtures/cards';
import { rebuildWorld } from '../../src/core/history/rebuild';

it('判定公开实有牌，保留独立牌面、颜色和结果，并善后实时余牌', async () => {
  const game = cardGame({ hands: { a: [] }, draw: [card('top', 'slash', 'heart', 4)] });
  expect(
    await game.room.run('judge', (ctx) =>
      judge(ctx, {
        player: 'a',
        reason: 'probe',
        match: (_ctx, card) => card.color === 'red',
      }),
    ),
  ).toMatchObject({
    value: {
      kind: 'judged',
      matched: true,
      card: { id: 'top', suit: 'heart', color: 'red', rank: 4 },
    },
  });
  expect(game.room.world.position('top')).toBe('discard');
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(game.room.world.snapshot.states).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('改判牌移动与牌面同次提交，旧牌可原子换回手牌，后效看见新判定', async () => {
  const game = cardGame({
    hands: { a: [card('new', 'jink', 'diamond')] },
    draw: [card('old', 'slash')],
  });
  let held: Judgment | undefined;
  game.room.on(Judgment.revealed, {
    id: 'hold',
    owner: null,
    eligible: () => true,
    run(_ctx, judgment) {
      held = judgment;
    },
  });
  game.room.on(Cards.moved, {
    id: 'observe',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.cards.includes('new')),
    run(ctx) {
      expect(held!.card?.id).toBe('new');
      expect(ctx.world.position('old')).toBe('a:hand');
      expect(game.room.history.facts('judgment.replaced')).toHaveLength(1);
    },
  });
  game.room.on(Judgment.retrial, {
    id: 'replace',
    owner: 'a',
    eligible: () => true,
    async run(ctx, judgment) {
      expect(
        await judgment.replace(ctx, {
          card: 'new',
          from: 'a:hand',
          previousTo: 'a:hand',
          reason: 'swap',
        }),
      ).toBe('replaced');
    },
  });
  expect(
    await game.room.run('judge', (ctx) =>
      judge(ctx, {
        player: 'a',
        reason: 'probe',
        match: (_ctx, card) => card.suit === 'diamond',
      }),
    ),
  ).toMatchObject({ value: { matched: true, card: { id: 'new' } } });
  expect(game.room.world.position('old')).toBe('a:hand');
  expect(game.room.world.position('new')).toBe('discard');
});

it('连续改判按行动顺序结算，前一个改判不会封闭后一个', async () => {
  const game = cardGame({
    hands: { a: [card('first', 'jink', 'heart')], b: [card('last', 'peach', 'club')] },
    draw: [card('old', 'slash')],
  });
  for (const [owner, id] of [
    ['a', 'first'],
    ['b', 'last'],
  ] as const)
    game.room.on(Judgment.retrial, {
      id: owner,
      owner,
      eligible: () => true,
      async run(ctx, judgment) {
        await judgment.replace(ctx, { card: id, from: `${owner}:hand`, reason: owner });
      },
    });
  expect(
    await game.room.run('judge', (ctx) =>
      judge(ctx, {
        player: 'a',
        reason: 'probe',
        match: (_ctx, card) => card.color === 'black',
      }),
    ),
  ).toMatchObject({ value: { matched: true, card: { id: 'last' } } });
  expect(game.room.history.facts('judgment.replaced')).toHaveLength(2);
  expect(game.room.world.zone('discard').cards).toEqual(['old', 'first', 'last']);
});

it.each([false, true])(
  '原判定牌已被取得仍保留牌面，后续是否改判为 %s，善后不重复移动',
  async (replace) => {
    const game = cardGame({
      hands: { a: [card('new', 'peach', 'diamond')] },
      draw: [card('old', 'slash', 'heart')],
    });
    game.room.on(Judgment.revealed, {
      id: 'take',
      owner: null,
      eligible: () => true,
      async run(ctx, judgment) {
        await moveCards(
          ctx,
          [{ cards: ['old'], from: judgment.processing, to: 'b:hand', place: 'bottom' }],
          'take',
        );
      },
    });
    if (replace)
      game.room.on(Judgment.retrial, {
        id: 'replace',
        owner: null,
        eligible: () => true,
        async run(ctx, judgment) {
          await judgment.replace(ctx, { card: 'new', from: 'a:hand', reason: 'replace' });
        },
      });
    expect(
      await game.room.run('judge', (ctx) =>
        judge(ctx, {
          player: 'a',
          reason: 'probe',
          match: (_ctx, card) => card.color === 'red',
        }),
      ),
    ).toMatchObject({ value: { matched: true, card: { id: replace ? 'new' : 'old' } } });
    expect(game.room.world.position('old')).toBe('b:hand');
    expect(game.room.world.position('new')).toBe(replace ? 'discard' : 'a:hand');
  },
);

it('判定完成后可取得牌，结果已封口，不能再次改判', async () => {
  const game = cardGame({
    hands: { a: [card('new', 'peach')] },
    draw: [card('old', 'slash', 'heart')],
  });
  let held: Judgment | undefined;
  game.room.on(Judgment.revealed, {
    id: 'hold',
    owner: null,
    eligible: () => true,
    run(_ctx, judgment) {
      held = judgment;
    },
  });
  game.room.on(Judgment.finished, {
    id: 'take',
    owner: null,
    eligible: () => true,
    async run(ctx, result) {
      await expect(
        held!.replace(ctx, { card: 'new', from: 'a:hand', reason: 'late' }),
      ).rejects.toThrow('sealed');
      await moveCards(
        ctx,
        [{ cards: ['old'], from: result.processing, to: 'a:hand', place: 'bottom' }],
        'take-result',
      );
    },
  });
  await game.room.run('judge', (ctx) =>
    judge(ctx, { player: 'a', reason: 'probe', match: () => true }),
  );
  expect(held!.card?.id).toBe('old');
  expect(game.room.world.position('old')).toBe('a:hand');
  await expect(
    game.room.run('late', (ctx) =>
      held!.replace(ctx, { card: 'new', from: 'a:hand', reason: 'late' }),
    ),
  ).rejects.toThrow(/Lifetime|closed/);
});

it('牌堆空时只洗弃牌，其他判定/处理区的牌不被循环使用', async () => {
  const game = cardGame({
    hands: { a: [card('parked', 'slash')] },
    discard: [card('available', 'peach')],
  });
  await game.room.run('outer', (ctx) =>
    withProcessing(ctx, [{ cards: ['parked'], from: 'a:hand' }], async (at) => {
      expect(await judge(at, { player: 'a', reason: 'probe', match: () => true })).toMatchObject({
        card: { id: 'available' },
      });
      await moveCards(
        at,
        [{ cards: ['available'], from: 'discard', to: 'a:hand', place: 'bottom' }],
        'remove',
      );
      expect(await judge(at, { player: 'a', reason: 'empty', match: () => true })).toMatchObject({
        kind: 'unavailable',
        card: null,
        matched: null,
      });
    }),
  );
  expect(game.room.world.position('parked')).toBe('discard');
});

it('嵌套判定拥有独立牌面和处理区，内层完成不覆盖外层', async () => {
  const game = cardGame({
    hands: { a: [] },
    draw: [card('outer', 'slash', 'heart'), card('inner', 'jink')],
  });
  game.room.on(Judgment.retrial, {
    id: 'nested',
    owner: null,
    eligible: (_ctx, judgment) => judgment.reason === 'outer',
    async run(ctx, judgment) {
      expect(
        await judge(ctx, {
          player: 'b',
          reason: 'inner',
          match: (_ctx, card) => card.color === 'black',
        }),
      ).toMatchObject({ matched: true, card: { id: 'inner' } });
      expect(judgment.card?.id).toBe('outer');
      expect(ctx.world.position('outer')).toBe(judgment.processing);
    },
  });
  expect(
    await game.room.run('judge', (ctx) =>
      judge(ctx, {
        player: 'a',
        reason: 'outer',
        match: (_ctx, card) => card.color === 'red',
      }),
    ),
  ).toMatchObject({ value: { matched: true } });
});

it.each(['death', 'finish'] as const)(
  '判定中发生 %s，停止判定规则和后续改判，但已公开牌仍善后',
  async (kind) => {
    const game = cardGame({ hands: { a: [] }, draw: [card('old', 'slash')] });
    game.room.on(Judgment.revealed, {
      id: 'stop',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        if (kind === 'death')
          await kill(ctx, {
            player: 'a',
            killer: null,
            reason: 'rule',
            cause: { kind: 'rule', seq: null, data: null },
          });
        else await finishGame(ctx, { reason: 'probe', winners: [] });
      },
    });
    let evaluated = false;
    expect(
      await game.room.run('judge', (ctx) =>
        judge(ctx, {
          player: 'a',
          reason: 'probe',
          match: () => {
            evaluated = true;
            return true;
          },
        }),
      ),
    ).toMatchObject({ value: { kind: 'unavailable', matched: null } });
    expect(evaluated).toBe(false);
    expect(game.room.world.position('old')).toBe('discard');
  },
);

it('改判原区域已失效不支付；非法目的区域拒绝整批且不更新牌面', async () => {
  const game = cardGame({ hands: { a: [card('new', 'peach')] }, draw: [card('old', 'slash')] });
  game.room.on(Judgment.retrial, {
    id: 'replace',
    owner: null,
    eligible: () => true,
    async run(ctx, judgment) {
      expect(await judgment.replace(ctx, { card: 'new', from: 'b:hand', reason: 'stale' })).toBe(
        'unavailable',
      );
      const snapshot = ctx.world.snapshot;
      await expect(
        judgment.replace(ctx, {
          card: 'new',
          from: 'a:hand',
          previousTo: 'unknown',
          reason: 'bad',
        }),
      ).rejects.toThrow('Unknown destination');
      expect(ctx.world.snapshot).toBe(snapshot);
      expect(judgment.card?.id).toBe('old');
    },
  });
  await expect(
    game.room.run('judge', (ctx) =>
      judge(ctx, { player: 'a', reason: 'probe', match: () => true }),
    ),
  ).rejects.toThrow();
});
