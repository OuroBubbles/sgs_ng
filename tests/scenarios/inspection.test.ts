import { expect, it } from 'vitest';
import type { Context } from '../../src/sdk';
import { defineWindow } from '../../src/sdk';
import { room, nextRequest, choose } from '../fixtures/room';

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
  const window = defineWindow<null>('inspect.probe');
  game.inspect((ctx) => {
    expect(() => ctx.commit('bad', [], {})).toThrow('read-only');
    expect(() => ctx.randomInt(2)).toThrow('read-only');
    expect(() => ctx.defer(() => {})).toThrow('read-only');
    expect(() => ctx.abort('bad')).toThrow('read-only');
    expect(() => ctx.flow('bad', () => {})).toThrow('read-only');
    expect(() => ctx.window(window, null)).toThrow('read-only');
    expect(() =>
      ctx.listen(window, { id: 'bad', owner: null, eligible: () => true, run: () => {} }),
    ).toThrow('read-only');
    expect(() => game.run('escape', () => {})).toThrow('Pure queries');
    expect(() => game.abort('escape')).toThrow('Pure queries');
  });
  expect(game.status).toBe('ready');
  expect(game.history.entries).toEqual([]);
});

it('投影拒绝异步结果、关闭泄漏上下文，查询异常不会修改规则状态或冻结整局', () => {
  const game = room();
  let stale: Context | undefined;
  expect(() =>
    game.inspect((ctx) => {
      stale = ctx;
      return Promise.resolve(1);
    }),
  ).toThrow('Queries cannot await');
  expect(() => stale!.query(() => 1)).toThrow('Inspection finished');
  const error = new Error('projection failure');
  expect(() =>
    game.inspect(() => {
      throw error;
    }),
  ).toThrow(error);
  expect(game.status).toBe('ready');
  expect(game.history.entries).toEqual([]);
});

it('结束后可检查最终只读状态；嵌套投影不消耗运行时资源或因果编号', () => {
  const game = room();
  game.abort('end');
  expect(game.inspect((outer) => game.inspect((inner) => inner.world === outer.world))).toBe(true);
  expect(game.status).toBe('ended');
  expect(game.history.entries).toEqual([]);
});
