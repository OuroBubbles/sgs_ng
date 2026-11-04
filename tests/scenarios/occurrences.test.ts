import { testTiming } from '../fixtures/timing';
import { expect, it } from 'vitest';
import {
  defineSkill,
  on,
  SkillBook,
  damage,
  draw,
  moveCards,
  runPhase,
  runTurn,
} from '../../src/sdk';
import type { TriggerOccurrence, TriggerSource } from '../../src/core/runtime/event';
import type { WorldSeed } from '../../src/core/model/state';
import type { Room } from '../../src/core/runtime/room';
import { room, nextRequest, choose, answer, cancel } from '../fixtures/room';
import { card, cardGame, grant, settled, die } from '../fixtures/cards';
import { standardGeneralSkills } from '../fixtures/standard';
import { luoyiAftereffect } from '../../src/content/standard/generals/xuchu';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { Draw } from '../../src/rules/cards/draw';
import { Skill } from '../../src/sdk';

const source = { kind: 'general', id: 'test' } as const;
function replay(target: Room, initial: WorldSeed) {
  expect(rebuildWorld(initial, target.history.facts())).toEqual(target.world.snapshot);
  expect(target.decisions.pending).toEqual([]);
}
function candidates(target: Room, outcome: 'running' | 'ineligible') {
  return target.history.entries
    .filter((e) => e.type === 'window.candidate')
    .map(
      (e) =>
        e.data as {
          window: string;
          source: string;
          effect: string;
          occurrence: TriggerOccurrence;
          outcome: string;
        },
    )
    .filter((e) => e.outcome === outcome);
}
async function order(target: Room, label: string) {
  const request = await nextRequest(target);
  expect(request.kind).toBe('trigger-order');
  const data = request.data as {
    labels: Record<string, string>;
    occurrences: Record<string, TriggerOccurrence>;
  };
  const id = Object.keys(data.labels).find((id) => data.labels[id] === label);
  expect(id).toBeDefined();
  expect(target.decisions.submit(request.id, request.token, id)).toEqual({ kind: 'accepted' });
  return data;
}

it('次数从开窗时的权威状态读取一次，后效不改变当前总数；下一窗口重新读取', async () => {
  const target = room();
  const initial = target.world.snapshot;
  const window = testTiming<null>('repeat.snapshot');
  let reads = 0;
  const seen: TriggerOccurrence[] = [];
  target.on(window, {
    id: 'repeat',
    owner: 'a',
    times(ctx) {
      reads++;
      return ctx.world.player('a').hp;
    },
    eligible: () => true,
    run(ctx, _data, occurrence) {
      seen.push(occurrence);
      expect(Object.isFrozen(occurrence)).toBe(true);
      if (occurrence.index === 1)
        ctx.commit(
          testTiming('change-count'),
          [{ kind: 'vitality', player: 'a', hp: 2 }],
          occurrence,
        );
    },
  });
  await target.run('first', (ctx) => ctx.window(window, null));
  await target.run('second', (ctx) => ctx.window(window, null));
  expect(reads).toBe(2);
  expect(seen.map((o) => [o.index, o.total])).toEqual([
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [1, 2],
    [2, 2],
  ]);
  expect(new Set(seen.map((o) => o.id)).size).toBe(6);
  replay(target, initial);
});
it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, undefined, '2'])(
  '非法次数 %s 在任何效果执行前故障，不产生状态提交',
  async (times) => {
    const target = room();
    const initial = target.world.snapshot;
    const window = testTiming<null>('repeat.invalid');
    target.on(window, {
      id: 'bad',
      owner: 'a',
      times: () => times as number,
      eligible: () => true,
      run(ctx) {
        ctx.commit(testTiming('unexpected'), [], {});
      },
    });
    await expect(target.run('window', (ctx) => ctx.window(window, null))).rejects.toThrow(
      'nonnegative safe integer',
    );
    expect(target.world.snapshot).toEqual(initial);
    expect(target.history.facts()).toEqual([]);
  },
);
it.each(['commit', 'random', 'defer', 'unregister'] as const)(
  '次数函数在纯查询中执行，拒绝 %s',
  async (action) => {
    const target = room();
    const initial = target.world.snapshot;
    const window = testTiming<null>('repeat.pure');
    const remove = target.on(window, {
      id: 'other',
      owner: 'a',
      eligible: () => true,
      run: () => {},
    });
    target.on(window, {
      id: 'bad',
      owner: 'a',
      times(ctx) {
        if (action === 'commit') ctx.commit(testTiming('bad'), [], {});
        if (action === 'random') ctx.randomInt(2);
        if (action === 'defer') ctx.defer(() => {});
        if (action === 'unregister') remove();
        return 2;
      },
      eligible: () => true,
      run: () => {},
    });
    await expect(target.run('window', (ctx) => ctx.window(window, null))).rejects.toThrow(
      /Pure quer/,
    );
    expect(target.world.snapshot).toEqual(initial);
    expect(target.history.facts()).toEqual([]);
  },
);
it('零次不运行；同一效果十二次按数字顺序推进，不制造无意义的自选顺序', async () => {
  const target = room();
  const window = testTiming<null>('repeat.numeric');
  const seen: number[] = [];
  target.on(window, {
    id: 'none',
    owner: 'a',
    times: () => 0,
    eligible: () => true,
    run: () => {
      throw new Error('Zero occurrences must not execute.');
    },
  });
  target.on(window, {
    id: 'many',
    owner: 'a',
    times: () => 12,
    order: 'choose',
    eligible: () => true,
    run(_ctx, _data, occurrence) {
      seen.push(occurrence.index);
    },
  });
  await target.run('window', (ctx) => ctx.window(window, null));
  expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  expect(target.history.entries.filter((e) => e.type === 'decision.open')).toEqual([]);
});
it('两个效果只开放各自最早未处理次数，可交错而不能跳选本效果的后续次数', async () => {
  const target = room();
  const window = testTiming<null>('repeat.interleave');
  const seen: string[] = [];
  for (const [id, total] of [
    ['A', 2],
    ['B', 3],
  ] as const)
    target.on(window, {
      id,
      label: id,
      owner: 'a',
      times: () => total,
      order: 'choose',
      eligible: () => true,
      run(_ctx, _data, occurrence) {
        seen.push(`${id}${occurrence.index}`);
      },
    });
  const running = target.run('window', (ctx) => ctx.window(window, null));
  const first = await nextRequest(target);
  expect(target.decisions.submit(first.id, first.token, JSON.stringify(['B', 2]))).toMatchObject({
    kind: 'rejected',
    reason: 'invalid',
  });
  const initial = await order(target, 'B · 1/3');
  expect(Object.values(initial.occurrences).map((o) => o.index)).toEqual([1, 1]);
  await order(target, 'A · 1/2');
  await order(target, 'B · 2/3');
  await order(target, 'A · 2/2');
  await running;
  expect(seen).toEqual(['B1', 'A1', 'B2', 'A2', 'B3']);
  expect(candidates(target, 'running')).toHaveLength(5);
});
it('每组与座次优先于跨效果选择，自动项仍优先，重复次数不改变锚点', async () => {
  const target = room();
  const window = testTiming<null>('repeat.seats', ['before', 'main', 'after']);
  const seen: string[] = [];
  for (const [id, owner, group, times, order] of [
    ['before', 'a', 'before', 2, 'automatic'],
    ['global', null, 'main', 1, 'automatic'],
    ['b-auto', 'b', 'main', 2, 'automatic'],
    ['b-choice', 'b', 'main', 1, 'choose'],
    ['c', 'c', 'main', 1, 'automatic'],
    ['a', 'a', 'main', 1, 'automatic'],
    ['after', 'c', 'after', 1, 'automatic'],
  ] as const)
    target.on(window, {
      id,
      owner,
      group,
      times: () => times,
      order,
      eligible: () => true,
      run(_ctx, _data, o) {
        seen.push(`${id}${o.index}`);
      },
    });
  await target.run('window', (ctx) => ctx.window(window, null, { anchor: 'b' }));
  expect(seen).toEqual([
    'before1',
    'before2',
    'global1',
    'b-auto1',
    'b-auto2',
    'b-choice1',
    'c1',
    'a1',
    'after1',
  ]);
  expect(target.decisions.pending).toEqual([]);
});
it('后续次数只在轮到时检查资格，不在第一个后效改变状态之前提前跳过', async () => {
  const target = room();
  const initial = target.world.snapshot;
  const window = testTiming<null>('repeat.live');
  const seen: number[] = [];
  target.on(window, {
    id: 'repeat',
    owner: 'a',
    times: () => 2,
    eligible: (ctx, _data, o) => o.index === 1 || ctx.world.player('a').hp === 3,
    run(ctx, _data, o) {
      seen.push(o.index);
      if (o.index === 1)
        ctx.commit(testTiming('mark'), [{ kind: 'vitality', player: 'a', hp: 3 }], {});
    },
  });
  await target.run('window', (ctx) => ctx.window(window, null));
  expect(seen).toEqual([1, 2]);
  replay(target, initial);
});
it('拒绝当前次数不取消下一次；选择没有退回或重复执行', async () => {
  const target = room();
  const window = testTiming<null>('repeat.decline');
  const seen: number[] = [];
  target.on(window, {
    id: 'repeat',
    owner: 'a',
    times: () => 2,
    order: 'choose',
    eligible: () => true,
    async run(ctx, _data, o) {
      const result = await ctx.ask(choose(true));
      if (result.kind === 'chosen') seen.push(o.index);
    },
  });
  const running = target.run('window', (ctx) => ctx.window(window, null));
  await cancel(target);
  await answer(target, 'yes', 'option');
  await running;
  expect(seen).toEqual([2]);
  expect(candidates(target, 'running').map((e) => e.occurrence.index)).toEqual([1, 2]);
});
it('一次效果的子流程中止只消费该次数，既有提交保留且后续次数继续', async () => {
  const target = room();
  const initial = target.world.snapshot;
  const window = testTiming<null>('repeat.abort');
  target.on(window, {
    id: 'repeat',
    owner: 'a',
    times: () => 2,
    eligible: () => true,
    run(ctx, _data, o) {
      ctx.commit(testTiming('point'), [], o);
      if (o.index === 1) return ctx.abort('local');
    },
  });
  expect(await target.run('window', (ctx) => ctx.window(window, null))).toMatchObject({
    kind: 'resolved',
  });
  expect(
    target.history
      .facts(testTiming('point'))
      .map((f) => (f.data.detail as TriggerOccurrence).index),
  ).toEqual([1, 2]);
  replay(target, initial);
});
it('直接注册在第一次后注销，剩余次数全部失效，其他效果仍继续', async () => {
  const target = room();
  const window = testTiming<null>('repeat.unregister');
  const seen: string[] = [];
  const remove = target.on(window, {
    id: 'A',
    owner: 'a',
    times: () => 3,
    eligible: () => true,
    run() {
      seen.push('A');
      remove();
    },
  });
  target.on(window, {
    id: 'B',
    owner: 'a',
    eligible: () => true,
    run() {
      seen.push('B');
    },
  });
  await target.run('window', (ctx) => ctx.window(window, null));
  expect(seen).toEqual(['A', 'B']);
  expect(candidates(target, 'ineligible').map((e) => e.occurrence.index)).toEqual([2, 3]);
});
it('派生触发源被卸下后不再执行其剩余次数', async () => {
  const target = room();
  const window = testTiming<null>('repeat.source');
  let hits = 0;
  let detach = () => {};
  const provider: TriggerSource = {
    collect: () => [
      {
        id: 'source',
        owner: 'a',
        times: () => 3,
        eligible: () => true,
        run() {
          hits++;
          detach();
        },
      },
    ],
  };
  detach = target.addTriggerSource(provider);
  await target.run('window', (ctx) => ctx.window(window, null));
  expect(hits).toBe(1);
  expect(candidates(target, 'ineligible')).toHaveLength(2);
});
it('开窗期间新注册的重复效果从下一窗口参与，不扩展正在运行的快照', async () => {
  const target = room();
  const window = testTiming<null>('repeat.add');
  const seen: string[] = [];
  let added = false;
  target.on(window, {
    id: 'A',
    owner: 'a',
    times: () => 2,
    eligible: () => true,
    run(_ctx, _data, o) {
      seen.push(`A${o.index}`);
      if (!added) {
        added = true;
        target.on(window, {
          id: 'B',
          owner: 'a',
          times: () => 2,
          eligible: () => true,
          run(_ctx, _data, o) {
            seen.push(`B${o.index}`);
          },
        });
      }
    },
  });
  await target.run('one', (ctx) => ctx.window(window, null));
  expect(seen).toEqual(['A1', 'A2']);
  await target.run('two', (ctx) => ctx.window(window, null));
  expect(seen).toEqual(['A1', 'A2', 'A1', 'A2', 'B1', 'B2']);
});
it('嵌套同名窗口有独立次数和全局唯一 occurrence 身份，恢复后父窗口继续', async () => {
  const target = room();
  const window = testTiming<number>('repeat.nested');
  const seen: string[] = [];
  const ids: string[] = [];
  target.on(window, {
    id: 'repeat',
    owner: 'a',
    times: () => 2,
    eligible: () => true,
    async run(ctx, depth, o) {
      seen.push(`${depth}:${o.index}`);
      ids.push(o.id);
      if (depth === 0 && o.index === 1) await ctx.window(window, 1);
    },
  });
  await target.run('window', (ctx) => ctx.window(window, 0));
  expect(seen).toEqual(['0:1', '1:1', '1:2', '0:2']);
  expect(new Set(ids).size).toBe(4);
});
it('SDK 次数携带同一来源但独立身份，失去再获得技能不借新实例复活旧次数', async () => {
  const target = room();
  const initial = target.world.snapshot;
  const window = testTiming<null>('repeat.regain');
  const seen: { id: string; index: number }[] = [];
  let replaced = false;
  const book = new SkillBook([
    defineSkill({
      id: 'test:repeat',
      name: '重复',
      triggers: [
        on(window, {
          locked: true,
          id: 'effect',
          times: () => 2,
          async effect(ctx, _event, self, _value, o) {
            seen.push({ id: self.id, index: o.index });
            if (!replaced) {
              replaced = true;
              await book.revoke(ctx, 'a', self.skill, source);
              await book.grant(ctx, { owner: 'a', skill: self.skill, source });
            }
          },
        }),
      ],
    }),
  ]);
  book.attach(target);
  await target.run('grant', (ctx) => book.grant(ctx, { owner: 'a', skill: 'test:repeat', source }));
  await target.run('one', (ctx) => ctx.window(window, null));
  await target.run('two', (ctx) => ctx.window(window, null));
  expect(seen.map((o) => o.index)).toEqual([1, 1, 2]);
  expect(seen[0]!.id).not.toBe(seen[1]!.id);
  replay(target, initial);
});
it('重复生成的选择 ID 与直接注册 ID 冲突时，开窗立即报错而非执行错误效果', async () => {
  const target = room();
  const window = testTiming<null>('repeat.collide');
  for (const [id, times] of [
    ['A', () => 1],
    [JSON.stringify(['A', 1]), undefined],
  ] as const)
    target.on(window, {
      id,
      owner: 'a',
      ...(times ? { times } : {}),
      eligible: () => true,
      run() {
        throw new Error('Unexpected execution.');
      },
    });
  await expect(target.run('window', (ctx) => ctx.window(window, null))).rejects.toThrow(
    'Duplicate window occurrence ID',
  );
});

it('SDK when 能区分各次身份；跳过一次不会删除本效果的全部剩余次数', async () => {
  const target = room();
  const window = testTiming<null>('repeat.sdk-when');
  const seen: number[] = [];
  const book = new SkillBook([
    defineSkill({
      id: 'test:when',
      name: '逐次资格',
      triggers: [
        on(window, {
          locked: true,
          id: 'point',
          times: () => 3,
          when: (_ctx, _event, _self, o) => o.index !== 2,
          effect(_ctx, _event, _self, _value, o) {
            seen.push(o.index);
          },
        }),
      ],
    }),
  ]);
  book.attach(target);
  await target.run('grant', (ctx) => book.grant(ctx, { owner: 'a', skill: 'test:when', source }));
  await target.run('window', (ctx) => ctx.window(window, null));
  expect(seen).toEqual([1, 3]);
  expect(candidates(target, 'ineligible').map((e) => e.occurrence.index)).toEqual([2]);
});
it('拥有者在第一次中死亡，已经进入的普通代码可善后，剩余技能次数不复活', async () => {
  const window = testTiming<null>('repeat.death');
  const effect = defineSkill({
    id: 'test:death',
    name: '离场次数',
    triggers: [
      on(window, {
        locked: true,
        id: 'point',
        times: () => 3,
        async effect(ctx) {
          await die(ctx, 'a');
          ctx.commit(testTiming('entered-effect.finished'), [], {
            alive: ctx.world.player('a').alive,
          });
        },
      }),
    ],
  });
  const game = cardGame({ skills: [effect] });
  await grant(game, effect.id);
  await game.room.run('window', (ctx) => ctx.window(window, null));
  expect(
    game.room.history.facts(testTiming('entered-effect.finished')).map((f) => f.data.detail),
  ).toEqual([{ alive: false }]);
  expect(
    candidates(game.room, 'ineligible')
      .filter((e) => e.window === window.id)
      .map((e) => e.occurrence.index),
  ).toEqual([2, 3]);
  settled(game);
});
it('作用域监听完成后注销整个来源，后续窗口不保留任何次数', async () => {
  const target = room();
  const window = testTiming<null>('repeat.scoped');
  let count = 0;
  await target.run('host', async (ctx) => {
    ctx.defer(
      target.on(window, {
        id: 'scoped',
        owner: 'a',
        times: () => 2,
        eligible: () => true,
        run() {
          count++;
        },
      }),
    );
    await ctx.window(window, null);
  });
  await target.run('later', (ctx) => ctx.window(window, null));
  expect(count).toBe(2);
});
it('选择返回后仍重查来源，已注销次数记录为跳过并继续其他效果', async () => {
  const target = room();
  const window = testTiming<null>('repeat.selection-stale');
  const seen: string[] = [];
  const remove = target.on(window, {
    id: 'A',
    label: 'A',
    owner: 'a',
    times: () => 2,
    order: 'choose',
    eligible: () => true,
    run() {
      seen.push('A');
    },
  });
  target.on(window, {
    id: 'B',
    label: 'B',
    owner: 'a',
    order: 'choose',
    eligible: () => true,
    run() {
      seen.push('B');
    },
  });
  const running = target.run('window', (ctx) => ctx.window(window, null));
  await nextRequest(target);
  remove();
  await order(target, 'A · 1/2');
  await running;
  expect(seen).toEqual(['B']);
  expect(candidates(target, 'ineligible').map((e) => e.occurrence.index)).toEqual([1, 2]);
});

it('构造可选菜单不消费未选效果的失效前缀，其他效果可先令其较早次数合法', async () => {
  const target = room();
  const initial = target.world.snapshot;
  const window = testTiming<null>('repeat.defer');
  const seen: string[] = [];
  target.on(window, {
    id: 'A',
    label: 'A',
    owner: 'a',
    times: () => 2,
    order: 'choose',
    eligible: (ctx, _data, o) => o.index === 2 || ctx.world.player('a').hp === 3,
    run(_ctx, _data, o) {
      seen.push(`A${o.index}`);
    },
  });
  target.on(window, {
    id: 'B',
    label: 'B',
    owner: 'a',
    order: 'choose',
    eligible: () => true,
    run(ctx) {
      seen.push('B');
      ctx.commit(testTiming('enable-earlier'), [{ kind: 'vitality', player: 'a', hp: 3 }], {});
    },
  });
  const running = target.run('window', (ctx) => ctx.window(window, null));
  const request = await nextRequest(target);
  expect(Object.values((request.data as { labels: Record<string, string> }).labels)).toEqual([
    'A · 2/2',
    'B',
  ]);
  await order(target, 'B');
  await running;
  expect(seen).toEqual(['B', 'A1', 'A2']);
  expect(candidates(target, 'ineligible')).toEqual([]);
  replay(target, initial);
});

function scenario() {
  return cardGame({
    hands: { a: [] },
    draw: Array.from({ length: 14 }, (_, i) => card(`x${i}`, 'peach', i === 2 ? 'spade' : 'heart')),
    skills: standardGeneralSkills,
    effects: [luoyiAftereffect],
  });
}
it('两点伤害的遗计可以只执行一次后先刚烈，再继续第二次遗计', async () => {
  const game = scenario();
  await grant(game, 'standard:yiji');
  const yiji = game.room.world.snapshot.skills.find((skill) => skill.skill === 'standard:yiji')!;
  await grant(game, 'standard:ganglie');
  const running = game.room.run('damage', (ctx) =>
    damage(ctx, { from: 'b', to: 'a', amount: 2, nature: 'normal' }),
  );
  await order(game.room, '遗计 · 1/2');
  await answer(game.room, true);
  await cancel(game.room);
  await order(game.room, '刚烈');
  await answer(game.room, true);
  await answer(game.room, true);
  await cancel(game.room);
  await running;
  expect(game.room.world.player('a').hp).toBe(2);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.zone('a:hand').cards).toEqual(['x0', 'x1', 'x3', 'x4']);
  expect(
    game.room.history.facts(Skill.invoked).map((f) => (f.data.detail as { skill: string }).skill),
  ).toEqual(['standard:yiji', 'standard:ganglie', 'standard:yiji']);
  const points = candidates(game.room, 'running').filter((e) => e.window === 'damage.received');
  expect(
    points
      .filter((e) => e.source === JSON.stringify([yiji.id, e.window]))
      .map((e) => e.occurrence.index),
  ).toEqual([1, 2]);
  settled(game);
});
it('枭姬拒绝第一次后，能先连营再执行第二次；不会把两次发动封进一个循环', async () => {
  const game = cardGame({
    hands: { a: [card('last', 'slash')] },
    equipment: { a: [card('weapon', 'qinggang_sword'), card('armor', 'eight_diagram')] },
    draw: Array.from({ length: 8 }, (_, i) => card(`x${i}`, 'peach')),
    skills: standardGeneralSkills,
  });
  await grant(game, 'standard:xiaoji');
  const xiaoji = game.room.world.snapshot.skills.find(
    (skill) => skill.skill === 'standard:xiaoji',
  )!;
  await grant(game, 'standard:lianying');
  const running = game.room.run('lose', (ctx) =>
    moveCards(
      ctx,
      [
        { cards: ['weapon', 'armor'], from: 'a:equipment', to: 'discard', place: 'bottom' },
        { cards: ['last'], from: 'a:hand', to: 'discard', place: 'bottom' },
      ],
      'test',
    ),
  );
  await order(game.room, '枭姬 · 1/2');
  await answer(game.room, false);
  await order(game.room, '连营');
  await answer(game.room, true);
  await answer(game.room, true);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['x0', 'x1', 'x2']);
  expect(
    game.room.history.facts(Skill.invoked).map((f) => (f.data.detail as { skill: string }).skill),
  ).toEqual(['standard:lianying', 'standard:xiaoji']);
  const points = candidates(game.room, 'running').filter(
    (e) => e.source === JSON.stringify([xiaoji.id, e.window]),
  );
  expect(points.map((e) => [e.occurrence.index, e.occurrence.total])).toEqual([
    [1, 2],
    [2, 2],
  ]);
  settled(game);
});
it('遗计给空手伤害来源一张牌后，同一窗口原本不合资格的反馈可以发动', async () => {
  const game = scenario();
  await grant(game, 'standard:yiji');
  await grant(game, 'standard:fankui');
  const running = game.room.run('damage', (ctx) =>
    damage(ctx, { from: 'b', to: 'a', amount: 1, nature: 'normal' }),
  );
  // 反馈没有牌可拿，初次只有遗计，不弹出无意义的顺序选择。
  await answer(game.room, true);
  await answer(game.room, { cards: ['x0'], targets: ['b'] }, 'cards-targets');
  await cancel(game.room);
  const request = await nextRequest(game.room);
  const options = (request.data as { preview: { cards: { id: string }[] } }).preview.cards;
  expect(options).toHaveLength(1);
  await answer(game.room, { cards: [options[0]!.id], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.zone('b:hand').cards).toEqual([]);
  expect(game.room.world.zone('a:hand').cards).toEqual(['x1', 'x0']);
  expect(
    game.room.history.facts(Skill.invoked).map((f) => (f.data.detail as { skill: string }).skill),
  ).toEqual(['standard:yiji', 'standard:fankui']);
  settled(game);
});
it('零张阶段摸牌先发动英姿后，裸衣在同一窗口变为合法，角色可少摸这一张', async () => {
  const game = scenario();
  await grant(game, 'standard:yingzi');
  await grant(game, 'standard:luoyi');
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['draw'],
      body: async (at, phase) => {
        await draw(at, { player: 'a', count: 0, reason: 'test:zero-draw', phase });
      },
    }),
  );
  await answer(game.room, true);
  await answer(game.room, true);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual([]);
  const result = game.room.history.facts(Draw.completed)[0]!.data.detail;
  expect(result.edits.map((edit) => [edit.reason, edit.after])).toEqual([
    ['standard:yingzi', 1],
    ['standard:luoyi', 0],
  ]);
  expect(
    game.room.history.facts(Skill.invoked).map((f) => (f.data.detail as { skill: string }).skill),
  ).toEqual(['standard:yingzi', 'standard:luoyi']);
  settled(game);
});
it.each(['观星', '洛神'])(
  '观星与洛神同一准备时点可选择 %s 先执行，真实改变后续判定',
  async (first) => {
    const game = cardGame({
      hands: { a: [] },
      draw: Array.from({ length: 6 }, (_, i) =>
        card(`x${i}`, 'peach', i === 0 ? 'heart' : 'spade'),
      ),
      skills: standardGeneralSkills,
    });
    await grant(game, 'standard:guanxing');
    await grant(game, 'standard:luoshen');
    const running = game.room.run('prepare', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
    await order(game.room, first);
    await answer(game.room, true);
    if (first === '观星') {
      await answer(
        game.room,
        {
          groups: [
            { id: 'top', items: ['x1', 'x0'] },
            { id: 'bottom', items: ['x2', 'x3'] },
          ],
        },
        'arrange',
      );
      await answer(game.room, true);
      await answer(game.room, false);
    } else {
      await answer(game.room, true);
      await answer(
        game.room,
        {
          groups: [
            { id: 'top', items: ['x4'] },
            { id: 'bottom', items: ['x1', 'x2', 'x3'] },
          ],
        },
        'arrange',
      );
    }
    await running;
    expect(game.room.world.zone('a:hand').cards).toEqual(first === '观星' ? ['x1'] : []);
    expect(game.room.world.zone('draw').cards).toEqual(
      first === '观星' ? ['x0', 'x4', 'x5', 'x2', 'x3'] : ['x4', 'x5', 'x1', 'x2', 'x3'],
    );
    expect(
      game.room.history.facts(Skill.invoked).map((f) => (f.data.detail as { skill: string }).skill),
    ).toEqual(
      first === '观星'
        ? ['standard:guanxing', 'standard:luoshen']
        : ['standard:luoshen', 'standard:guanxing'],
    );
    settled(game);
  },
);
