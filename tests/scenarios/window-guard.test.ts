import { testTiming } from '../fixtures/timing';
import { expect, it } from 'vitest';
import { room, nextRequest } from '../fixtures/room';

class WindowGuard {
  #open: boolean;
  constructor(open = true) {
    this.#open = open;
  }
  get subject() {
    return 'b';
  }
  get anchor() {
    return 'a';
  }
  active() {
    return this.#open;
  }
  close() {
    this.#open = false;
  }
}

it('窗口进入时不再继续，则不收集来源、计算次数或执行效果', async () => {
  const target = room();
  const window = testTiming<null>('guard.closed');
  let collections = 0;
  target.addTriggerSource({
    collect: () => {
      collections++;
      return [];
    },
  });
  let ran = false;
  target.on(window, {
    id: 'run',
    owner: 'a',
    eligible: () => true,
    run() {
      ran = true;
    },
  });
  await target.run('window', (ctx) => ctx.window(window, null, new WindowGuard(false)));
  expect(collections).toBe(0);
  expect(ran).toBe(false);
});

it('一次效果后收束整个窗口，其他角色和后续组都不再执行', async () => {
  const target = room();
  const window = testTiming<null>('guard.stop', ['first', 'last']);
  const options = new WindowGuard();
  const seen: string[] = [];
  for (const [id, owner, group] of [
    ['A', 'a', 'first'],
    ['B', 'a', 'first'],
    ['C', 'b', 'last'],
  ] as const)
    target.on(window, {
      id,
      owner,
      group,
      eligible: () => true,
      run() {
        seen.push(id);
        options.close();
      },
    });
  await target.run('window', (ctx) => ctx.window(window, null, options));
  expect(seen).toEqual(['A']);
  expect(Object.isFrozen(options)).toBe(false);
  expect(target.history.entries.find((entry) => entry.type === 'window.order')?.data).toMatchObject(
    {
      subject: 'b',
      anchor: 'a',
      override: true,
    },
  );
  expect(target.history.entries.filter((entry) => entry.type === 'window.stopped')).toHaveLength(1);
});

it('顺序选择返回后再次检查窗口，不执行已经收束的旧选项', async () => {
  const target = room();
  const window = testTiming<null>('guard.selection');
  const options = new WindowGuard();
  const seen: string[] = [];
  for (const id of ['A', 'B'])
    target.on(window, {
      id,
      owner: 'a',
      order: 'choose',
      eligible: () => true,
      run() {
        seen.push(id);
      },
    });
  const running = target.run('window', (ctx) => ctx.window(window, null, options));
  const request = await nextRequest(target);
  options.active = () => true;
  options.close();
  expect(target.decisions.submit(request.id, request.token, 'A')).toEqual({ kind: 'accepted' });
  await running;
  expect(seen).toEqual([]);
  expect(target.decisions.pending).toEqual([]);
});

it('窗口继续条件在纯查询中执行，不能偷偷提交状态', async () => {
  const target = room();
  const window = testTiming<null>('guard.pure');
  await expect(
    target.run('window', (ctx) =>
      ctx.window(window, null, {
        active: (at) => {
          at.commit('unexpected', [], null);
          return true;
        },
      }),
    ),
  ).rejects.toThrow('Pure queries');
  expect(target.history.facts()).toEqual([]);
});
