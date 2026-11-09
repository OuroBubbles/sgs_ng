import { expect, it } from 'vitest';
import { moveCards, Cards } from '../../src/sdk';
import { withProcessing } from '../../src/rules/cards/processing';
import type { Processing } from '../../src/sdk';
import { nextRequest, room } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { worldSeed } from '../fixtures/room';

it('材料被后效取走一部分，结尾只弃置仍在本次处理区的牌', async () => {
  const game = room();
  game.on(Cards.moved, {
    id: 'obtain',
    owner: 'b',
    eligible: (_ctx, batch) =>
      batch.after.some((zone) => zone.kind === 'processing' && zone.cards.includes('a1')),
    run: async (ctx) => {
      await moveCards(
        ctx,
        [{ cards: ['a1'], from: ctx.world.position('a1'), to: 'b:hand', place: 'bottom' }],
        'take material',
      );
    },
  });
  await game.run('use', (ctx) =>
    withProcessing(ctx, [{ cards: ['a1', 'a2'], from: 'a:hand' }], (_child, processing) => {
      expect(processing.remaining()).toEqual(['a2']);
    }),
  );
  expect(game.world.zone('b:hand').cards).toEqual(['b1', 'a1']);
  expect(game.world.zone('discard').cards).toEqual(['a2']);
  expect(game.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
});

it('处理 body 中止仍执行领域善后；自定义策略可以将余牌放回牌堆顶', async () => {
  const game = room();
  const exits: string[] = [];
  const result = await game.run('sort', (ctx) =>
    withProcessing(
      ctx,
      [{ cards: ['a1', 'a2'], from: 'a:hand' }],
      (body) => {
        body.abort('declined ordering');
      },
      async (cleanup, processing, exit) => {
        exits.push(exit);
        await moveCards(
          cleanup,
          [{ cards: processing.remaining(), from: processing.zone, to: 'draw', place: 'top' }],
          'return after abort',
        );
      },
    ),
  );
  expect(result).toMatchObject({
    kind: 'aborted',
    reason: 'declined ordering',
  });
  expect(exits).toEqual(['aborted']);
  expect(game.world.zone('draw').cards).toEqual(['a1', 'a2', 'd1']);
  expect(game.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
});

it('排序选择用普通闭包验证整组恰好一次，不接受遗漏或重复材料', async () => {
  const game = room();
  const captured: { processing?: Processing } = {};
  const running = game.run('sort', (ctx) =>
    withProcessing(ctx, [{ cards: ['a1', 'a2'], from: 'a:hand' }], async (body, processing) => {
      captured.processing = processing;
      const cards = processing.remaining();
      const reply = await body.ask({
        player: 'a',
        kind: 'sort',
        prompt: '排列这些牌',
        data: { cards },
        optional: false,
        validate: (input) =>
          Array.isArray(input) &&
          input.length === cards.length &&
          new Set(input).size === cards.length &&
          input.every((id): id is string => typeof id === 'string' && cards.includes(id))
            ? { ok: true, value: input }
            : { ok: false, reason: 'Use every card exactly once.' },
      });
      if (reply.kind === 'chosen')
        await moveCards(
          body,
          [{ cards: reply.value, from: processing.zone, to: 'draw', place: 'top' }],
          'ordered top',
        );
    }),
  );
  const request = await nextRequest(game);
  expect(game.decisions.submit(request.id, request.token, ['a1', 'a1'])).toMatchObject({
    reason: 'invalid',
  });
  expect(game.decisions.submit(request.id, request.token, ['a1'])).toMatchObject({
    reason: 'invalid',
  });
  expect(game.decisions.submit(request.id, request.token, ['a2', 'a1']).kind).toBe('accepted');
  await running;
  expect(game.world.zone('draw').cards).toEqual(['a2', 'a1', 'd1']);
  expect(game.world.zone('discard').cards).toEqual([]);
  expect(() => captured.processing?.remaining()).toThrow('closed');
});

it('内容错误冻结现场，不能擅自执行处理区弃牌后效', async () => {
  const game = room();
  await expect(
    game.run('broken', (ctx) =>
      withProcessing(ctx, [{ cards: ['a1'], from: 'a:hand' }], () => {
        throw new Error('content bug');
      }),
    ),
  ).rejects.toThrow('content bug');
  expect(game.status).toBe('faulted');
  expect(game.world.zone('discard').cards).toEqual([]);
  expect(game.world.snapshot.zones.find((zone) => zone.kind === 'processing')?.cards).toEqual([
    'a1',
  ]);
});

it('空材料是正常处理流程；嵌套处理区身份互不覆盖', async () => {
  const game = room();
  const ids: string[] = [];
  await game.run('virtual', (ctx) =>
    withProcessing(ctx, [], async (outer, a) => {
      ids.push(a.zone);
      await withProcessing(outer, [{ cards: ['a1'], from: 'a:hand' }], (_inner, b) => {
        ids.push(b.zone);
      });
      const returned = await withProcessing(
        outer,
        [{ cards: ['a2'], from: 'a:hand' }],
        (_inner, b) => {
          ids.push(b.zone);
          return { card: b.remaining()[0] };
        },
        'draw',
      );
      expect(returned).toEqual({ card: 'a2' });
      expect(a.remaining()).toEqual([]);
    }),
  );
  expect(new Set(ids).size).toBe(3);
  expect(game.world.zone('discard').cards).toEqual(['a1']);
  expect(game.world.zone('draw').cards).toEqual(['d1', 'a2']);
  expect(game.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
});

it('历史按显式阶段作用域包含后代操作，不靠父事件层数猜测', async () => {
  const game = room();
  let phaseId = '';
  await game.run('turn', async (ctx) => {
    await ctx.flow('discard-phase', async (phase) => {
      phaseId = phase.scope.id;
      await moveCards(
        phase,
        [{ cards: ['a1'], from: 'a:hand', to: 'discard', place: 'bottom' }],
        'discard',
      );
    });
    await moveCards(
      ctx,
      [{ cards: ['a2'], from: 'a:hand', to: 'discard', place: 'bottom' }],
      'outside phase',
    );
    expect(ctx.history.facts(Cards.moved, phaseId)).toHaveLength(1);
    expect(ctx.history.facts(Cards.moved)).toHaveLength(2);
  });
  expect(game.history.facts(Cards.moved, phaseId)[0]?.scopeId).not.toBe(phaseId);
});

it('处理区创建、取得材料和善后可由提交事实重建，乱序或遗漏事实被拒绝', async () => {
  const game = room();
  await game.run('use', (ctx) =>
    withProcessing(ctx, [{ cards: ['a1', 'a2'], from: 'a:hand' }], async (body, processing) => {
      await moveCards(
        body,
        [{ cards: ['a1'], from: processing.zone, to: 'b:hand', place: 'bottom' }],
        'obtain',
      );
    }),
  );
  const facts = game.history.facts();
  expect(rebuildWorld(worldSeed(), facts)).toEqual(game.world.snapshot);
  expect(() => rebuildWorld(worldSeed(), [...facts].reverse())).toThrow('discontinuous');
  expect(() => rebuildWorld(worldSeed(), facts.slice(1))).toThrow('discontinuous');
});
