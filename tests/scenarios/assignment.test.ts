import { expect, it } from 'vitest';
import { ArrangementSelection } from '../../src/sdk';
import type { ArrangementChoice, ArrangementGroup } from '../../src/sdk';
import { nextRequest, room } from '../fixtures/room';
import { testTiming } from '../fixtures/timing';

const items = ['x', 'y', 'z'].map((id) => ({ id, label: id }));
const group = (id: string, min = 0, max: number | 'all' = 1): ArrangementGroup => ({
  id,
  label: id,
  count: { min, max },
});
const choice = (...groups: readonly [string, readonly string[]][]): ArrangementChoice => ({
  groups: groups.map(([id, items]) => ({ id, items })),
});

it('两组总容量足够但只有同一件物品可进入两组，无解时不开放必选等待', async () => {
  const model = new ArrangementSelection({
    items: () => items.slice(0, 2),
    groups: [group('a', 1), group('b', 1)],
    canPlace: (item) => item === 'x',
  });
  const target = room();
  expect(await target.run('ask', (ctx) => ctx.ask(model.decision('a', '分配')))).toMatchObject({
    value: { kind: 'unavailable' },
  });
  expect(target.decisions.pending).toEqual([]);
});

it('初始分配可通过重配已占名额满足接收限制，不被贪心选择困住', () => {
  const model = new ArrangementSelection({
    items: () => items.slice(0, 2),
    groups: [group('a', 1), group('b', 1)],
    canPlace: (item, group) => item === 'x' || group === 'a',
  });
  expect(model.initial()).toEqual(choice(['a', ['y']], ['b', ['x']]));
  expect(model.validate(model.initial()).ok).toBe(true);
  expect(model.validate(choice(['a', ['x']], ['b', ['y']])).ok).toBe(false);
});

it('无下限但容量竞争时也能增广，兼容多张额度和同组顺序', () => {
  const model = new ArrangementSelection({
    items: () => items,
    groups: [group('a', 0, 2), group('b')],
    canPlace: (item, group) => item === 'x' || group === 'a',
  });
  expect(model.initial()).toEqual(choice(['a', ['y', 'z']], ['b', ['x']]));
  expect(model.validate(choice(['a', ['z', 'y']], ['b', ['x']]))).toMatchObject({
    ok: true,
    value: choice(['a', ['z', 'y']], ['b', ['x']]),
  });
});

it('旧排序默认仍按候选顺序先满足各组下限，再填第一个可用组', () => {
  const model = new ArrangementSelection({
    items: () => items,
    groups: [group('a', 1, 2), group('b', 1, 2)],
  });
  expect(model.initial()).toEqual(choice(['a', ['x', 'z']], ['b', ['y']]));
});

it('动态接收者、额度和逐牌条件都参加最终校验，刷新旧令牌不能继续提交', async () => {
  let groups = [group('a', 0, 2), group('b', 0, 2)];
  let blocked = false;
  const model = new ArrangementSelection({
    items: () => items.slice(0, 2),
    groups: () => groups,
    canPlace: (item, group) => !(blocked && item === 'x' && group === 'b'),
  });
  const target = room();
  const running = target.run('ask', (ctx) => ctx.ask(model.decision('a', '分配')));
  const old = await nextRequest(target);
  blocked = true;
  groups = [group('a', 0, 1), group('b', 0, 1)];
  target.decisions.invalidate(old.id);
  const fresh = target.decisions.pending[0]!;
  expect(
    target.decisions.submit(old.id, old.token, choice(['a', ['x']], ['b', ['y']])),
  ).toMatchObject({ reason: 'stale' });
  expect(
    target.decisions.submit(fresh.id, fresh.token, choice(['a', ['y']], ['b', ['x']])),
  ).toMatchObject({ reason: 'invalid' });
  expect(
    target.decisions.submit(fresh.id, fresh.token, choice(['a', ['x']], ['b', ['y']])),
  ).toEqual({ kind: 'accepted' });
  expect(await running).toMatchObject({ value: { kind: 'chosen' } });
  groups = [group('a', 0, 2)];
  expect(model.validate(choice(['a', ['x']], ['b', ['y']])).ok).toBe(false);
});

it('动态接收者全部消失时关闭必选请求，恢复时重新求当前合法初始方案', async () => {
  let groups = [group('a', 0, 2)];
  const model = new ArrangementSelection({ items: () => items.slice(0, 2), groups: () => groups });
  const target = room();
  const running = target.run('ask', (ctx) => ctx.ask(model.decision('a', '分配')));
  const request = await nextRequest(target);
  groups = [];
  target.decisions.invalidate(request.id);
  expect(await running).toMatchObject({ value: { kind: 'unavailable' } });
  expect(model.validate(choice()).ok).toBe(false);
  groups = [group('back', 0, 2)];
  expect(model.initial()).toEqual(choice(['back', ['x', 'y']]));
});

it('接收矩阵仅描述当前物品与组，纯函数必须返回布尔值，声明和结果不共享可变数据', () => {
  const groups = [group('a', 0, 3), group('b', 0, 3)];
  const model = new ArrangementSelection({
    items: () => items,
    groups,
    canPlace: (item, group) => item === 'x' || group === 'a',
  });
  groups.pop();
  const data = model.decision('a', '分配', { presentation: 'distribution' }).describe!();
  expect(data).toMatchObject({
    presentation: 'distribution',
    destinations: { x: ['a', 'b'], y: ['a'], z: ['a'] },
  });
  expect(Object.isFrozen(model.initial().groups[0]!.items)).toBe(true);
  expect(() =>
    new ArrangementSelection({
      items: () => items,
      groups,
      canPlace: () => undefined as unknown as boolean,
    }).initial(),
  ).toThrow(/boolean/);
  const invalid = new ArrangementSelection({
    items: () => items,
    groups: () => [group('a'), group('a')],
  });
  expect(() => invalid.initial()).toThrow(/distinct/);
});

it('三物品三组的全部兼容矩阵及多组上下限，与独立穷举可行性一致', () => {
  const quotas = [
    [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
    [
      [1, 1],
      [1, 1],
      [1, 1],
    ],
    [
      [1, 2],
      [1, 2],
      [0, 2],
    ],
    [
      [0, 3],
      [1, 1],
      [0, 1],
    ],
    [
      [2, 3],
      [0, 1],
      [0, 1],
    ],
    [
      [0, 0],
      [1, 2],
      [1, 2],
    ],
    [
      [2, 2],
      [2, 2],
      [0, 3],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 1],
    ],
  ];
  for (let mask = 0; mask < 512; mask++)
    for (const limits of quotas) {
      const allowed = (item: number, group: number) => Boolean(mask & (1 << (item * 3 + group)));
      let possible = false;
      for (let assignment = 0; assignment < 27; assignment++) {
        const owners = [assignment % 3, Math.floor(assignment / 3) % 3, Math.floor(assignment / 9)];
        if (
          owners.every((group, item) => allowed(item, group)) &&
          limits.every(([min, max], group) => {
            const count = owners.filter((owner) => owner === group).length;
            return count >= min! && count <= max!;
          })
        ) {
          possible = true;
          break;
        }
      }
      const model = new ArrangementSelection({
        items: () => items,
        groups: limits.map(([min, max], index) => group(String(index), min, max)),
        canPlace: (item, group) =>
          allowed(
            items.findIndex((entry) => entry.id === item),
            Number(group),
          ),
      });
      expect(
        model.decision('a', 'oracle').available!(),
        `mask ${mask}, ${JSON.stringify(limits)}`,
      ).toBe(possible);
      if (possible) expect(model.validate(model.initial()).ok).toBe(true);
    }
});

it.each(['groups', 'canPlace'] as const)(
  '动态 %s 仍受纯查询保护，不能在求解时偷偷写入规则状态',
  async (part) => {
    const target = room();
    await expect(
      target.run('impure', (ctx) => {
        const write = () => {
          ctx.commit(testTiming('forbidden'), [], {});
          return true;
        };
        const model = new ArrangementSelection({
          items: () => items,
          groups: () => {
            if (part === 'groups') write();
            return [group('a', 0, 'all')];
          },
          canPlace: () => (part === 'canPlace' ? write() : true),
        });
        return ctx.ask(model.decision('a', 'impure'));
      }),
    ).rejects.toThrow(/Pure queries/);
    expect(target.history.facts(testTiming('forbidden'))).toHaveLength(0);
    expect(target.decisions.pending).toEqual([]);
  },
);
