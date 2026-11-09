import { expect, it } from 'vitest';
import { cardGame, card, die } from '../fixtures/cards';
import { covenant } from '../../examples/content/covenant';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { damage, defineMark, on, skill, Turn } from '../../src/sdk';
import { handLimit } from '../../src/rules/cards/rule';
import { runTurn } from '../../src/rules/turn/turn';

/** 持续效果 = 带 skill 的标记：由使用它的技能登记，持有即生效，到期或回到初值即失效。 */
const pledge = skill('probe:pledge', '立约', '', covenant);

it('守约：上限 +1、只减一次伤害、宣告者离场不影响，受益者回合结束兑现并摸牌', async () => {
  const game = cardGame({ hands: { a: [] }, draw: [card('reward', 'jink')], skills: [pledge] });
  await game.room.run('a-turn', (ctx) =>
    runTurn(ctx, 'a', {
      phases: ['play'],
      body: (at) => covenant.set(at, 'b', { remaining: 1 }),
    }),
  );
  await game.room.run('source-death', (ctx) => die(ctx, 'a'));
  expect(game.room.inspect((ctx) => handLimit(ctx, 'b'))).toBe(5);
  for (const expected of [1, 2])
    await game.room.run('hit', async (ctx) => {
      const result = await damage(ctx, { from: 'c', to: 'b', amount: 2, nature: 'normal' });
      expect(result.hpLoss).toBe(expected);
    });
  expect(covenant.of(game.room.world, 'b')).toEqual({ remaining: 0 });
  expect(game.room.inspect((ctx) => handLimit(ctx, 'b'))).toBe(2);
  await game.room.run('b-turn', (ctx) => runTurn(ctx, 'b', { phases: ['finish'], body: () => {} }));
  expect(covenant.of(game.room.world, 'b')).toBeNull();
  expect(game.room.world.position('reward')).toBe('b:hand');
  expect(game.room.inspect((ctx) => handLimit(ctx, 'b'))).toBe(1);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.decisions.pending).toEqual([]);
});

it('受益者阵亡后效果不再生效，也不兑现', async () => {
  const game = cardGame({ draw: [card('reward', 'jink')], skills: [pledge] });
  await game.room.run('add', (ctx) => covenant.set(ctx, 'b', { remaining: 1 }));
  await game.room.run('death', (ctx) => die(ctx, 'b'));
  await game.room.run('b-turn', (ctx) => runTurn(ctx, 'b', { phases: ['finish'], body: () => {} }));
  expect(game.room.world.position('reward')).toBe('draw');
});

it('作用域标记的效果随回合到期，嵌套的他人回合里看不到外层回合的标记', async () => {
  const seen: string[] = [];
  const buff = defineMark('probe:buff', false, {
    scope: 'turn',
    skill: skill(
      'probe:buff',
      '增益',
      '',
      on(Turn.ending, {
        locked: true,
        effect: (_ctx, turn) => void seen.push(turn.owner),
      }),
    ),
  });
  const game = cardGame({ skills: [skill('probe:source', '来源', '', buff)] });
  await game.room.run('turn', (ctx) =>
    runTurn(ctx, 'a', {
      phases: ['play'],
      async body(at) {
        buff.set(at, 'a', true);
        await runTurn(at, 'c', { phases: ['finish'], body: () => {} });
      },
    }),
  );
  await game.room.run('next', (ctx) => runTurn(ctx, 'a', { phases: ['finish'], body: () => {} }));
  // 外层回合结束时生效一次；嵌套回合与下一回合都不再生效。
  expect(seen).toEqual(['a']);
});

it('使用同一标记对象的多个技能只登记一次；不同对象同 ID 报重复', () => {
  expect(() =>
    cardGame({ skills: [pledge, skill('probe:again', '再约', '', covenant)] }),
  ).not.toThrow();
  const twin = defineMark('covenant:promise', null, { skill: covenant.skill! });
  expect(() => cardGame({ skills: [pledge, skill('probe:twin', '双生', '', twin)] })).toThrow(
    'Duplicate skill definition',
  );
});
