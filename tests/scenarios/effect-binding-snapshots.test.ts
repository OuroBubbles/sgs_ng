import { testTiming } from '../fixtures/timing';
import { expect, it } from 'vitest';
import { card, cardGame } from '../fixtures/cards';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { defineEffect, on, draw } from '../../src/sdk';
import type { Context, EffectHandle, EffectBehavior, EffectRecord } from '../../src/sdk';

interface Balance {
  readonly count: number;
}
const redeem = testTiming<null>('capacity:redeem', ['before', 'main']);
const nested = testTiming<null>('capacity:nested-redeem');

function setup(create: (self: EffectHandle<Balance>) => EffectBehavior) {
  const ended: EffectRecord<Balance>[] = [];
  const effect = defineEffect<Balance>({
    id: 'capacity:balance',
    name: '积筹',
    accepts: (value): value is Balance =>
      !!value && typeof value === 'object' && 'count' in value && Number.isSafeInteger(value.count),
    create,
    onEnd(_ctx, { before }) {
      ended.push(before);
    },
  });
  const game = cardGame({
    draw: Array.from({ length: 12 }, (_, index) => card(`reward:${index}`, 'slash')),
    skills: [],
    setup: (book) => {
      book.effects.register([effect]);
    },
  });
  async function run() {
    await game.room.run('capacity', async (ctx) => {
      const record = await game.book.effects.add(ctx, effect, { owner: 'b', data: { count: 1 } });
      ctx.defer(
        game.room.on(redeem, {
          id: 'accumulate',
          owner: null,
          group: 'before',
          eligible: () => true,
          async run(at) {
            await game.book.effects.update(at, record.id, { count: 8 });
          },
        }),
      );
      await ctx.window(redeem, null);
    });
    expect(game.book.effects.instances(game.room.world)).toEqual([]);
    expect(game.room.decisions.pending).toEqual([]);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  }
  return { ...game, ended, run };
}

it('积筹在前组更新，兑现先结束效果，再按执行绑定快照实际摸牌', async () => {
  expect(() => on(redeem, { id: '', effect: () => {} })).toThrow('Trigger requires an ID.');
  const game = setup((self) => ({
    triggers: [
      on(redeem, {
        async effect(ctx) {
          await self.end(ctx, 'redeemed');
          expect(self.current(ctx.world)).toBeNull();
          await draw(ctx, { player: 'b', count: self.data.count, reason: 'capacity:reward' });
        },
      }),
    ],
  }));
  await game.run();
  expect(game.room.world.zone('b:hand').cards).toHaveLength(8);
  expect(game.ended[0]!.data.count).toBe(8);
});

it('普通自定义 Trigger.bind 同样取得执行时快照，不退回候选收集时的数据', async () => {
  const seen: number[] = [];
  const game = setup(() => ({
    triggers: [
      {
        id: 'custom',
        window: redeem,
        bind(self) {
          return {
            id: JSON.stringify([self.id, 'custom']),
            owner: self.owner,
            eligible: () => true,
            async run(ctx) {
              await self.end(ctx, 'custom');
              seen.push((self.data as Balance).count);
            },
          };
        },
      },
    ],
  }));
  await game.run();
  expect(seen).toEqual([8]);
});

it('绑定快照保持不变，显式当前值与结束结果用于按实际筹数兑现', async () => {
  const seen: number[] = [];
  const game = setup((self) => ({
    triggers: [
      on(redeem, {
        id: 'change-and-end',
        async effect(ctx) {
          const initial = self.current(ctx.world)!;
          seen.push(self.data.count);
          const updated = await self.update(ctx, { count: 12 });
          expect(self.current(ctx.world)).toStrictEqual(updated);
          expect(initial.data.count).toBe(8);
          seen.push(self.data.count);

          const ended = await self.end(ctx, 'redeemed');
          expect(ended).toStrictEqual(updated);
          expect(self.current(ctx.world)).toBeNull();
          expect(await self.end(ctx, 'again')).toBeNull();
          if (ended)
            await draw(ctx, { player: 'b', count: ended.data.count, reason: 'capacity:reward' });
          seen.push(self.data.count);
        },
      }),
    ],
  }));
  await game.run();
  expect(seen).toEqual([8, 8, 8]);
  expect(game.room.world.zone('b:hand').cards).toHaveLength(12);
  expect(game.ended).toHaveLength(1);
  expect(game.ended[0]!.data.count).toBe(12);
});

it('嵌套同实例结算各保留本次绑定快照，内层结束不把外层快照改成内层值', async () => {
  const seen: number[] = [];
  const game = setup((self) => ({
    triggers: [
      on(redeem, {
        id: 'outer',
        async effect(ctx: Context) {
          await self.update(ctx, { count: 12 });
          expect(self.current(ctx.world)?.data.count).toBe(12);
          await ctx.window(nested, null);
          expect(self.current(ctx.world)).toBeNull();
          seen.push(self.data.count);
        },
      }),
      on(nested, {
        id: 'inner',
        async effect(ctx) {
          const ended = await self.end(ctx, 'nested');
          expect(ended?.data.count).toBe(12);
          seen.push(self.data.count);
        },
      }),
    ],
  }));
  await game.run();
  expect(seen).toEqual([12, 8]);
  expect(game.ended[0]!.data.count).toBe(12);
});
