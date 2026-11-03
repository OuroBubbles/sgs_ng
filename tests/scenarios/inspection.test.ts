import { testTiming } from '../fixtures/timing';
import { expect, it } from 'vitest';
import type { Context, Decision } from '../../src/sdk';
import '../../src/sdk';
import '../../src/core/history/rebuild';
import { room, nextRequest, choose } from '../fixtures/room';

it('决策的字段、方法与返回数据在同一纯查询边界读取，getter 不能重入规则操作', async () => {
  for (const mode of [
    'methods',
    'header',
    'description',
    'refresh',
    'feedback',
    'value',
    'validation',
  ] as const) {
    const game = room();
    const before = game.world.snapshot;
    const window = testTiming<null>('probe.decision-snapshot');
    let detach: (() => void) | undefined;
    let refresh = false;
    const write = () => {
      detach = game.on(window, {
        id: 'unexpected',
        owner: 'a',
        eligible: () => true,
        run: () => {},
      });
    };
    const data = () => ({
      get value() {
        write();
        return 1;
      },
    });
    const spec: Decision<unknown> = {
      get player() {
        if (mode === 'header') write();
        return 'a';
      },
      kind: 'probe',
      prompt: '选择',
      optional: false,
      data: null,
      describe: () => (mode === 'description' || (mode === 'refresh' && refresh) ? data() : null),
      feedback: () => data(),
      get validate() {
        if (mode === 'methods') write();
        return () =>
          mode === 'validation'
            ? {
                get ok() {
                  write();
                  return true as const;
                },
                value: 1,
              }
            : { ok: true as const, value: mode === 'value' ? data() : 'yes' };
      },
    };
    const running = game.run('decision-copy', (ctx) => ctx.ask(spec));
    try {
      if (mode === 'methods' || mode === 'header' || mode === 'description') {
        expect(game.status, mode).toBe('faulted');
      } else {
        const request = await nextRequest(game);
        refresh = true;
        const invoke = () =>
          mode === 'refresh'
            ? game.decisions.invalidate(request.id)
            : mode === 'value'
              ? game.decisions.submit(request.id, request.token, 'yes')
              : game.decisions.preview(request.id, 'yes');
        expect(invoke, mode).toThrow('Pure queries cannot perform rule operations.');
      }
      await expect(running).rejects.toThrow('Pure queries cannot perform rule operations.');
      expect(game.status).toBe('faulted');
      expect(game.decisions.pending).toEqual([]);
      expect(game.world.snapshot).toBe(before);
      expect(game.history.facts()).toEqual([]);
    } finally {
      game.abort('done');
      detach?.();
      await Promise.allSettled([running]);
    }
  }
});

it('同步投影不产生事实、流程或随机编号，查询前后相同种子的执行证据一致', async () => {
  const first = room();
  const second = room();
  for (let index = 0; index < 5; index++)
    expect(first.inspect((ctx) => ctx.world.player('a').hp)).toBe(4);
  expect(first.history.entries).toEqual([]);
  for (const game of [first, second])
    await game.run('real', (ctx) => {
      const value = ctx.randomInt(1000);
      ctx.commit(testTiming('random.value'), [], { value });
    });
  expect(first.history.entries).toEqual(second.history.entries);
});

it('正在等待决策时可以只读投影，不接纳旧请求或干扰当前结算', async () => {
  const game = room();
  const running = game.run('waiting', (ctx) => ctx.ask(choose()));
  const request = await nextRequest(game);
  expect(game.inspect((ctx) => ctx.world.zone('a:hand').cards)).toEqual(['a1', 'a2']);
  expect(game.status).toBe('running');
  expect(game.decisions.pending[0]?.id).toBe(request.id);
  expect(game.decisions.submit(request.id, request.token, 'yes').kind).toBe('accepted');
  await running;
});

it('投影上下文返回后立即关闭，不能缓存它作为后续查询或写入入口', () => {
  const game = room();
  const stale = game.inspect((ctx) => ctx);
  expect(() => stale.query(() => 1)).toThrow('Inspection finished');
  expect(() => stale.commit(testTiming('late'), [], {})).toThrow();
  expect(game.history.entries).toEqual([]);
});

it('投影拒绝提交、随机、监听、清理登记、中止和子流程，且不改变 Room 状态', () => {
  const game = room();
  const window = testTiming<null>('inspect.probe');
  game.inspect((ctx) => {
    expect(() => ctx.commit(testTiming('bad'), [], {})).toThrow('read-only');
    expect(() => ctx.randomInt(2)).toThrow('read-only');
    expect(() => ctx.defer(() => {})).toThrow('read-only');
    expect(() => ctx.abort('bad')).toThrow('read-only');
    expect(() => ctx.flow('bad', () => {})).toThrow('read-only');
    expect(() => ctx.window(window, null)).toThrow('read-only');
    expect(() => game.run('escape', () => {})).toThrow('Pure queries');
    expect(() => game.abort('escape')).toThrow('Pure queries');
  });
  expect(game.status).toBe('ready');
  expect(game.history.entries).toEqual([]);
});

it('投影拒绝异步结果、关闭泄漏上下文，查询异常不会修改规则状态或冻结整局', async () => {
  const game = room();
  let stale: Context | undefined;
  expect(() =>
    game.inspect((ctx) => {
      stale = ctx;
      return (async () => {
        await Promise.resolve();
        ctx.commit(testTiming('late.projection'), [], {});
      })();
    }),
  ).toThrow('Queries cannot await');
  await Promise.resolve();
  expect(() => stale!.query(() => 1)).toThrow('Inspection finished');
  const error = new Error('projection failure');
  expect(() =>
    game.inspect(() => {
      throw error;
    }),
  ).toThrow(error);
  expect(game.status).toBe('ready');
  expect(game.history.entries).toEqual([]);
  expect(game.inspect((ctx) => ctx.query(() => ({ then: 'ordinary data' })))).toEqual({
    then: 'ordinary data',
  });
});

it('结束后可检查最终只读状态；嵌套投影不消耗运行时资源或因果编号', () => {
  const game = room();
  game.abort('end');
  expect(game.inspect((outer) => game.inspect((inner) => inner.world === outer.world))).toBe(true);
  expect(game.status).toBe('ended');
  expect(game.history.entries).toEqual([]);
});
