import { testTiming } from '../fixtures/timing';
import { expect, it } from 'vitest';
import { cardGame, card, settled } from '../fixtures/cards';
import { covenant } from '../../examples/effects/covenant';
import { rebuildWorld } from '../../src/core/history/rebuild';
import {
  defineEffect,
  on,
  effectModify,
  defineQuery,
  withLifetime,
  kill,
  pay,
  runTurn,
  defineSkill,
  damage,
  EffectBook,
  Cost,
  Effect,
} from '../../src/sdk';
import type {
  EffectHandle,
  EffectBehavior,
  Context,
  EffectDefinition,
  EffectRecord,
  Lifetime,
} from '../../src/sdk';
import { Room } from '../../src/core/runtime/room';

const tick = testTiming<null>('probe:effect-tick', ['before', 'main', 'after']);
const strength = defineQuery<null, number>('probe:effect-strength', (a, b) => a + b);
interface Data {
  readonly amount: number;
}
const accepts = (data: unknown): data is Data =>
  !!data && typeof data === 'object' && 'amount' in data && Number.isSafeInteger(data.amount);
// 定义必须在装配期登记，真实实例则在活跃 Context 中加入。
function create(
  options: {
    readonly behavior?: (self: EffectHandle<Data>) => EffectBehavior;
    readonly onEnd?: EffectDefinition<Data>['onEnd'];
  } = {},
) {
  const ended: string[] = [];
  const fired: string[] = [];
  let handle: EffectHandle<Data> | null = null;
  const tickHandler = (self: EffectHandle<Data>) => ({
    times: () => 1,
    when: (ctx: Context) => self.current(ctx.world) !== null,
    effect: () => {
      fired.push(self.id);
    },
  });
  const definition = defineEffect<Data>({
    id: 'probe:lasting',
    name: '持续效果',
    accepts,
    create(self) {
      handle = self;
      if (options.behavior) return options.behavior(self);
      return {
        modifiers: [effectModify(strength, () => self.data.amount)],
        triggers: [on(tick, tickHandler(self))],
      };
    },
    async onEnd(ctx, input) {
      ended.push(input.before.id);
      await options.onEnd?.(ctx, input);
    },
  });
  const game = cardGame({
    effects: [definition],
  });
  return {
    ...game,
    effects: game.book.effects,
    definition,
    ended,
    fired,
    handle: () => handle,
  };
}
type Game = ReturnType<typeof create>;
function value(game: Game) {
  return game.room.inspect((ctx) => game.skills.query(ctx, strength, null, 0));
}

it.each(['prepare', 'add', 'update'] as const)(
  '%s 校验实际保存的效果快照，getter 只读一次并保留来源别名',
  async (mode) => {
    const definition = defineEffect<Data>({
      id: 'probe:snapshot',
      name: '快照',
      accepts(value): value is Data {
        if (!value || typeof value !== 'object' || !('amount' in value)) return false;
        const amount = value.amount;
        return Number.isSafeInteger(amount) && Number(amount) >= 0;
      },
      create: () => ({}),
    });
    const game = cardGame({ effects: [definition] });
    let reads = 0;
    const data = {
      get amount() {
        return ++reads === 1 ? 1 : -1;
      },
    };
    await game.room.run('snapshot', async (ctx) => {
      let record: EffectRecord<Data>;
      if (mode === 'update') {
        const initial = { amount: 0 };
        const before = await game.book.effects.add(ctx, definition, {
          owner: 'a',
          origin: initial,
          data: initial,
        });
        record = (await game.book.effects.update(ctx, before.id, data))!;
        expect(record.origin).toBe(before.origin);
      } else {
        const input = { owner: 'a', origin: data, data };
        if (mode === 'prepare') {
          const prepared = await game.book.effects.prepare(ctx, definition, input);
          ctx.commit(testTiming('snapshot.prepared'), prepared.changes, prepared.record);
          record = prepared.record;
        } else record = await game.book.effects.add(ctx, definition, input);
        expect(record.origin).toBe(record.data);
      }
      expect(reads).toBe(1);
      expect(record.data.amount).toBe(1);
      expect(
        game.book.effects.instances(ctx.world, definition).find((item) => item.id === record.id)
          ?.data,
      ).toBe(record.data);
      expect(reads).toBe(1);
    });
    expect(game.room.status).toBe('ready');
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  },
);

it('独立实例跨创建 Flow 存在、参与查询与触发，不授予假技能，显式结束幂等', async () => {
  const game = create();
  const record = await game.room.run('create', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 2 } }),
  );
  expect(record).toMatchObject({ value: { type: game.definition.id, owner: 'b' } });
  const id = game.effects.instances(game.room.world)[0]!.id;
  expect(game.room.world.snapshot.skills).toEqual([]);
  expect(value(game)).toBe(2);
  await game.room.run('tick', (ctx) => ctx.window(tick, null));
  expect(game.fired).toEqual([id]);
  await game.room.run('end', async (ctx) => {
    expect(await game.effects.end(ctx, id, 'used')).toMatchObject({
      id,
      data: { amount: 2 },
    });
    expect(await game.effects.end(ctx, id, 'again')).toBeNull();
  });
  expect(value(game)).toBe(0);
  expect(game.ended).toEqual([id]);
  settled(game);
});
it('相同定义的多个实例独立叠加、更新与移除，不共享技能次数或数据', async () => {
  const game = create();
  await game.room.run('create', async (ctx) => {
    await game.effects.add(ctx, game.definition, { owner: null, data: { amount: 2 } });
    await game.effects.add(ctx, game.definition, { owner: 'c', data: { amount: 3 } });
  });
  const [first, second] = game.effects.instances(game.room.world, game.definition);
  expect(first!.id).not.toBe(second!.id);
  expect(value(game)).toBe(5);
  await game.room.run('update', (ctx) => game.effects.update(ctx, first!.id, { amount: 7 }));
  expect(value(game)).toBe(10);
  await game.room.run('remove', (ctx) => game.effects.end(ctx, second!.id, 'used'));
  expect(value(game)).toBe(7);
  settled(game);
});
it('领域结束先清除所有实例的查询资格，再发结束后效，重建不会复活', async () => {
  const game = create();
  game.room.on(Effect.ended, {
    id: 'observe',
    owner: null,
    eligible: () => true,
    run(ctx) {
      expect(game.skills.query(ctx, strength, null, 0)).toBe(0);
    },
  });
  await game.room.run('lifetime', (ctx) =>
    withLifetime(ctx, 'turn-test', async (at, lifetime) => {
      await game.effects.add(at, game.definition, { owner: 'a', lifetime, data: { amount: 4 } });
      await game.effects.add(at, game.definition, { owner: null, lifetime, data: { amount: 2 } });
      expect(game.skills.query(at, strength, null, 0)).toBe(6);
    }),
  );
  expect(game.ended).toHaveLength(2);
  expect(game.effects.instances(game.room.world)).toEqual([]);
  expect(value(game)).toBe(0);
  settled(game);
});
it.each([false, true])(
  '同批到期后效的局部中止不吞掉其余实例，领域本体中止=%s',
  async (abortBody) => {
    const completed: number[] = [];
    const game = create({
      onEnd(ctx, { before }) {
        expect(game.skills.query(ctx, strength, null, 0)).toBe(0);
        ctx.commit(testTiming('probe.expiry-started'), [], { amount: before.data.amount });
        if (before.data.amount === 1) ctx.abort('only this expiry');
        completed.push(before.data.amount);
      },
    });
    let resumed = false;
    const result = await game.room.run('expiry', async (ctx) => {
      await withLifetime(ctx, 'batch', async (at, lifetime) => {
        for (const amount of [1, 2])
          await game.effects.add(at, game.definition, { owner: null, lifetime, data: { amount } });
        if (abortBody) at.abort('body stopped');
      });
      resumed = true;
    });

    expect(game.ended).toHaveLength(2);
    expect(completed).toEqual([2]);
    expect(game.room.history.facts(Effect.ended)).toHaveLength(2);
    expect(game.room.history.facts(testTiming('probe.expiry-started'))).toHaveLength(2);
    expect(game.effects.instances(game.room.world)).toEqual([]);
    expect(result).toEqual(
      abortBody
        ? { kind: 'aborted', reason: 'body stopped' }
        : { kind: 'resolved', value: undefined },
    );
    expect(resumed).toBe(!abortBody);
    expect(game.room.status).toBe('ready');
    settled(game);
  },
);

it('显式结束的后效中止仍传播给调用者，不借批量到期边界恢复', async () => {
  const game = create({ onEnd: (ctx) => ctx.abort('explicit end stopped') });
  let resumed = false;
  const result = await game.room.run('explicit', async (ctx) => {
    const effect = await game.effects.add(ctx, game.definition, {
      owner: null,
      data: { amount: 1 },
    });
    await game.effects.end(ctx, effect.id, 'manual');
    resumed = true;
  });
  expect(result).toEqual({ kind: 'aborted', reason: 'explicit end stopped' });
  expect(resumed).toBe(false);
  expect(game.room.status).toBe('ready');
  expect(game.room.history.facts(Effect.ended)).toHaveLength(1);
  expect(game.effects.instances(game.room.world)).toEqual([]);
  settled(game);
});

it.each(['fault', 'close'] as const)(
  '同批到期不恢复整局 %s，余项后效停止但移除事实保留',
  async (exit) => {
    const game = create({
      onEnd(ctx, { before }) {
        if (before.data.amount !== 1) throw new Error('Must not run another expiry.');
        if (exit === 'fault') throw new Error('expiry fault');
        game.room.abort('room closed');
        ctx.commit(testTiming('must not write'), [], {});
      },
    });
    const running = game.room.run('expiry', (ctx) =>
      withLifetime(ctx, 'batch', async (at, lifetime) => {
        for (const amount of [1, 2])
          await game.effects.add(at, game.definition, { owner: null, lifetime, data: { amount } });
      }),
    );

    if (exit === 'fault') await expect(running).rejects.toThrow('expiry fault');
    else expect(await running).toEqual({ kind: 'aborted', reason: 'room closed' });
    expect(game.room.status).toBe(exit === 'fault' ? 'faulted' : 'ended');
    expect(game.ended).toHaveLength(1);
    expect(game.room.history.facts(Effect.ended)).toHaveLength(1);
    expect(game.room.history.facts(testTiming('must not write'))).toEqual([]);
    expect(game.effects.instances(game.room.world)).toEqual([]);
    settled(game);
  },
);

it('来源与效果归属角色死亡不隐含撤销，规则可在死亡后继续触发和查询', async () => {
  const game = create();
  await game.room.run('create', (ctx) =>
    game.effects.add(ctx, game.definition, {
      owner: 'a',
      origin: { actor: 'a', skill: 'probe:origin' },
      data: { amount: 3 },
    }),
  );
  await game.room.run('death', (ctx) =>
    kill(ctx, {
      player: 'a',
      killer: null,
      reason: 'rule',
      cause: { kind: 'rule', seq: null, data: null },
    }),
  );
  expect(value(game)).toBe(3);
  await game.room.run('tick', (ctx) => ctx.window(tick, null));
  expect(game.fired).toHaveLength(1);
  settled(game);
});
it('实例声明可与费用同次提交，支付后效立即看到效果，未支付不添加', async () => {
  const game = create();
  game.room.on(Cost.paid, {
    id: 'observe',
    owner: null,
    eligible: () => true,
    run(ctx) {
      expect(game.skills.query(ctx, strength, null, 0)).toBe(5);
    },
  });
  await game.room.run('pay', async (ctx) => {
    const prepared = await game.effects.prepare(ctx, game.definition, {
      owner: 'b',
      data: { amount: 5 },
    });
    expect(game.skills.query(ctx, strength, null, 0)).toBe(0);
    expect(
      (
        await pay(ctx, {
          actor: 'b',
          cards: [],
          to: 'discard',
          reason: 'probe:effect',
          legal: () => false,
          changes: prepared.changes,
        })
      ).kind,
    ).toBe('unavailable');
    expect(game.effects.instances(ctx.world)).toEqual([]);
    expect(
      (
        await pay(ctx, {
          actor: 'b',
          cards: [],
          to: 'discard',
          reason: 'probe:effect',
          changes: prepared.changes,
          declaration: { effect: prepared.record },
        })
      ).kind,
    ).toBe('paid');
  });
  expect(value(game)).toBe(5);
  settled(game);
});

it('全局实例与角色实例按本局行动序调度，不把原来源当作永久锚点', async () => {
  const game = create();
  await game.room.run('add', async (ctx) => {
    for (const owner of ['a', 'c', null])
      await game.effects.add(ctx, game.definition, {
        owner,
        origin: { actor: 'd' },
        data: { amount: 1 },
      });
  });
  const records = game.effects.instances(game.room.world);
  await game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'b', {
      phases: ['play'],
      body: async (at) => {
        await at.window(tick, null);
      },
    }),
  );
  // Window 的无角色候选先于席位候选；席位仍从当前 b 回合排序。
  expect(game.fired).toEqual([records[2]!.id, records[1]!.id, records[0]!.id]);
  settled(game);
});
it('已宣告效果不依赖原技能继续持有或有效', async () => {
  const independent = defineEffect<Data>({
    id: 'probe:after-skill',
    name: '已宣告效果',
    accepts,
    create: (self) => ({ modifiers: [effectModify(strength, () => self.data.amount)] }),
  });
  const sourceSkill = defineSkill({ id: 'probe:source', name: '来源', triggers: [] });
  const game = cardGame({
    effects: [independent],
    skills: [sourceSkill],
  });
  await game.room.run('declare', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'a',
      skill: sourceSkill.id,
      source: { kind: 'general', id: 'probe' },
    });
    await game.book.effects.add(ctx, independent, {
      owner: 'b',
      origin: { skill: sourceSkill.id, actor: 'a' },
      data: { amount: 4 },
    });
    await game.skills.revoke(ctx, 'a', sourceSkill.id, { kind: 'general', id: 'probe' });
    expect(game.skills.query(ctx, strength, null, 0)).toBe(4);
  });
  expect(game.room.world.snapshot.skills).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});
it('入场后更新数据，既有候选执行时读取最新值', async () => {
  const seen: number[] = [];
  const game = create({
    behavior: (self) => ({
      triggers: [
        on(tick, {
          id: 'latest',
          effect() {
            seen.push(self.data.amount);
          },
        }),
      ],
    }),
  });
  await game.room.run('add', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 1 } }),
  );
  const id = game.effects.instances(game.room.world)[0]!.id;
  game.room.on(tick, {
    id: 'update',
    group: 'before',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await game.effects.update(ctx, id, { amount: 8 });
    },
  });
  await game.room.run('tick', (ctx) => ctx.window(tick, null));
  expect(seen).toEqual([8]);
  settled(game);
});
it('前组结束效果后，已收集的后组候选不再执行或收费', async () => {
  let charged = 0;
  const game = create({
    behavior: () => ({
      triggers: [
        on(tick, {
          id: 'fee',
          async effect(ctx) {
            await pay(ctx, { actor: 'b', cards: [], to: 'discard', reason: 'effect:fee' });
            charged++;
          },
        }),
      ],
    }),
  });
  await game.room.run('add', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 1 } }),
  );
  const id = game.effects.instances(game.room.world)[0]!.id;
  game.room.on(tick, {
    id: 'end',
    group: 'before',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await game.effects.end(ctx, id, 'cancelled');
    },
  });
  await game.room.run('tick', (ctx) => ctx.window(tick, null));
  expect(charged).toBe(0);
  expect(game.room.history.facts(Cost.paid)).toEqual([]);
  settled(game);
});

it('有限次数在入场时固定，逐次执行可读取更新数据，不从新数值补次数', async () => {
  const seen: number[] = [];
  const game = create({
    behavior: (self) => ({
      triggers: [
        on(tick, {
          id: 'many',
          times: () => self.data.amount,
          async effect(ctx, _event, _self, _value, occurrence) {
            seen.push(occurrence.index);
            if (occurrence.index === 1) await self.update(ctx, { amount: 7 });
          },
        }),
      ],
    }),
  });
  await game.room.run('add', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 2 } }),
  );
  await game.room.run('tick', (ctx) => ctx.window(tick, null));
  expect(seen).toEqual([1, 2]);
  expect(game.effects.instances(game.room.world)[0]!.data).toEqual({ amount: 7 });
  settled(game);
});
it('普通异步函数可以嵌套同类窗口，实例数据与每次事件身份独立', async () => {
  const seen: number[] = [];
  const game = create({
    behavior: (self) => ({
      triggers: [
        on(tick, {
          id: 'nested',
          async effect(ctx) {
            seen.push(self.data.amount);
            if (self.data.amount > 0) {
              await self.update(ctx, { amount: 0 });
              await ctx.window(tick, null);
            }
          },
        }),
      ],
    }),
  });
  await game.room.run('add', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 1 } }),
  );
  await game.room.run('tick', (ctx) => ctx.window(tick, null));
  expect(seen).toEqual([1, 0]);
  settled(game);
});
it('创建流程中止仍结束临时效果；结束回调不能恢复查询资格', async () => {
  const game = create({
    onEnd(ctx) {
      expect(game.skills.query(ctx, strength, null, 0)).toBe(0);
    },
  });
  await game.room.run('scope', (ctx) =>
    withLifetime(ctx, 'aborted', async (at, lifetime) => {
      await game.effects.add(at, game.definition, { owner: null, lifetime, data: { amount: 5 } });
      at.abort('probe:stop');
    }),
  );
  expect(value(game)).toBe(0);
  expect(game.ended).toHaveLength(1);
  expect(game.room.history.facts(Effect.ended)[0]?.data.detail).toMatchObject({
    reason: 'lifetime:aborted:aborted',
  });
  settled(game);
});
it('效果句柄拒绝外局和旧挂接；重新挂接只产生新的执行资格', async () => {
  const game = create();
  await game.room.run('add', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 1 } }),
  );
  value(game);
  const old = game.handle()!;
  const other = create();
  await other.room.run('foreign', (ctx) => {
    expect(old.current(ctx.world)).toBeNull();
    expect(() => old.end(ctx, 'foreign')).toThrow('outside');
  });
  const next = new Room({ id: 'next-effects', seed: 42, world: game.initial });
  const detach = game.skills.attach(next);
  await next.run('add', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 2 } }),
  );
  next.inspect((ctx) => game.skills.query(ctx, strength, null, 0));
  const previous = game.handle()!;
  detach();
  const detachAgain = game.skills.attach(next);
  detach();
  expect(() => new EffectBook().attach(next)).toThrow('already has');
  expect(previous.current(next.world)).toBeNull();
  await next.run('old-registration', (ctx) => {
    expect(() => previous.end(ctx, 'stale')).toThrow('outside');
  });
  expect(next.inspect((ctx) => game.skills.query(ctx, strength, null, 0))).toBe(2);
  expect(game.handle()!.current(next.world)?.data.amount).toBe(2);
  detachAgain();
  settled(game);
});
it('已提交实例以普通数据重建，新执行器加载同一定义后恢复查询和触发', async () => {
  const game = create();
  await game.room.run('add', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: null, data: { amount: 6 } }),
  );
  const world = rebuildWorld(game.initial, game.room.history.facts());
  const restored = new Room({ id: 'restored-effects', seed: 42, world });
  const detach = game.skills.attach(restored);
  expect(restored.inspect((ctx) => game.skills.query(ctx, strength, null, 0))).toBe(6);
  await restored.run('tick', (ctx) => ctx.window(tick, null));
  expect(game.fired).toHaveLength(1);
  detach();
  settled(game);
});
it.each(['data', 'owner', 'definition'] as const)(
  '非法 %s 在整次声明前拒绝，不留下半条状态',
  async (kind) => {
    const game = create();
    const otherDefinition: EffectDefinition<Data> = { ...game.definition, create: () => ({}) };
    const before = game.room.world.snapshot;
    await expect(
      game.room.run('invalid', (ctx) =>
        game.effects.add(ctx, kind === 'definition' ? otherDefinition : game.definition, {
          owner: kind === 'owner' ? 'missing' : 'b',
          data: kind === 'data' ? { amount: Number.NaN } : { amount: 1 },
        }),
      ),
    ).rejects.toThrow();
    expect(game.room.world.snapshot).toEqual(before);
    expect(game.effects.instances(game.room.world)).toEqual([]);
  },
);
it('关闭的领域不能用于新效果', async () => {
  const game = create();
  let expired: Lifetime | undefined;
  await game.room.run('lifetime', (ctx) =>
    withLifetime(ctx, 'expired', (_at, lifetime) => {
      expired = lifetime;
    }),
  );
  const before = game.room.world.snapshot;
  await expect(
    game.room.run('invalid', (ctx) =>
      game.effects.add(ctx, game.definition, {
        owner: 'b',
        lifetime: expired!,
        data: { amount: 2 },
      }),
    ),
  ).rejects.toThrow('Lifetime');
  expect(game.room.world.snapshot).toEqual(before);
});
it('创建、更新与结束都拒绝纯查询写入', async () => {
  const game = create();
  await game.room.run('pure', async (ctx) => {
    expect(() =>
      ctx.query(() => game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 1 } })),
    ).toThrow('Pure queries');
    const record = await game.effects.add(ctx, game.definition, {
      owner: 'b',
      data: { amount: 1 },
    });
    expect(() => ctx.query(() => game.effects.update(ctx, record.id, { amount: 5 }))).toThrow(
      'Pure queries',
    );
    expect(() => ctx.query(() => game.effects.end(ctx, record.id, 'pure'))).toThrow('Pure queries');
  });
  expect(value(game)).toBe(1);
  settled(game);
});
it('普通工厂的分支移除触发后，已收集候选不再借旧回调执行', async () => {
  let fired = 0;
  const game = create({
    behavior: (self) => ({
      triggers:
        self.data.amount > 0
          ? [
              on(tick, {
                id: 'conditional',
                effect() {
                  fired++;
                },
              }),
            ]
          : [],
    }),
  });
  await game.room.run('add', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 1 } }),
  );
  const id = game.effects.instances(game.room.world)[0]!.id;
  game.room.on(tick, {
    id: 'change',
    group: 'before',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await game.effects.update(ctx, id, { amount: 0 });
    },
  });
  await game.room.run('tick', (ctx) => ctx.window(tick, null));
  expect(fired).toBe(0);
  settled(game);
});
it('同一候选身份的工厂闭包按最新数据重绑，入场次数仍保持快照', async () => {
  const seen: number[] = [];
  const game = create({
    behavior: (self) => {
      const amount = self.data.amount;
      return {
        triggers: [
          on(tick, {
            id: 'closure',
            effect() {
              seen.push(amount);
            },
          }),
        ],
      };
    },
  });
  await game.room.run('add', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 1 } }),
  );
  const id = game.effects.instances(game.room.world)[0]!.id;
  game.room.on(tick, {
    id: 'change',
    group: 'before',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await game.effects.update(ctx, id, { amount: 9 });
    },
  });
  await game.room.run('tick', (ctx) => ctx.window(tick, null));
  expect(seen).toEqual([9]);
  settled(game);
});
it('数据声明复制冻结，非法更新在提交前拒绝，旧内容与事实保留', async () => {
  const game = create();
  const data = { amount: 3 };
  await game.room.run('add', (ctx) => game.effects.add(ctx, game.definition, { owner: 'b', data }));
  data.amount = 50;
  const record = game.effects.instances(game.room.world)[0]!;
  expect(record.data).toEqual({ amount: 3 });
  expect(Object.isFrozen(record.data)).toBe(true);
  const before = game.room.world.snapshot;
  await expect(
    game.room.run('invalid-update', (ctx) =>
      game.effects.update(ctx, record.id, { amount: 'bad' }),
    ),
  ).rejects.toThrow('Invalid updated');
  expect(game.room.world.snapshot).toEqual(before);
  expect(game.room.history.facts(Effect.changed)).toEqual([]);
});
it('真实守约跨回合与来源死亡：修改上限、仅减一次伤害、目标回合结束后撤销并摸牌', async () => {
  const game = cardGame({
    hands: { a: [] },
    draw: [card('reward', 'jink')],
    effects: [covenant],
  });
  await game.room.run('a-turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['play'],
      async body(at) {
        await game.book.effects.add(at, covenant, {
          owner: 'b',
          origin: { actor: 'a', skill: 'probe:creator' },
          data: { target: 'b', remaining: 1 },
        });
      },
    }),
  );
  await game.room.run('source-death', (ctx) =>
    kill(ctx, {
      player: 'a',
      killer: null,
      reason: 'rule',
      cause: { kind: 'rule', seq: null, data: null },
    }),
  );
  expect(game.room.inspect((ctx) => game.book.handLimit(ctx, 'b'))).toBe(5);
  await game.room.run('first-hit', async (ctx) => {
    expect((await damage(ctx, { from: 'c', to: 'b', amount: 2, nature: 'normal' })).hpLoss).toBe(1);
  });
  await game.room.run('second-hit', async (ctx) => {
    expect((await damage(ctx, { from: 'c', to: 'b', amount: 2, nature: 'normal' })).hpLoss).toBe(2);
  });
  expect(game.book.effects.instances(game.room.world, covenant)[0]!.data.remaining).toBe(0);
  expect(game.room.inspect((ctx) => game.book.handLimit(ctx, 'b'))).toBe(2);
  await game.room.run('b-turn', (ctx) =>
    runTurn(ctx, game.book, 'b', { phases: ['finish'], body: () => {} }),
  );
  expect(game.book.effects.instances(game.room.world)).toEqual([]);
  expect(game.room.world.position('reward')).toBe('b:hand');
  expect(game.room.inspect((ctx) => game.book.handLimit(ctx, 'b'))).toBe(1);
  expect(game.room.history.facts(Effect.ended)).toHaveLength(1);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.decisions.pending).toEqual([]);
});
it('守约受益者死亡按普通死亡时点撤销，已死来源与死者归属不妨碍清理', async () => {
  const game = cardGame({
    draw: [card('reward', 'jink')],
    effects: [covenant],
  });
  await game.room.run('add', (ctx) =>
    game.book.effects.add(ctx, covenant, { owner: 'b', data: { target: 'b', remaining: 1 } }),
  );
  await game.room.run('death', (ctx) =>
    kill(ctx, {
      player: 'b',
      killer: null,
      reason: 'rule',
      cause: { kind: 'rule', seq: null, data: null },
    }),
  );
  expect(game.book.effects.instances(game.room.world)).toEqual([]);
  expect(game.room.world.position('reward')).toBe('draw');
  expect(game.room.history.facts(Effect.ended)[0]?.data.detail).toMatchObject({
    reason: 'covenant:target-died',
  });
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});
it('同一 World 只能有一个效果目录，失败挂接不会留下第二来源', () => {
  const game = create();
  const other = new EffectBook();
  expect(() => other.attach(game.room)).toThrow('already has');
  expect(() => other.register([game.definition])).not.toThrow();
});
it('装配期批量登记原子拒绝重复定义，挂接后不能追加定义', () => {
  const game = create();
  const other = new EffectBook();
  expect(() => other.register([game.definition, game.definition])).toThrow('Duplicate');
  expect(() => other.register([game.definition])).not.toThrow();
  expect(() => game.effects.register([])).toThrow('sealed');
});
it('嵌套领域到期只移除自己的实例，外层与独立实例继续贡献', async () => {
  const game = create();
  await game.room.run('global', (ctx) =>
    game.effects.add(ctx, game.definition, { owner: null, data: { amount: 3 } }),
  );
  await game.room.run('outer', (ctx) =>
    withLifetime(ctx, 'outer', async (at, outer) => {
      await game.effects.add(at, game.definition, {
        owner: 'a',
        lifetime: outer,
        data: { amount: 2 },
      });
      await withLifetime(at, 'inner', async (child, inner) => {
        await game.effects.add(child, game.definition, {
          owner: 'b',
          lifetime: inner,
          data: { amount: 1 },
        });
        expect(game.skills.query(child, strength, null, 0)).toBe(6);
      });
      expect(game.skills.query(at, strength, null, 0)).toBe(5);
      expect(game.ended).toHaveLength(1);
    }),
  );
  expect(value(game)).toBe(3);
  expect(game.ended).toHaveLength(2);
  settled(game);
});
it('外局仍活跃的领域不能赋给本局效果，拒绝前不提交状态', async () => {
  const game = create();
  const other = create();
  await other.room.run('foreign-lifetime', (ctx) =>
    withLifetime(ctx, 'foreign', async (_at, foreign) => {
      await expect(
        game.room.run('add', (at) =>
          game.effects.add(at, game.definition, {
            owner: 'b',
            lifetime: foreign,
            data: { amount: 1 },
          }),
        ),
      ).rejects.toThrow('Lifetime');
    }),
  );
  expect(game.effects.instances(game.room.world)).toEqual([]);
  expect(game.room.history.facts(Effect.added)).toEqual([]);
  settled(other);
});
it.each(['factory', 'contribution'] as const)(
  '直接纯查询也拒绝效果 %s 中的规则写入，失败后守卫正常退出',
  async (kind) => {
    let writing: Context | null = null;
    const game = create({
      behavior: (self) => {
        if (kind === 'factory' && writing) writing.commit(testTiming('bad-factory'), [], null);
        return {
          modifiers: [
            effectModify(strength, () => {
              if (kind === 'contribution' && writing)
                writing.commit(testTiming('bad-query'), [], null);
              return self.data.amount;
            }),
          ],
        };
      },
    });
    await game.room.run('add', (ctx) =>
      game.effects.add(ctx, game.definition, { owner: 'b', data: { amount: 2 } }),
    );
    await game.room.run('query', (ctx) => {
      writing = ctx;
      const before = ctx.world.snapshot;
      expect(() => game.effects.contributions(ctx, strength, null)).toThrow('Pure queries');
      expect(ctx.world.snapshot).toBe(before);
      writing = null;
      expect(game.skills.query(ctx, strength, null, 0)).toBe(2);
      ctx.commit(testTiming('after-query'), [], null);
    });
    expect(game.room.history.facts(testTiming('bad-factory'))).toEqual([]);
    expect(game.room.history.facts(testTiming('bad-query'))).toEqual([]);
    settled(game);
  },
);
it.each(['finish', 'abort', 'fault'] as const)(
  '整局 %s 释放执行登记，旧句柄失效且不伪造持久效果的结束事实',
  async (exit) => {
    const game = create();
    await game.room.run('add', (ctx) =>
      game.effects.add(ctx, game.definition, { owner: null, data: { amount: 1 } }),
    );
    value(game);
    const self = game.handle()!;
    if (exit === 'finish') await game.room.run('finish', () => game.room.finish('complete'));
    else if (exit === 'abort') game.room.abort('stop');
    else
      await expect(
        game.room.run('fault', () => {
          throw new Error('probe:failure');
        }),
      ).rejects.toThrow('probe:failure');
    expect(self.current(game.room.world)).toBeNull();
    expect(game.ended).toEqual([]);
    expect(game.room.history.facts(Effect.ended)).toEqual([]);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  },
);
