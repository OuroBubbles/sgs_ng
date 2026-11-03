import { testTiming } from '../fixtures/timing';
import { expect, it } from 'vitest';
import {
  activeOffers,
  cardQueries,
  defineSkill,
  draw,
  invoke,
  modify,
  on,
  ownedCards,
  pay,
  runPhase,
  SkillBook,
} from '../../src/sdk';
import type { Context, SkillDefinition, SkillHandle, SkillProvider } from '../../src/sdk';
import type { TriggerSource } from '../../src/core/runtime/event';
import { card, cardGame } from '../fixtures/cards';
import { nextRequest, room } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';

const window = testTiming<null>('probe.provider-lifecycle');
const source: SkillHandle = {
  id: 'probe:provider-source',
  owner: 'a',
  skill: 'probe:provider',
  name: '派生来源',
  origin: { kind: 'effect', id: 'provider' },
  active: () => true,
};

function rebuilt(game: ReturnType<typeof cardGame>) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.decisions.pending).toEqual([]);
}

it('卸载 Provider 后不执行剩余次数', async () => {
  let remove: (ctx?: Context) => void;
  const seen: number[] = [];
  const definition = defineSkill({
    id: source.skill,
    name: source.name,
    triggers: [
      on(window, {
        locked: true,
        id: 'repeat',
        times: () => 3,
        effect(ctx, _event, _self, _value, occurrence) {
          seen.push(occurrence.index);
          ctx.commit('probe.provider', [], occurrence);
          remove(ctx);
        },
      }),
    ],
  });
  const game = cardGame();
  await game.room.run('install', async (ctx) => {
    remove = game.skills.addProvider({ collect: () => [{ self: source, definition }] }, ctx);
    await ctx.window(window, null);
  });
  expect(seen).toEqual([1]);
  expect(game.room.history.facts('probe.provider')).toHaveLength(1);
  rebuilt(game);
});

it('底层 TriggerSource 重新挂接也不复活原窗口，旧卸载函数只属于原登记', async () => {
  const target = room();
  const initial = target.world.snapshot;
  let remove: () => void;
  let replaced = false;
  const seen: number[] = [];
  const provider: TriggerSource = {
    collect: () => [
      {
        id: 'repeat',
        owner: 'a',
        times: () => 3,
        eligible: () => true,
        run(_ctx, _event, occurrence) {
          seen.push(occurrence.index);
          if (!replaced) {
            replaced = true;
            const oldRemove = remove;
            oldRemove();
            remove = target.addTriggerSource(provider);
            oldRemove();
          }
        },
      },
    ],
  };
  remove = target.addTriggerSource(provider);
  await target.run('first', (ctx) => ctx.window(window, null));
  expect(seen).toEqual([1]);
  await target.run('second', (ctx) => ctx.window(window, null));
  expect(seen).toEqual([1, 1, 2, 3]);
  remove();
  expect(rebuildWorld(initial, target.history.facts())).toEqual(target.world.snapshot);
});

it('SkillBook 重新挂接不复活原窗口，旧 detach 不破坏新挂接的运行期上下文', async () => {
  const target = room();
  const book = new SkillBook();
  let detach: () => void;
  let replaced = false;
  const seen: number[] = [];
  const definition = defineSkill({
    id: source.skill,
    name: source.name,
    triggers: [
      on(window, {
        locked: true,
        id: 'repeat',
        times: () => 3,
        effect(_ctx, _event, _self, _value, occurrence) {
          seen.push(occurrence.index);
          if (!replaced) {
            replaced = true;
            const oldDetach = detach;
            oldDetach();
            detach = book.attach(target);
            oldDetach();
          }
        },
      }),
    ],
  });
  book.addProvider({ collect: () => [{ self: source, definition }] });
  detach = book.attach(target);
  await target.run('first', (ctx) => ctx.window(window, null));
  expect(seen).toEqual([1]);
  await target.run('second', async (ctx) => {
    book.addProvider({ collect: () => [] }, ctx)(ctx);
    await ctx.window(window, null);
  });
  expect(seen).toEqual([1, 1, 2, 3]);
  detach();
});

it('顺序选择返回后重查 Provider 登记，旧选项被跳过且不影响其他来源', async () => {
  let at: Context;
  let remove: (ctx?: Context) => void;
  const seen: string[] = [];
  const definition = defineSkill({
    id: source.skill,
    name: source.name,
    triggers: [
      on(window, {
        id: 'choose',

        effect() {
          seen.push('A');
        },
      }),
    ],
  });
  const provider: SkillProvider = { collect: () => [{ self: source, definition }] };
  const game = cardGame();
  game.room.on(window, {
    id: 'other',
    label: 'B',
    owner: 'a',
    order: 'choose',
    eligible: () => true,
    run() {
      seen.push('B');
    },
  });
  const running = game.room.run('windows', async (ctx) => {
    at = ctx;
    remove = game.skills.addProvider(provider, ctx);
    await ctx.window(window, null);
    await ctx.window(window, null);
    remove(ctx);
  });
  const first = await nextRequest(game.room);
  expect(first.kind).toBe('trigger-order');
  const data = first.data as { labels: Record<string, string> };
  const id = Object.keys(data.labels).find((id) => data.labels[id] === source.name)!;
  expect(id).toBeDefined();
  remove!(at!);
  remove = game.skills.addProvider(provider, at!);
  expect(game.room.decisions.submit(first.id, first.token, id)).toEqual({ kind: 'accepted' });
  const second = await nextRequest(game.room);
  expect(second.id).not.toBe(first.id);
  expect(seen).toEqual(['B']);
  expect(game.room.decisions.submit(second.id, second.token, id)).toEqual({ kind: 'accepted' });
  await running;
  expect(seen).toEqual(['B', 'A', 'B']);
  rebuilt(game);
});

it('中途安装的新 Provider 立即参与当前查询，但触发候选从下一窗口开始', async () => {
  let added = false;
  const seen: string[] = [];
  const late = defineSkill({
    id: 'probe:late',
    name: '后来来源',
    modifiers: [modify(cardQueries.handLimitCorrection, () => 1)],
    triggers: [
      on(window, {
        locked: true,
        id: 'late',
        effect() {
          seen.push('B');
        },
      }),
    ],
  });
  const definition = defineSkill({
    id: source.skill,
    name: source.name,
    triggers: [
      on(window, {
        locked: true,
        id: 'install',
        effect(ctx) {
          seen.push('A');
          if (!added) {
            added = true;
            game.skills.addProvider(
              {
                collect: () => [
                  {
                    self: { ...source, id: 'probe:late', skill: late.id },
                    definition: late,
                  },
                ],
              },
              ctx,
            );
          }
          expect(game.book.handLimit(ctx, 'a')).toBe(5);
        },
      }),
    ],
  });
  const game = cardGame();
  await game.room.run('windows', async (ctx) => {
    game.skills.addProvider({ collect: () => [{ self: source, definition }] }, ctx);
    await ctx.window(window, null);
    expect(seen).toEqual(['A']);
    await ctx.window(window, null);
  });
  expect(seen).toEqual(['A', 'B', 'A']);
  rebuilt(game);
});

it.each([false, true])('等待 invoke 时卸载，重新登记为 %s 也不让旧询问支付', async (reinstall) => {
  let at: Context;
  let remove: (ctx?: Context) => void;
  let accepted = true;
  let old: SkillHandle;
  const definition = defineSkill({
    id: source.skill,
    name: source.name,
    triggers: [
      on(window, {
        locked: true,
        id: 'invoke',
        async effect(ctx, _event, self) {
          at = ctx;
          old = self;
          accepted = await invoke(ctx, self, '是否发动派生技能？');
        },
      }),
    ],
  });
  const provider: SkillProvider = { collect: () => [{ self: source, definition }] };
  const game = cardGame();
  const running = game.room.run('invoke', async (ctx) => {
    remove = game.skills.addProvider(provider, ctx);
    await ctx.window(window, null);
  });
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('invoke');
  remove!(at!);
  if (reinstall) game.skills.addProvider(provider, at!);
  expect(old!.active(at!)).toBe(false);
  expect(game.room.decisions.submit(request.id, request.token, true)).toMatchObject({
    kind: 'rejected',
    reason: 'invalid',
  });
  await running;
  expect(accepted).toBe(false);
  expect(game.room.history.facts('skill.invoked')).toHaveLength(0);
  rebuilt(game);
});

it('来源卸载不撤销已完成的宣告或费用；普通后续继续，新的技能支付失效', async () => {
  let remove: (ctx?: Context) => void;
  const definition = defineSkill({
    id: source.skill,
    name: source.name,
    triggers: [
      on(window, {
        locked: true,
        id: 'paid',
        async effect(ctx, _event, self) {
          expect(await invoke(ctx, self, '发动后继续？')).toBe(true);
          expect(
            (
              await pay(ctx, {
                skill: self,
                cards: ['slash1'],
                to: 'discard',
                reason: 'first-fee',
              })
            ).kind,
          ).toBe('paid');
          remove(ctx);
          expect(self.active(ctx)).toBe(false);
          expect(
            (
              await pay(ctx, {
                skill: self,
                cards: ['slash2'],
                to: 'discard',
                reason: 'later-fee',
              })
            ).kind,
          ).toBe('unavailable');
          await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
          ctx.commit('probe.continued', [], null);
        },
      }),
    ],
  });
  const game = cardGame({ draw: [card('reward', 'jink')] });
  const running = game.room.run('effect', async (ctx) => {
    remove = game.skills.addProvider({ collect: () => [{ self: source, definition }] }, ctx);
    await ctx.window(window, null);
  });
  const request = await nextRequest(game.room);
  expect(game.room.decisions.submit(request.id, request.token, true)).toEqual({ kind: 'accepted' });
  await running;
  expect(game.room.world.position('slash1')).toBe('discard');
  expect(game.room.world.position('slash2')).toBe('a:hand');
  expect(game.room.world.position('reward')).toBe('a:hand');
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  expect(game.room.history.facts('cost.paid')).toHaveLength(1);
  expect(game.room.history.facts('probe.continued')).toHaveLength(1);
  rebuilt(game);
});

it('来源卸载立即移除查询/转换/主动入口，重新登记只产生新的有效引用', async () => {
  const definition = {
    id: source.skill,
    name: '定义名称',
    modifiers: [modify(cardQueries.handLimitCorrection, () => 2)],
    active: [{ id: 'active', available: () => true, run() {} }],
    viewAs: [
      {
        id: 'slash',
        names: () => ['standard:slash'],
        count: { min: 1, max: 1 },
        materials: (ctx, { self }) => ownedCards(ctx.world, self.owner),
        make: () => ({ name: 'standard:slash' }),
      },
    ],
  } satisfies SkillDefinition;
  const provider: SkillProvider = { collect: () => [{ self: source, definition }] };
  const game = cardGame();
  await game.room.run('phase', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      const remove = game.skills.addProvider(provider, at);
      await at.window(window, null);
      const old = game.skills.binding(at.world, source.id)!.self;
      const choice = {
        kind: 'viewAs' as const,
        instance: source.id,
        recipe: 'slash',
        materials: ['slash1'],
      };
      expect(game.book.handLimit(at, 'a')).toBe(6);
      expect(activeOffers(at, game.book, phase)).toMatchObject([{ label: source.name }]);
      expect(game.book.offers(at, 'a', 'use')).toContainEqual(
        expect.objectContaining({ kind: 'viewAs', label: source.name }),
      );
      expect(game.book.build(at, 'a', choice, 'use').ok).toBe(true);
      remove(at);
      expect(game.book.handLimit(at, 'a')).toBe(4);
      expect(activeOffers(at, game.book, phase)).toEqual([]);
      expect(game.book.build(at, 'a', choice, 'use').ok).toBe(false);
      expect(old.active(at)).toBe(false);
      expect(old.active(at)).toBe(false);
      const removeNew = game.skills.addProvider(provider, at);
      remove(at);
      expect(old.active(at)).toBe(false);
      expect(game.skills.binding(at.world, source.id)!.self.active(at)).toBe(true);
      expect(game.book.handLimit(at, 'a')).toBe(6);
      removeNew(at);
    }),
  );
  rebuilt(game);
});

it('装配期无需 Context，重复登记拒绝；挂接后省略 Context 不得安装或卸载', async () => {
  const book = new SkillBook();
  const provider: SkillProvider = { collect: () => [] };
  const remove = book.addProvider(provider);
  expect(() => book.addProvider(provider)).toThrow('already installed');
  remove();
  const removeNew = book.addProvider(provider);
  remove();
  expect(() => book.addProvider(provider)).toThrow('already installed');
  const target = room();
  book.attach(target);
  expect(() => removeNew()).toThrow('active Context');
  expect(() => book.addProvider({ collect: () => [] })).toThrow('active Context');
  await target.run('valid', (ctx) => {
    expect(() => book.addProvider(provider, ctx)).toThrow('already installed');
    removeNew(ctx);
    book.addProvider(provider, ctx)(ctx);
  });
});

it('纯查询中的安装/卸载均拒绝且保留登记，正常规则操作仍可以卸载', async () => {
  const game = cardGame();
  const definition = defineSkill({ id: source.skill, name: source.name, triggers: [] });
  const provider: SkillProvider = { collect: () => [{ self: source, definition }] };
  await game.room.run('query', (ctx) => {
    const remove = game.skills.addProvider(provider, ctx);
    expect(() => ctx.query(() => remove(ctx))).toThrow('Pure queries');
    expect(() => ctx.query(() => game.skills.addProvider({ collect: () => [] }, ctx))).toThrow(
      'Pure queries',
    );
    expect(game.skills.binding(ctx.world, source.id)).toBeDefined();
    remove(ctx);
    expect(game.skills.binding(ctx.world, source.id)).toBeUndefined();
  });
  rebuilt(game);
});

it.each(['add', 'remove'] as const)(
  'Provider 收集期间不能 %s，错误退出后可以正常卸载',
  async (action) => {
    const game = cardGame();
    let at: Context;
    let remove: (ctx?: Context) => void;
    const provider: SkillProvider = {
      collect: () => {
        if (action === 'add') game.skills.addProvider({ collect: () => [] }, at);
        else remove(at);
        return [];
      },
    };
    await game.room.run('collection', (ctx) => {
      at = ctx;
      remove = game.skills.addProvider(provider, ctx);
      expect(() => game.skills.bindings(ctx.world)).toThrow('during collection');
      remove(ctx);
      expect(game.skills.bindings(ctx.world)).toEqual([]);
    });
    rebuilt(game);
  },
);

it('外局、已关闭 Context 和多局共享目录不能改变运行期 Provider', async () => {
  const game = cardGame();
  const foreign = room('foreign');
  const provider: SkillProvider = { collect: () => [] };
  let closed: Context;
  let remove: (ctx?: Context) => void;
  await game.room.run('install', (ctx) => {
    closed = ctx;
    remove = game.skills.addProvider(provider, ctx);
  });
  expect(() => remove!(closed!)).toThrow();
  await foreign.run('foreign', (ctx) => {
    expect(() => remove(ctx)).toThrow('single attached Room');
    expect(() => game.skills.addProvider({ collect: () => [] }, ctx)).toThrow(
      'single attached Room',
    );
  });
  const detach = game.skills.attach(foreign);
  await game.room.run('shared', (ctx) => {
    expect(() => remove(ctx)).toThrow('single attached Room');
  });
  detach();
  await game.room.run('own', (ctx) => remove(ctx));
  rebuilt(game);
});

it.each(['finish', 'abort', 'fault'] as const)(
  'Room %s 后自动释放目录挂接，不阻塞仍存活的一局',
  async (ending) => {
    const game = cardGame();
    const other = room('ending');
    const oldDetach = game.skills.attach(other);
    if (ending === 'fault') {
      await expect(
        other.run('fault', () => {
          throw new Error('probe failure');
        }),
      ).rejects.toThrow('probe failure');
    } else if (ending === 'finish') other.finish('finished');
    else other.abort('aborted');
    expect(other.status).toBe(ending === 'fault' ? 'faulted' : 'ended');
    await game.room.run('surviving', (ctx) => {
      const provider: SkillProvider = { collect: () => [] };
      const remove = game.skills.addProvider(provider, ctx);
      oldDetach();
      remove(ctx);
    });
    rebuilt(game);
  },
);

it('纯查询不能通过挂接或卸载取消 Room 的目录清理', async () => {
  const target = room();
  const book = new SkillBook();
  const detach = book.attach(target);
  await target.run('query', (ctx) => {
    expect(() => ctx.query(() => detach())).toThrow('Pure queries');
    expect(() => ctx.query(() => book.attach(target))).toThrow('Pure queries');
  });
  target.finish('finished');
  const next = room('next');
  book.attach(next);
  await next.run('next', (ctx) => book.addProvider({ collect: () => [] }, ctx)(ctx));
});

it.each(['query', 'ended'] as const)('向 %s Room 挂接失败不封口尚未装配完的目录', async (kind) => {
  const target = room();
  const book = new SkillBook();
  if (kind === 'query') {
    await target.run('query', (ctx) => {
      expect(() => ctx.query(() => book.attach(target))).toThrow('Pure queries');
    });
  } else {
    target.finish('finished');
    expect(() => book.attach(target)).toThrow();
  }
  const definition = defineSkill({ id: source.skill, name: source.name, triggers: [] });
  book.register([definition]);
  const remove = book.addProvider({ collect: () => [{ self: source, definition }] });
  remove();
  expect(book.definition(source.skill)).toBeDefined();
});

it('Provider 的 class 来源保留原型方法和原登记谓词，不恢复作者明确关闭的来源', async () => {
  let enabled = true;
  class Source implements SkillHandle {
    readonly id = source.id;
    readonly owner = source.owner;
    readonly skill = source.skill;
    readonly name = source.name;
    readonly origin = source.origin;
    #owner = source.owner;
    active(ctx: Context) {
      return enabled && this.#owner === 'a' && ctx.world.player(this.#owner).alive;
    }
  }
  class Definition implements SkillDefinition {
    id = source.skill;
    name = source.name;
    viewAs = [{ id: 'virtual', make: { name: 'standard:slash' } }];
    triggers = [
      on(window, {
        locked: true,
        id: 'run',
        effect(ctx) {
          ctx.commit('probe.class', [], null);
        },
      }),
    ];
  }
  const definition = new Definition();
  const game = cardGame();
  await game.room.run('class', async (ctx) => {
    game.skills.addProvider({ collect: () => [{ self: new Source(), definition }] }, ctx);
    await ctx.window(window, null);
    const first = game.skills.binding(ctx.world, source.id)!;
    expect(first.definition).toBe(definition);
    expect(
      game.book.build(
        ctx,
        'a',
        { kind: 'viewAs', instance: source.id, recipe: 'virtual', materials: [] },
        'use',
      ),
    ).toMatchObject({ ok: true, value: { name: 'standard:slash', materials: [] } });
    definition.viewAs.push(definition.viewAs[0]!);
    expect(() => game.skills.bindings(ctx.world)).toThrow(
      `[${source.skill}] Duplicate view-as recipe ID: virtual.`,
    );
    definition.viewAs.pop();
    enabled = false;
    await ctx.window(window, null);
    const handle = game.skills.binding(ctx.world, source.id)!.self;
    expect(handle.active(ctx)).toBe(false);
    expect(handle.active(ctx)).toBe(false);
  });
  expect(game.room.history.facts('probe.class')).toHaveLength(1);
  rebuilt(game);
});

it('同一 Provider 对象重新登记不能复活旧候选，旧卸载函数也不能删除新登记', async () => {
  let remove: (ctx?: Context) => void;
  let replaced = false;
  const seen: number[] = [];
  const definition = defineSkill({
    id: source.skill,
    name: source.name,
    triggers: [
      on(window, {
        locked: true,
        id: 'repeat',
        times: () => 3,
        effect(ctx, _event, _self, _value, occurrence) {
          seen.push(occurrence.index);
          if (!replaced) {
            replaced = true;
            const oldRemove = remove;
            oldRemove(ctx);
            remove = game.skills.addProvider(provider, ctx);
            oldRemove(ctx);
          }
        },
      }),
    ],
  });
  const provider: SkillProvider = { collect: () => [{ self: source, definition }] };
  const game = cardGame();
  await game.room.run('install', async (ctx) => {
    remove = game.skills.addProvider(provider, ctx);
    await ctx.window(window, null);
    expect(seen).toEqual([1]);
    expect(game.skills.binding(ctx.world, source.id)).toBeDefined();
    await ctx.window(window, null);
    remove(ctx);
  });
  expect(seen).toEqual([1, 1, 2, 3]);
  rebuilt(game);
});
