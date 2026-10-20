import { expect, it } from 'vitest';
import { room, choose, nextRequest } from '../fixtures/room';

it('优雅结束关闭现有和未来输入，但允许当前根流程提交善后', async () => {
  const game = room();
  const running = game.run('active', async (ctx) => {
    expect(await ctx.ask(choose())).toEqual({ kind: 'aborted' });
    expect(await ctx.ask(choose())).toEqual({ kind: 'unavailable' });
    expect(game.status).toBe('running');
    ctx.commit('cleanup', [], null);
    return 'clean';
  });
  const request = await nextRequest(game);
  game.finish('done');
  expect(game.decisions.submit(request.id, request.token, 'yes').kind).toBe('rejected');
  expect(await running).toEqual({ kind: 'resolved', value: 'clean' });
  expect(game.status).toBe('ended');
  expect(game.history.facts('cleanup')).toHaveLength(1);
  expect(() => game.run('late', () => undefined)).toThrow('ended');
  game.finish('again');
});

it('优雅结束期间仍然暴露故障，不能把异常伪装成成功结束', async () => {
  const game = room();
  await expect(
    game.run('bad', () => {
      game.finish('done');
      throw new Error('cleanup failure');
    }),
  ).rejects.toThrow('cleanup failure');
  expect(game.status).toBe('faulted');
});
