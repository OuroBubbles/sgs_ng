import { expect, it } from 'vitest';
import type { Context, FlowResult } from '../../src/sdk';
import { withProcessing } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { room, worldSeed, choose, nextRequest } from '../fixtures/room';

it('unwrap 直接返回业务值，declined/unavailable/undefined 都不冒充流程中止', async () => {
  const game = room();
  const result = await game.run('author', async (ctx) => {
    for (const kind of ['declined', 'unavailable'] as const) {
      const value = ctx.unwrap(await ctx.flow('option', () => ({ kind })));
      expect(value).toEqual({ kind });
    }
    expect(ctx.unwrap(await ctx.flow('void', () => undefined))).toBeUndefined();
    const value = { cards: ['a1'], count: 1 };
    return ctx.unwrap(await ctx.flow('value', () => value));
  });
  expect(result).toEqual({ kind: 'resolved', value: { cards: ['a1'], count: 1 } });
  expect(game.status).toBe('ready');
});

it('中止只沿显式 unwrap 的调用层传播，外层仍能选择恢复，清理按子到父执行', async () => {
  const game = room();
  const seen: string[] = [];
  await game.run('root', async (root) => {
    const outcome = await root.flow('effect', async (effect) => {
      effect.defer(() => seen.push('effect cleanup'));
      effect.unwrap(
        await effect.flow('operation', (operation) => {
          operation.defer(() => seen.push('operation cleanup'));
          operation.commit('paid', [{ kind: 'vitality', player: 'a', hp: 3 }], {});
          return operation.abort('author:stop');
        }),
      );
      seen.push('must not resume');
    });
    expect(outcome).toEqual({ kind: 'aborted', reason: 'author:stop' });
    root.commit('recovered', [], {});
    seen.push('outer recovery');
  });
  expect(seen).toEqual(['operation cleanup', 'effect cleanup', 'outer recovery']);
  expect(game.world.player('a').hp).toBe(3);
  expect(game.history.facts('recovered')).toHaveLength(1);
  expect(game.history.entries.some((entry) => entry.type === 'fault')).toBe(false);
  expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
});

it('根调用者显式解包中止后仍可开始下一根流程，不误终结整个 Room', async () => {
  const game = room();
  const result = await game.run('first', async (ctx) =>
    ctx.unwrap(await ctx.flow('child', (child) => child.abort('local'))),
  );
  expect(result).toEqual({ kind: 'aborted', reason: 'local' });
  expect(game.status).toBe('ready');
  expect(await game.run('next', () => 7)).toEqual({ kind: 'resolved', value: 7 });
});

it('处理区 body 经 unwrap 中止后先清理真实余牌，再由上层决定继续，已付事实不回滚', async () => {
  const game = room();
  let resumed = false;
  const result = await game.run('author', async (ctx) => {
    const outcome = await withProcessing(
      ctx,
      [{ cards: ['a1'], from: 'a:hand' }],
      'discard',
      async (body) => {
        body.unwrap(
          await body.flow('resolution', (at) => {
            at.commit('declaration', [], { card: 'a1' });
            return at.abort('resolution interrupted');
          }),
        );
        resumed = true;
      },
    );
    expect(ctx.world.position('a1')).toBe('discard');
    ctx.unwrap(outcome);
    resumed = true;
  });
  expect(result).toEqual({ kind: 'aborted', reason: 'resolution interrupted' });
  expect(resumed).toBe(false);
  expect(game.history.facts('declaration')).toHaveLength(1);
  expect(game.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
});

it('普通异常保持最初故障现场，不变成可恢复的 aborted', async () => {
  const game = room();
  const failure = new Error('author bug');
  await expect(
    game.run('outer', async (ctx) =>
      ctx.unwrap(
        await ctx.flow('broken', () => {
          throw failure;
        }),
      ),
    ),
  ).rejects.toBe(failure);
  expect(game.status).toBe('faulted');
  const faults = game.history.entries.filter((entry) => entry.type === 'fault');
  expect(faults).toHaveLength(1);
  expect(faults[0]?.reason).toBe('broken');
});

it('纯查询不能借 unwrap 的中止分支关闭作用域', async () => {
  const game = room();
  await expect(
    game.run('query', (ctx) =>
      ctx.query(() => ctx.unwrap({ kind: 'aborted', reason: 'forbidden' })),
    ),
  ).rejects.toThrow('Pure queries');
  expect(game.status).toBe('faulted');
});

it('已关闭上下文不能借一个 resolved 结果恢复执行', async () => {
  const game = room();
  const result = await game.run('capture', (ctx) => ctx);
  expect(result.kind).toBe('resolved');
  if (result.kind !== 'resolved') return;
  const stale: Context = result.value;
  expect(() => stale.unwrap({ kind: 'resolved', value: 1 })).toThrow('Scope closed');
});

it('父流程等待子操作时，不能用另一个 resolved 结果绕过并发守卫', async () => {
  const game = room();
  const children: Promise<FlowResult<unknown>>[] = [];
  await expect(
    game.run('bad', (ctx) => {
      children.push(ctx.flow('waiting', (at) => at.ask(choose())));
      return ctx.unwrap({ kind: 'resolved', value: 1 });
    }),
  ).rejects.toThrow('Concurrent rule operation');
  await Promise.allSettled(children);
  expect(game.decisions.pending).toEqual([]);
  expect(game.status).toBe('faulted');
});

it('立即终止 Room 唤醒等待链；unwrap 不产生第二次故障或尝试恢复已关闭流程', async () => {
  const game = room();
  const running = game.run('outer', async (ctx) =>
    ctx.unwrap(await ctx.flow('waiting', (at) => at.ask(choose()))),
  );
  const request = await nextRequest(game);
  game.abort('room closed');
  expect(await running).toEqual({ kind: 'aborted', reason: 'room closed' });
  expect(game.decisions.submit(request.id, request.token, 'yes')).toMatchObject({
    kind: 'rejected',
    reason: 'closed',
  });
  expect(game.status).toBe('ended');
  expect(game.history.entries.some((entry) => entry.type === 'fault')).toBe(false);
});
