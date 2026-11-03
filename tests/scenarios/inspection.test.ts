import { testTiming } from '../fixtures/timing';
import { expect, it } from 'vitest';
import type { Context, StateKey, Decision } from '../../src/sdk';
import { defineState, readState, setState, defineEffect, EffectBook } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
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
      ctx.commit('random.value', [], { value });
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
  expect(() => stale.commit('late', [], {})).toThrow();
  expect(game.history.entries).toEqual([]);
});

it('投影拒绝提交、随机、监听、清理登记、中止和子流程，且不改变 Room 状态', () => {
  const game = room();
  const window = testTiming<null>('inspect.probe');
  game.inspect((ctx) => {
    expect(() => ctx.commit('bad', [], {})).toThrow('read-only');
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
        ctx.commit('late.projection', [], {});
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

it('状态与独立效果的异步数据校验不能被布尔判断吞掉，执行侧止写而投影保持只读', async () => {
  for (const kind of ['state', 'effect'] as const) {
    for (const mode of ['execute', 'inspect'] as const) {
      const game = room();
      const initial = game.world.snapshot;
      let active: Context | undefined;
      let lateError = '';
      // 模拟 JS 或错误断言绕过 TS：声明/写入时正常，查询已存数据时才错误返回 Promise。
      const accepts = ((input: unknown) => {
        if (!active) return typeof input === 'number';
        const ctx = active;
        return (async () => {
          await Promise.resolve();
          try {
            ctx.commit('invalid.validator.late', [{ kind: 'vitality', player: 'b', hp: 1 }], null);
          } catch (error) {
            lateError = (error as Error).message;
          }
          return true;
        })();
      }) as unknown as StateKey<number>['accepts'];
      const key = defineState('probe:state', 0, accepts);
      const target = { owner: 'a', source: null, lifetime: null };
      const definition = defineEffect({
        id: 'probe:effect',
        name: '校验',
        accepts,
        create: () => ({}),
      });
      const effects = new EffectBook();
      effects.register([definition]);
      effects.attach(game);
      await game.run('seed', async (ctx) => {
        setState(ctx, key, target, 1);
        await effects.add(ctx, definition, { owner: 'a', data: 1 });
      });
      const before = game.history.facts();
      const read = (ctx: Context) =>
        kind === 'state'
          ? readState(ctx.world, key, target)
          : effects.instances(ctx.world, definition);
      let failure: unknown;
      try {
        if (mode === 'execute') {
          await game.run('invalid.validator', async (ctx) => {
            active = ctx;
            ctx.query(() => read(ctx));
            await Promise.resolve();
          });
        } else {
          game.inspect((ctx) => {
            active = ctx;
            return read(ctx);
          });
        }
      } catch (error) {
        failure = error;
      }
      await Promise.resolve();
      expect(game.world.player('b').hp).toBe(4);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(`Queries cannot await (probe:${kind}.accepts)`);
      expect(lateError).not.toBe('');
      expect(game.status).toBe(mode === 'execute' ? 'faulted' : 'ready');
      expect(game.history.facts()).toEqual(before);
      expect(rebuildWorld(initial, game.history.facts())).toEqual(game.world.snapshot);
      if (mode === 'inspect') {
        active = undefined;
        await game.run('after.inspection', (ctx) => ctx.commit('after.inspection', [], null));
        expect(game.history.facts('after.inspection')).toHaveLength(1);
      }
    }
  }
  expect(() =>
    defineState('probe:initial', 0, (async () => {
      await Promise.resolve();
      return true;
    }) as unknown as StateKey<number>['accepts']),
  ).toThrow('Queries cannot await (probe:initial.accepts)');
});
