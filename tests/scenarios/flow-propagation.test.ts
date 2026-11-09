import { expect, it } from 'vitest';
import type { Context } from '../../src/sdk';
import { withProcessing } from '../../src/rules/cards/processing';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { room, worldSeed, choose, nextRequest } from '../fixtures/room';
import { testTiming } from '../fixtures/timing';

it('普通 await 返回业务值，declined/unavailable/undefined 都不冒充流程中止', async () => {
  const game = room();
  const result = await game.run('author', async (ctx) => {
    for (const kind of ['declined', 'unavailable'] as const) {
      expect(await ctx.flow('option', () => ({ kind }))).toEqual({ kind });
    }
    expect(await ctx.flow('void', () => undefined)).toBeUndefined();
    return ctx.flow('value', () => ({ cards: ['a1'], count: 1 }));
  });
  expect(result).toEqual({ kind: 'resolved', value: { cards: ['a1'], count: 1 } });
  expect(game.status).toBe('ready');
});

it('中止默认向外传播，到显式 attempt 才恢复，清理按子到父执行', async () => {
  const game = room();
  const seen: string[] = [];
  await game.run('root', async (root) => {
    const outcome = await root.attempt('effect', async (effect) => {
      effect.defer(() => seen.push('effect cleanup'));
      try {
        await effect.flow('operation', (operation) => {
          operation.defer(() => seen.push('operation cleanup'));
          operation.commit(testTiming('paid'), [{ kind: 'vitality', player: 'a', hp: 3 }], {});
          operation.abort('author:stop');
        });
        seen.push('must not resume');
      } catch (error) {
        // JS catch 不能复活已经中止的上下文；恢复发生在外层拥有者。
        expect(effect.scope.active).toBe(false);
        expect(() => effect.commit(testTiming('invalid recovery'), [], {})).toThrow('author:stop');
        throw error;
      }
    });
    expect(outcome).toEqual({ kind: 'aborted', reason: 'author:stop' });
    root.commit(testTiming('recovered'), [], {});
    seen.push('outer recovery');
  });
  expect(seen).toEqual(['operation cleanup', 'effect cleanup', 'outer recovery']);
  expect(game.world.player('a').hp).toBe(3);
  expect(game.history.facts(testTiming('recovered'))).toHaveLength(1);
  expect(game.history.entries.some((entry) => entry.type === 'fault')).toBe(false);
  expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
});

it('普通根调用传播局部中止后仍可开始下一根流程，不误终结整个 Room', async () => {
  const game = room();
  const result = await game.run('first', (ctx) =>
    ctx.flow('child', (child) => child.abort('local')),
  );
  expect(result).toEqual({ kind: 'aborted', reason: 'local' });
  expect(game.status).toBe('ready');
  expect(await game.run('next', () => 7)).toEqual({ kind: 'resolved', value: 7 });
});

it('处理区先清理真实余牌再传播中止，已付事实不回滚', async () => {
  const game = room();
  let resumed = false;
  const result = await game.run('author', async (ctx) => {
    const outcome = await ctx.attempt('processing attempt', (at) =>
      withProcessing(at, [{ cards: ['a1'], from: 'a:hand' }], async (body) => {
        await body.flow('resolution', (child) => {
          child.commit(testTiming('declaration'), [], { card: 'a1' });
          child.abort('resolution interrupted');
        });
        resumed = true;
      }),
    );
    expect(ctx.world.position('a1')).toBe('discard');
    expect(outcome).toEqual({ kind: 'aborted', reason: 'resolution interrupted' });
    if (outcome.kind === 'aborted') ctx.abort(outcome.reason);
    resumed = true;
  });
  expect(result).toEqual({ kind: 'aborted', reason: 'resolution interrupted' });
  expect(resumed).toBe(false);
  expect(game.history.facts(testTiming('declaration'))).toHaveLength(1);
  expect(game.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
});

it('attempt 不捕获普通异常，保留最初故障现场', async () => {
  const game = room();
  const failure = new Error('author bug');
  await expect(
    game.run('outer', (ctx) =>
      ctx.attempt('broken', () => {
        throw failure;
      }),
    ),
  ).rejects.toBe(failure);
  expect(game.status).toBe('faulted');
  const faults = game.history.entries.filter((entry) => entry.type === 'fault');
  expect(faults).toHaveLength(1);
  expect(faults[0]?.reason).toBe('broken');
});

it('纯查询不能借 attempt 开启可写作用域', async () => {
  const game = room();
  await expect(
    game.run('query', (ctx) =>
      ctx.query(() => ctx.attempt('forbidden', (child) => child.abort('forbidden'))),
    ),
  ).rejects.toThrow('Pure queries');
  expect(game.status).toBe('faulted');
});

it('已关闭上下文不能借 flow 或 attempt 恢复执行', async () => {
  const game = room();
  const result = await game.run('capture', (ctx) => ctx);
  expect(result.kind).toBe('resolved');
  if (result.kind !== 'resolved') return;
  const stale: Context = result.value;
  expect(() => stale.flow('value', () => 1)).toThrow('Scope closed');
  expect(() => stale.attempt('recover', () => 1)).toThrow('Scope closed');
});

it('父流程等待子操作时，attempt 不能绕过并发守卫', async () => {
  const game = room();
  const children: Promise<unknown>[] = [];
  await expect(
    game.run('bad', (ctx) => {
      children.push(ctx.flow('waiting', (at) => at.ask(choose())));
      return ctx.attempt('concurrent', () => 1);
    }),
  ).rejects.toThrow('Concurrent rule operation');
  await Promise.allSettled(children);
  expect(game.decisions.pending).toEqual([]);
  expect(game.status).toBe('faulted');
});

it('立即终止 Room 唤醒等待链，attempt 不能恢复已关闭的父流程', async () => {
  const game = room();
  let resumed = false;
  const running = game.run('outer', async (ctx) => {
    await ctx.attempt('waiting', (at) => at.ask(choose()));
    resumed = true;
  });
  const request = await nextRequest(game);
  game.abort('room closed');
  expect(await running).toEqual({ kind: 'aborted', reason: 'room closed' });
  expect(resumed).toBe(false);
  expect(game.decisions.submit(request.id, request.token, 'yes')).toMatchObject({
    kind: 'rejected',
    reason: 'closed',
  });
  expect(game.status).toBe('ended');
  expect(game.history.entries.some((entry) => entry.type === 'fault')).toBe(false);
});
