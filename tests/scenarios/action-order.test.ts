import { expect, it } from 'vitest';
import { Room } from '../../src/core/runtime/room';
import {
  defineWindow,
  runTurn,
  runPhase,
  activeTurn,
  activeTarget,
  stateChange,
  kill,
  useDeclared,
  targetSpecifying,
  targetConfirming,
  targetSpecified,
  targetConfirmed,
  responseFinished,
  useFinished,
  judgmentFinished,
  judge,
  installRescue,
  loseHp,
  kingdomChange,
  installCounterspells,
  scheduleExtraTurn,
  finishGame,
} from '../../src/sdk';
import type { Context, WindowType, ActionAnchor, CardDefinition, UsePlanView } from '../../src/sdk';
import { RoleMatch } from '../../src/app/offline/role-match';
import { standardCards } from '../../src/content/standard/cards';
import { guicai } from '../../src/content/standard/strategists';
import { hujia } from '../../src/content/standard/commanders';
import { jijiang } from '../../src/content/standard/benevolence';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame } from '../fixtures/cards';
import { worldSeed, nextRequest } from '../fixtures/room';

const seats = ['a', 'b', 'c', 'd'];
const probe = defineWindow<string>('probe.action-order');
function generic(actionAnchor?: ActionAnchor) {
  const seed = worldSeed();
  return new Room({
    id: 'order',
    seed: 42,
    world: { ...seed, players: [...seed.players, { id: 'd', hp: 4, maxHp: 4, alive: true }] },
    ...(actionAnchor ? { actionAnchor } : {}),
  });
}
function observe<T>(
  room: Room,
  window: WindowType<T>,
  seen: string[],
  describe?: (owner: string, data: T) => string,
) {
  for (const owner of seats)
    room.on(window, {
      id: `${window.id}:${owner}`,
      owner,
      eligible: (ctx) => ctx.world.player(owner).alive,
      run: (_ctx, data) => {
        seen.push(describe?.(owner, data) ?? owner);
      },
    });
}
async function fire(ctx: Context, value: string, subject = 'c') {
  await ctx.window(probe, value, { subject });
}
async function answer(room: Room, value: unknown) {
  const request = await nextRequest(room);
  expect(room.decisions.submit(request.id, request.token, value)).toEqual({ kind: 'accepted' });
  return request;
}
const source = { kind: 'general', id: 'probe' } as const;
const death = { kind: 'rule', seq: null, data: null } as const;

it('通用内核没有回合知识：首席、主体回退和显式覆盖相互独立', async () => {
  const room = generic();
  const seen: string[] = [];
  observe(room, probe, seen);
  await room.run('core', async (ctx) => {
    await ctx.window(probe, 'first');
    await ctx.window(probe, 'subject', { subject: 'c' });
    await ctx.window(probe, 'explicit', { subject: 'c', anchor: 'd' });
    const order = ctx.query(() => ctx.actionOrder('b'));
    expect(order).toEqual(['b', 'c', 'd', 'a']);
    expect(Object.isFrozen(order)).toBe(true);
  });
  expect(seen).toEqual([...seats, 'c', 'd', 'a', 'b', 'd', 'a', 'b', 'c']);
});

it('模式政策优先于主体，特殊规则显式覆盖时不调用模式政策', async () => {
  let calls = 0;
  const room = generic(() => {
    calls++;
    return 'b';
  });
  const seen: string[] = [];
  observe(room, probe, seen);
  await room.run('mode', async (ctx) => {
    await ctx.window(probe, 'mode', { subject: 'd' });
    await ctx.window(probe, 'explicit', { subject: 'a', anchor: 'c' });
  });
  expect(calls).toBe(1);
  expect(seen).toEqual(['b', 'c', 'd', 'a', 'c', 'd', 'a', 'b']);
  expect(
    room.history.entries
      .filter((entry) => entry.type === 'window.order')
      .map((entry) => entry.data),
  ).toEqual([
    { window: probe.id, subject: 'd', anchor: 'b', override: false },
    { window: probe.id, subject: 'a', anchor: 'c', override: true },
  ]);
});

it('显式覆盖无需运行一个会报错的默认政策', async () => {
  const room = generic(() => {
    throw new Error('must not run');
  });
  const seen: string[] = [];
  observe(room, probe, seen);
  await room.run('override', (ctx) => ctx.window(probe, '', { anchor: 'c' }));
  expect(seen).toEqual(['c', 'd', 'a', 'b']);
  expect(room.status).toBe('ready');
});

it('模式回调直接收到主体，可用普通代码选择起点，不必从历史反推事件参与者', async () => {
  const subjects: (string | null)[] = [];
  const room = generic((_ctx, subject) => {
    subjects.push(subject);
    return subject === 'c' ? 'd' : null;
  });
  const seen: string[] = [];
  observe(room, probe, seen);
  await room.run('policy', async (ctx) => {
    await ctx.window(probe, '', { subject: 'c' });
    await ctx.window(probe, '', { subject: 'b' });
  });
  expect(subjects).toEqual(['c', 'b']);
  expect(seen).toEqual(['d', 'a', 'b', 'c', 'b', 'c', 'd', 'a']);
});

it('每个窗口只取一次政策快照，嵌套窗口可以使用新的政策结果', async () => {
  let anchor = 'b';
  let calls = 0;
  const room = generic(() => {
    calls++;
    return anchor;
  });
  const inner = defineWindow<string>('probe.inner-order');
  const seen: string[] = [];
  observe(room, inner, seen, (owner) => `inner:${owner}`);
  for (const owner of seats)
    room.on(probe, {
      id: `outer:${owner}`,
      owner,
      eligible: () => true,
      async run(ctx) {
        seen.push(`outer:${owner}`);
        if (owner === 'b') {
          anchor = 'd';
          await ctx.window(inner, '');
        }
      },
    });
  await room.run('snapshot', (ctx) => fire(ctx, ''));
  expect(calls).toBe(2);
  expect(seen).toEqual([
    'outer:b',
    'inner:d',
    'inner:a',
    'inner:b',
    'inner:c',
    'outer:c',
    'outer:d',
    'outer:a',
  ]);
});

it('调用参数冻结为窗口描述，不被政策闭包改写原对象后伪造主体', async () => {
  const options = { subject: 'b' };
  const room = generic(() => {
    options.subject = 'd';
    return null;
  });
  const seen: string[] = [];
  observe(room, probe, seen);
  await room.run('snapshot', (ctx) => ctx.window(probe, '', options));
  expect(options.subject).toBe('d');
  expect(seen).toEqual(['b', 'c', 'd', 'a']);
  expect(room.history.entries.find((entry) => entry.type === 'window.order')?.data).toMatchObject({
    subject: 'b',
    anchor: 'b',
  });
});

for (const bad of ['missing', undefined, 1]) {
  it(`非法政策结果 ${String(bad)} 在触发前报错，不偷偷回退`, async () => {
    const room = generic((() => bad) as ActionAnchor);
    const seen: string[] = [];
    observe(room, probe, seen);
    await expect(room.run('bad', (ctx) => fire(ctx, ''))).rejects.toThrow(
      'Unknown action-order anchor',
    );
    expect(seen).toEqual([]);
    expect(room.history.entries.filter((entry) => entry.type === 'fault')).toHaveLength(1);
  });
}

it('政策是纯查询，不能借取行动序提交事实', async () => {
  const room = generic((ctx) => {
    ctx.commit('illegal', [], {});
    return 'b';
  });
  await expect(room.run('bad', (ctx) => fire(ctx, ''))).rejects.toThrow('Pure queries');
  expect(room.history.facts('illegal')).toHaveLength(0);
});

it('未知主体即使被显式覆盖也拒绝，避免窗口描述与已知席位矛盾', async () => {
  const room = generic();
  await expect(
    room.run('bad', (ctx) => ctx.window(probe, '', { subject: 'missing', anchor: 'b' })),
  ).rejects.toThrow('Unknown action-order subject');
});

it('组优先级与无主系统规则保留；模式只决定各组内部玩家顺序', async () => {
  const room = generic(() => 'c');
  const groups = ['before', 'main'];
  let groupReads = 0;
  Object.defineProperty(groups, '0', {
    get: () => (++groupReads === 1 ? 'before' : 'main'),
  });
  const window = defineWindow<null>('probe.groups-order', groups);
  expect(groupReads).toBe(1);
  groups[1] = 'before';
  expect(() => defineWindow('bad.groups', new Array<string>(1))).toThrow(
    'Window requires an ID and distinct named groups.',
  );
  const seen: string[] = [];
  room.on(window, {
    id: 'system',
    owner: null,
    group: 'main',
    eligible: () => true,
    run: () => {
      seen.push('system');
    },
  });
  for (const group of ['before', 'main'])
    for (const owner of seats)
      room.on(window, {
        id: `${group}:${owner}`,
        owner,
        group,
        eligible: () => true,
        run: () => {
          seen.push(`${group}:${owner}`);
        },
      });
  await room.run('groups', (ctx) => ctx.window(window, null));
  expect(seen).toEqual([
    'before:c',
    'before:d',
    'before:a',
    'before:b',
    'system',
    'main:c',
    'main:d',
    'main:a',
    'main:b',
  ]);
});

it('两个 Room 的模式与行动序互不污染', async () => {
  const one = generic(() => 'b');
  const two = generic(() => 'd');
  const first: string[] = [],
    second: string[] = [];
  observe(one, probe, first);
  observe(two, probe, second);
  await Promise.all([
    one.run('one', (ctx) => fire(ctx, '')),
    two.run('two', (ctx) => fire(ctx, '')),
  ]);
  expect(first).toEqual(['b', 'c', 'd', 'a']);
  expect(second).toEqual(['d', 'a', 'b', 'c']);
});

it('标准模式：活动 b 回合优先于 c 主体，回合结束后恢复 c 回退', async () => {
  const game = cardGame();
  const seen: string[] = [];
  observe(game.room, probe, seen, (owner, name) => `${name}:${owner}`);
  await game.room.run('host', async (ctx) => {
    await runTurn(ctx, game.book, 'b', { phases: ['play'], body: (at) => fire(at, 'turn') });
    await fire(ctx, 'outside');
  });
  expect(seen).toEqual([
    'turn:b',
    'turn:c',
    'turn:d',
    'turn:a',
    'outside:c',
    'outside:d',
    'outside:a',
    'outside:b',
  ]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('标准活动回合内，作者显式指定 d 起点仍可覆盖默认 b 政策', async () => {
  const game = cardGame();
  const seen: string[] = [];
  observe(game.room, probe, seen);
  await game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'b', {
      phases: ['play'],
      async body(at) {
        await at.window(probe, '', { subject: 'c', anchor: 'd' });
      },
    }),
  );
  expect(seen).toEqual(['d', 'a', 'b', 'c']);
});

for (const abortInner of [false, true]) {
  it(`嵌套 d 回合${abortInner ? '阶段局部中止' : '正常结束'}后，外层 b 回合的政策恢复`, async () => {
    const game = cardGame();
    const seen: string[] = [];
    observe(game.room, probe, seen, (owner, name) => `${name}:${owner}`);
    await game.room.run('host', (ctx) =>
      runTurn(ctx, game.book, 'b', {
        phases: ['play'],
        async body(at) {
          await fire(at, 'before');
          await runTurn(at, game.book, 'd', {
            phases: ['play'],
            async body(inner) {
              await fire(inner, 'inner');
              if (abortInner) inner.abort('local inner phase');
            },
          });
          await fire(at, 'after');
        },
      }),
    );
    expect(seen).toEqual([
      'before:b',
      'before:c',
      'before:d',
      'before:a',
      'inner:d',
      'inner:a',
      'inner:b',
      'inner:c',
      'after:b',
      'after:c',
      'after:d',
      'after:a',
    ]);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  });
}

it('额外回合由真实 d 拥有者决定行动序，不继承正常轮转或事件主体', async () => {
  const game = cardGame();
  const seen: string[] = [];
  observe(game.room, probe, seen);
  await game.room.run('extra', (ctx) =>
    runTurn(ctx, game.book, 'd', {
      origin: { kind: 'extra', id: 'probe:extra', reason: 'probe' },
      phases: ['play'],
      body: (at) => fire(at, ''),
    }),
  );
  expect(seen).toEqual(['d', 'a', 'b', 'c']);
});

it('当前回合角色死亡后保留其席位起点，其他角色按后续座次参与', async () => {
  const game = cardGame({ hands: { a: [] } });
  const seen: string[] = [];
  observe(game.room, probe, seen);
  await game.room.run('death', (ctx) =>
    runTurn(ctx, game.book, 'b', {
      phases: ['play'],
      async body(at) {
        await kill(at, { player: 'b', killer: null, cause: death, reason: 'rule' });
        await fire(at, '', 'a');
      },
    }),
  );
  expect(seen).toEqual(['c', 'd', 'a']);
  const trace = game.room.history.entries.find(
    (entry) =>
      entry.type === 'window.order' && (entry.data as { window: string }).window === probe.id,
  );
  expect(trace?.data).toMatchObject({ subject: 'a', anchor: 'b' });
});

it('孤立阶段不冒充回合，重建事实里的旧回合 ID 也不冒充当前调用路径', async () => {
  const game = cardGame();
  const seen: string[] = [];
  observe(game.room, probe, seen);
  await game.room.run('stale', async (ctx) => {
    ctx.commit(
      'stale-turn',
      [
        stateChange(ctx, activeTurn, activeTarget, {
          id: 'old:not-an-ancestor',
          owner: 'd',
          origin: { kind: 'normal' },
        }),
      ],
      {},
    );
    await runPhase(ctx, game.book, 'a', 'play', (at) => fire(at, ''));
  });
  expect(seen).toEqual(['c', 'd', 'a', 'b']);
});

for (const custom of [false, true]) {
  it(`RoleMatch ${custom ? '自定义 c 政策' : '默认标准政策'}实际传入主持内核`, async () => {
    const match = new RoleMatch({
      id: 'mode',
      seed: 42,
      players: seats.map((id) => ({ id })),
      deck: [],
      content: {
        cards: standardCards,
      },
      ...(custom ? { actionAnchor: () => 'c' } : {}),
    });
    const seen: string[] = [];
    observe(match.room, probe, seen);
    await match.room.run('turn', (ctx) =>
      runTurn(ctx, match.book, 'b', { phases: ['play'], body: (at) => fire(at, '', 'd') }),
    );
    expect(seen).toEqual(custom ? ['c', 'd', 'a', 'b'] : ['b', 'c', 'd', 'a']);
  });
}

const orderCard: CardDefinition = {
  id: 'probe:order-card',
  type: 'trick',
  label: '顺序探针',
  use: { count: { min: 1, max: 4 }, target: () => true, resolve: () => {} },
};
function orderIntent(targets: readonly string[]) {
  return {
    actor: 'd',
    choice: { kind: 'generated', face: { name: orderCard.id }, materials: [], reason: 'probe' },
    targets,
    timing: { kind: 'effect' },
  } as const;
}

it('b 回合由 d 用多目标牌：四层遍历与实际生效按模式排序，牌面与来源不改写', async () => {
  const resolved: string[] = [],
    stages: string[] = [];
  const game = cardGame({
    definitions: [
      {
        ...orderCard,
        use: {
          ...orderCard.use!,
          resolve: (_ctx, { effect }) => {
            resolved.push(effect.target);
          },
        },
      },
    ],
  });
  for (const window of [targetSpecifying, targetConfirming, targetSpecified, targetConfirmed])
    game.room.on(window, {
      id: window.id,
      owner: null,
      eligible: () => true,
      run: (ctx, { use, effect }) => {
        stages.push(`${window.id}:${effect.target}`);
        expect(use.actionOrder).toEqual(['b', 'c', 'd', 'a']);
        expect(ctx.actionOrder(effect.target)).toEqual(use.actionOrder);
      },
    });
  await game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'b', {
      phases: ['play'],
      async body(at) {
        const result = await game.book.use(at, orderIntent(['a', 'd', 'c']));
        expect(result).toMatchObject({
          kind: 'used',
          use: {
            actor: 'd',
            actionOrder: ['b', 'c', 'd', 'a'],
            effects: [{ target: 'c' }, { target: 'd' }, { target: 'a' }],
          },
        });
      },
    }),
  );
  expect(resolved).toEqual(['c', 'd', 'a']);
  expect(stages).toEqual(
    [targetSpecifying, targetConfirming, targetSpecified, targetConfirmed].flatMap((window) =>
      ['c', 'd', 'a'].map((target) => `${window.id}:${target}`),
    ),
  );
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('确认中追加更早的 b 身份：按冻结行动序补齐时点，不重放已经确认的 c', async () => {
  const resolved: string[] = [],
    stages: string[] = [];
  const game = cardGame({
    definitions: [
      {
        ...orderCard,
        use: {
          ...orderCard.use!,
          resolve: (_ctx, { effect }) => {
            resolved.push(effect.target);
          },
        },
      },
    ],
  });
  for (const window of [targetSpecifying, targetConfirming, targetSpecified, targetConfirmed])
    game.room.on(window, {
      id: window.id,
      owner: null,
      eligible: () => true,
      run(ctx, { use, effect }) {
        stages.push(`${window.id}:${effect.target}`);
        if (window === targetConfirming && effect.target === 'c') use.addTarget(ctx, 'b', 'probe');
      },
    });
  await game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'b', {
      phases: ['play'],
      async body(at) {
        await game.book.use(at, orderIntent(['c']));
      },
    }),
  );
  expect(stages).toEqual([
    'target.specifying:c',
    'target.confirming:c',
    'target.specifying:b',
    'target.confirming:b',
    'target.specified:b',
    'target.specified:c',
    'target.confirmed:b',
    'target.confirmed:c',
  ]);
  expect(resolved).toEqual(['b', 'c']);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('嵌套 a 回合创建新牌序；向外层牌追加目标仍使用外层 b 宣告快照', async () => {
  const resolved: string[] = [];
  let outer: UsePlanView | null = null;
  const innerCard: CardDefinition = {
    ...orderCard,
    id: 'probe:inner-card',
    use: {
      ...orderCard.use!,
      resolve: (_ctx, { effect }) => {
        resolved.push(`inner:${effect.target}`);
      },
    },
  };
  const outerCard: CardDefinition = {
    ...orderCard,
    use: {
      ...orderCard.use!,
      async resolve(ctx, { effect, book }) {
        resolved.push(`outer:${effect.target}`);
        if (effect.target !== 'c') return;
        await runTurn(ctx, book, 'a', {
          phases: ['play'],
          async body(at) {
            expect(outer!.actionOrder).toEqual(['b', 'c', 'd', 'a']);
            outer!.addTarget(at, 'b', 'probe');
            const intent = orderIntent(['c', 'b']);
            const result = await book.use(at, {
              ...intent,
              choice: { ...intent.choice, face: { name: innerCard.id } },
            });
            expect(result).toMatchObject({
              kind: 'used',
              use: { actionOrder: ['a', 'b', 'c', 'd'] },
            });
          },
        });
      },
    },
  };
  const game = cardGame({ definitions: [outerCard, innerCard] });
  game.room.on(useDeclared, {
    id: 'capture',
    owner: null,
    eligible: (_ctx, use) => use.card.name === orderCard.id,
    run: (_ctx, use) => {
      outer = use;
    },
  });
  await game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'b', {
      phases: ['play'],
      async body(at) {
        await game.book.use(at, orderIntent(['a', 'c']));
      },
    }),
  );
  expect(resolved).toEqual(['outer:c', 'inner:b', 'inner:c', 'outer:b', 'outer:a']);
  expect(outer!.snapshot().actionOrder).toEqual(['b', 'c', 'd', 'a']);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('b 回合由 a 用杀、c 实际使用闪：使用完成按 b 排序，实际使用者仍记录为 c', async () => {
  const game = cardGame({ hands: { a: [card('s', 'slash')], c: [card('j', 'jink')] } });
  const seen: string[] = [];
  observe(game.room, useFinished, seen);
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'b', {
      phases: ['play'],
      async body(at) {
        await game.book.use(at, {
          actor: 'a',
          choice: { kind: 'physical', card: 's' },
          targets: ['c'],
          timing: { kind: 'effect', ignoreDistance: true },
        });
      },
    }),
  );
  const request = await answer(game.room, { kind: 'physical', card: 'j' });
  expect(request.player).toBe('c');
  await running;
  expect(seen).toEqual(['b', 'c', 'd', 'a', 'b', 'c', 'd', 'a']);
  expect(game.room.history.facts('card.used')[1]?.data.detail).toMatchObject({
    actor: 'c',
    declaration: { context: { kind: 'response', to: { target: 'c' } } },
  });
  const trace = game.room.history.entries.find(
    (entry) =>
      entry.type === 'window.order' && (entry.data as { window: string }).window === useFinished.id,
  );
  expect(trace?.data).toMatchObject({ subject: 'c', anchor: 'b' });
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('b 回合 c 为 d 鬼才：判定结束与打出完成都按 b 排序，两个领域主体分别保留', async () => {
  const game = cardGame({
    hands: { a: [], c: [card('replacement', 'peach', 'heart')] },
    draw: [card('top', 'slash')],
    skills: [guicai],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'c', skill: 'standard:guicai', source }),
  );
  const responses: string[] = [],
    judgments: string[] = [];
  observe(game.room, responseFinished, responses);
  observe(game.room, judgmentFinished, judgments);
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'b', {
      phases: ['play'],
      async body(at) {
        const result = await judge(at, game.book, {
          player: 'd',
          reason: 'probe',
          match: (_at, card) => card.suit === 'heart',
        });
        expect(result).toMatchObject({ kind: 'judged', player: 'd', matched: true });
      },
    }),
  );
  await answer(game.room, { cards: ['replacement'], targets: [] });
  await running;
  expect(responses).toEqual(['b', 'c', 'd', 'a']);
  expect(judgments).toEqual(['b', 'c', 'd', 'a']);
  const traces = game.room.history.entries
    .filter((entry) => entry.type === 'window.order')
    .map((entry) => entry.data);
  expect(traces).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ window: responseFinished.id, subject: 'c', anchor: 'b' }),
      expect.objectContaining({ window: judgmentFinished.id, subject: 'd', anchor: 'b' }),
    ]),
  );
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

for (const custom of [false, true]) {
  it(`反制询问使用${custom ? '自定义 c 政策' : '当前 b 回合'}，与窗口共享行动序`, async () => {
    const game = cardGame({
      hands: {
        a: [card('trick', 'ex_nihilo')],
        b: [card('nb', 'nullification')],
        c: [card('nc', 'nullification')],
      },
      draw: [card('draw1', 'slash'), card('draw2', 'slash')],
      ...(custom ? { actionAnchor: () => 'c' } : {}),
    });
    installCounterspells(game.room, game.book);
    const running = game.room.run('turn', (ctx) =>
      runTurn(ctx, game.book, 'b', {
        phases: ['play'],
        async body(at) {
          await game.book.use(at, {
            actor: 'a',
            choice: { kind: 'physical', card: 'trick' },
            targets: ['a'],
            timing: { kind: 'effect' },
          });
        },
      }),
    );
    const asked: string[] = [];
    for (let i = 0; i < 2; i++) {
      const request = await nextRequest(game.room);
      asked.push(request.player);
      expect(game.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
    }
    await running;
    expect(asked).toEqual(custom ? ['c', 'b'] : ['b', 'c']);
    expect(game.room.world.zone('a:hand').cards).toHaveLength(2);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  });

  it(`救援询问使用${custom ? '自定义 c 政策' : '当前 b 回合'}，不私自读取另一个回合政策`, async () => {
    const game = cardGame({
      hands: { a: [], b: [card('pb', 'peach', 'heart')], c: [card('pc', 'peach', 'heart')] },
      ...(custom ? { actionAnchor: () => 'c' } : {}),
    });
    installRescue(game.room, game.book);
    const running = game.room.run('turn', (ctx) =>
      runTurn(ctx, game.book, 'b', {
        phases: ['play'],
        async body(at) {
          await loseHp(at, { player: 'a', amount: 4, reason: 'probe' });
        },
      }),
    );
    const asked: string[] = [];
    for (let i = 0; i < 2; i++) {
      const request = await nextRequest(game.room);
      asked.push(request.player);
      expect(game.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
    }
    await running;
    expect(asked).toEqual(custom ? ['c', 'b'] : ['b', 'c']);
    expect(game.room.world.player('a').alive).toBe(false);
    expect(game.room.history.facts('card.used')).toHaveLength(0);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  });

  it(`护驾依${custom ? '自定义 d' : '当前 b'}行动序请求魏角色，默认与模式覆盖都生效`, async () => {
    const game = cardGame({
      hands: { a: [], b: [card('jb', 'jink')], c: [card('s', 'slash')], d: [card('jd', 'jink')] },
      skills: [hujia],
      ...(custom ? { actionAnchor: () => 'd' } : {}),
    });
    await game.room.run('grant', async (ctx) => {
      ctx.commit('kingdoms', [kingdomChange(ctx, 'b', '魏'), kingdomChange(ctx, 'd', '魏')], {});
      await game.skills.grant(ctx, { owner: 'a', skill: hujia.id, source });
    });
    const running = game.room.run('turn', (ctx) =>
      runTurn(ctx, game.book, 'b', {
        phases: ['play'],
        async body(at) {
          await game.book.use(at, {
            actor: 'c',
            choice: { kind: 'physical', card: 's' },
            targets: ['a'],
            timing: { kind: 'effect', ignoreDistance: true },
          });
        },
      }),
    );
    const invoked = await answer(game.room, true);
    expect(invoked.player).toBe('a');
    const asked: string[] = [];
    for (let i = 0; i < 2; i++) {
      const request = await nextRequest(game.room);
      asked.push(request.player);
      expect(game.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
    }
    await running;
    expect(asked).toEqual(custom ? ['d', 'b'] : ['b', 'd']);
    expect(game.room.world.player('a').hp).toBe(3);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  });

  it(`激将依${custom ? '自定义 d' : '当前 b'}行动序供杀，真实打出者与使用者各自保留`, async () => {
    const game = cardGame({
      hands: { a: [], b: [card('sb', 'slash')], d: [card('sd', 'slash')] },
      skills: [jijiang],
      ...(custom ? { actionAnchor: () => 'd' } : {}),
    });
    const granted = await game.room.run('grant', async (ctx) => {
      ctx.commit('kingdoms', [kingdomChange(ctx, 'b', '蜀'), kingdomChange(ctx, 'd', '蜀')], {});
      return await game.skills.grant(ctx, { owner: 'a', skill: jijiang.id, source });
    });
    if (granted.kind !== 'resolved') throw new Error('Grant must resolve.');
    const instance = game.room.world.snapshot.skills.find(
      (entry) => entry.skill === jijiang.id,
    )!.id;
    const running = game.room.run('turn', (ctx) =>
      runTurn(ctx, game.book, 'b', {
        phases: ['play'],
        async body(at) {
          const result = await game.book.use(at, {
            actor: 'a',
            choice: { kind: 'viewAs', instance, recipe: 'ask-slash', materials: [] },
            targets: ['c'],
            timing: { kind: 'effect', ignoreDistance: true },
          });
          expect(result).toMatchObject({
            kind: 'used',
            use: { actor: 'a', card: { source: { origin: { actor: custom ? 'd' : 'b' } } } },
          });
        },
      }),
    );
    const supplied = await answer(game.room, { kind: 'physical', card: custom ? 'sd' : 'sb' });
    expect(supplied.player).toBe(custom ? 'd' : 'b');
    await running;
    expect(game.room.world.player('c').hp).toBe(3);
    expect(game.room.history.facts('card.responded')[0]?.data.detail).toMatchObject({
      actor: custom ? 'd' : 'b',
    });
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  });
}

it('真实身份局调度插入 d 额外回合后恢复 b 正常轮转，窗口均使用当次真实回合角色', async () => {
  const seen: string[] = [],
    turns: string[] = [];
  const match = new RoleMatch({
    id: 'extra-order',
    seed: 42,
    players: seats.map((id) => ({ id })),
    roles: ['lord', 'loyalist', 'rebel', 'renegade'],
    deck: [],
    content: {
      cards: standardCards,
    },
    async phaseBody(ctx, phase) {
      if (phase.kind !== 'play') return;
      turns.push(phase.owner);
      await fire(ctx, phase.owner, 'c');
      if (turns.length === 1)
        scheduleExtraTurn(ctx, { owner: 'd', reason: 'probe', phases: ['play'] });
      if (turns.length === 3) await finishGame(ctx, { winners: ['a'], reason: 'probe complete' });
    },
  });
  observe(match.room, probe, seen, (owner, turn) => `${turn}:${owner}`);
  const running = match.start();
  for (let i = 0; i < 3; i++) {
    const request = await nextRequest(match.room);
    expect(request.kind).toBe('seat-ready');
    expect(match.room.decisions.submit(request.id, request.token, true)).toEqual({
      kind: 'accepted',
    });
  }
  expect(await running).toMatchObject({ kind: 'resolved' });
  expect(turns).toEqual(['a', 'd', 'b']);
  expect(seen).toEqual([
    'a:a',
    'a:b',
    'a:c',
    'a:d',
    'd:d',
    'd:a',
    'd:b',
    'd:c',
    'b:b',
    'b:c',
    'b:d',
    'b:a',
  ]);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
});

it('真实五谷在 b 回合由 d 使用：共享牌池按 b、c、d、a 依次分配', async () => {
  const game = cardGame({
    hands: { a: [], b: [], c: [], d: [card('grace', 'amazing_grace')] },
    draw: [1, 2, 3, 4].map((i) => card(`pool${i}`, 'slash')),
  });
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'b', {
      phases: ['play'],
      async body(at) {
        const result = await game.book.use(at, {
          actor: 'd',
          choice: { kind: 'physical', card: 'grace' },
          targets: [],
          timing: { kind: 'effect' },
        });
        expect(result).toMatchObject({
          kind: 'used',
          use: {
            actionOrder: ['b', 'c', 'd', 'a'],
            effects: [{ target: 'b' }, { target: 'c' }, { target: 'd' }, { target: 'a' }],
          },
        });
      },
    }),
  );
  for (const [i, owner] of ['b', 'c', 'd', 'a'].entries()) {
    const request = await answer(game.room, { cards: [`pool${i + 1}`], targets: [] });
    expect(request.player).toBe(owner);
  }
  await running;
  for (const [i, owner] of ['b', 'c', 'd', 'a'].entries())
    expect(game.room.world.position(`pool${i + 1}`)).toBe(`${owner}:hand`);
  expect(game.room.world.position('grace')).toBe('discard');
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});
