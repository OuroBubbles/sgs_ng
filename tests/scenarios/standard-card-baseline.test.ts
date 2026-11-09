import { expect, it } from 'vitest';
import { delayedCards, equipmentInSlot, moveCards, attackRange, distance } from '../../src/sdk';
import { blockSkill } from '../../src/rules/skills/skills';
import { equip } from '../../src/rules/cards/equipment';
import { installCounterspells } from '../../src/rules/cards/counter';
import { runPhase } from '../../src/rules/turn/turn';
import { withLifetime } from '../../src/rules/scopes/lifetime';
import { cardOffers, buildCard } from '../../src/rules/cards/card';
import type { SemanticCard, UseIntent } from '../../src/sdk';
import { card, cardGame, use, settled } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Damage } from '../../src/sdk';
import { Draw } from '../../src/rules/cards/draw';
import { Judgment } from '../../src/sdk';

const slash: SemanticCard = {
  name: 'standard:slash',
  suit: 'none',
  color: 'none',
  rank: 0,
  nature: 'normal',
  materials: [],
  source: null,
};
const physical = (id: string, targets: readonly string[] = []): UseIntent => ({
  actor: 'a',
  choice: { kind: 'physical', card: id },
  targets,
  timing: { kind: 'effect' },
});

it.each([
  ['chitu', false],
  ['dayuan', false],
  ['zixing', false],
  ['jueying', true],
  ['dilu', true],
  ['zhuahuangfeidian', true],
] as const)('%s 实际安装后只修正对应方向，材料/失效/卸下不借用距离', async (name, defensive) => {
  const game = cardGame({ hands: { a: [card('horse', name)] } });
  expect(await use(game, physical('horse'))).toMatchObject({ value: { kind: 'used' } });
  await game.room.run('distance', async (ctx) => {
    const slot = defensive ? 'defensive-horse' : 'offensive-horse';
    expect(equipmentInSlot(ctx, 'a', slot)).toEqual(['horse']);
    const distances = () => [distance(ctx, 'a', 'c'), distance(ctx, 'c', 'a')];
    expect(distances()).toEqual(defensive ? [2, 3] : [1, 2]);
    expect(distance(ctx, 'a', 'b')).toBe(1);
    expect(distance(ctx, 'a', 'a')).toBe(0);
    const asMaterial = { ...slash, materials: ['horse'] };
    expect(distance(ctx, 'a', 'c', asMaterial)).toBe(2);
    expect(distance(ctx, 'c', 'a', asMaterial)).toBe(2);
    const self = game.skills
      .bindings(ctx.world)
      .find(({ self }) => self.origin?.id === 'horse')!.self;
    await withLifetime(ctx, 'turn', (at, lifetime) => {
      blockSkill(at, self, lifetime);
      expect(distances()).toEqual([2, 2]);
    });
    expect(distances()).toEqual(defensive ? [2, 3] : [1, 2]);
    await moveCards(
      ctx,
      [{ cards: ['horse'], from: 'a:equipment', to: 'b:hand', place: 'bottom' }],
      'horse removed',
    );
    expect(distances()).toEqual([2, 2]);
  });
  settled(game);
});

it.each([
  ['crossbow', 1],
  ['spear', 3],
  ['qinggang_sword', 2],
  ['double_swords', 2],
  ['ice_sword', 2],
  ['blade', 3],
  ['axe', 3],
  ['halberd', 4],
  ['kylin_bow', 5],
] as const)('%s 的范围 %s 随实际装备归属、失效与材料实时变化', async (name, range) => {
  const game = cardGame({ hands: { a: [card('weapon', name)] } });
  expect(await use(game, physical('weapon'))).toMatchObject({ value: { kind: 'used' } });
  await game.room.run('range', async (ctx) => {
    expect(attackRange(ctx, 'a', slash)).toBe(range);
    expect(attackRange(ctx, 'b', slash)).toBe(1);
    expect(attackRange(ctx, 'a', { ...slash, materials: ['weapon'] })).toBe(1);
    const self = game.skills
      .bindings(ctx.world)
      .find(({ self }) => self.origin?.id === 'weapon')!.self;
    await withLifetime(ctx, 'turn', (at, lifetime) => {
      blockSkill(at, self, lifetime);
      expect(attackRange(at, 'a', slash)).toBe(1);
    });
    expect(attackRange(ctx, 'a', slash)).toBe(range);
    expect(await equip(ctx, { card: 'weapon', owner: 'b', from: 'a:equipment' })).toMatchObject({
      kind: 'equipped',
    });
    expect(attackRange(ctx, 'a', slash)).toBe(1);
    expect(attackRange(ctx, 'b', slash)).toBe(range);
  });
  settled(game);
});

it.each(['use', 'response'] as const)(
  '丈八 %s 配方只接受恰好两张本人手牌，交出后旧选择立即失效',
  async (purpose) => {
    const game = cardGame({
      hands: {
        a: [card('one', 'jink'), card('two', 'peach'), card('three', 'jink')],
        b: [card('foreign', 'jink')],
      },
      equipment: { a: [card('spear', 'spear'), card('equipped', 'eight_diagram')] },
    });
    await game.room.run('recipe', async (ctx) => {
      const offer = cardOffers(ctx, 'a', purpose).find((offer) => offer.label === '丈八蛇矛')!;
      expect(offer.kind).toBe('viewAs');
      const choice = offer.choice;
      if (!('instance' in choice)) throw new Error('Missing spear recipe.');
      const build = (materials: readonly string[]) =>
        buildCard(
          ctx,
          'a',
          {
            ...choice,
            kind: 'viewAs',
            instance: choice.instance,
            recipe: 'two-cards-slash',
            materials,
          },
          purpose,
        );
      expect(build(['one', 'two'])).toMatchObject({
        ok: true,
        value: { name: 'standard:slash', materials: ['one', 'two'] },
      });
      for (const invalid of [
        [],
        ['one'],
        ['one', 'two', 'three'],
        ['one', 'one'],
        ['one', 'foreign'],
        ['one', 'equipped'],
        ['one', 'spear'],
      ])
        expect(build(invalid).ok, JSON.stringify(invalid)).toBe(false);
      await moveCards(
        ctx,
        [{ cards: ['two'], from: 'a:hand', to: 'b:hand', place: 'bottom' }],
        'give',
      );
      expect(build(['one', 'two']).ok).toBe(false);
      expect(build(['one', 'three']).ok).toBe(true);
    });
    expect(game.room.history.facts(CardEvent.used)).toEqual([]);
    expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
    settled(game);
  },
);

it.each(['eight_diagram', 'nioh_shield'] as const)(
  '%s 真实使用仅安装到本人防具槽，普通转移后能力归属跟随实体',
  async (name) => {
    const game = cardGame({ hands: { a: [card('armor', name)] } });
    expect(await use(game, physical('armor', ['b']))).toMatchObject({
      value: { kind: 'unavailable' },
    });
    expect(game.room.world.position('armor')).toBe('a:hand');
    expect(await use(game, physical('armor'))).toMatchObject({ value: { kind: 'used' } });
    expect(equipmentInSlot(game.room, 'a', 'armor')).toEqual(['armor']);
    await game.room.run('transfer', async (ctx) => {
      await equip(ctx, { card: 'armor', owner: 'b', from: 'a:equipment' });
      const bindings = game.skills
        .bindings(ctx.world)
        .filter(({ self }) => self.origin?.id === 'armor');
      expect(bindings.map(({ self }) => self.owner)).toEqual(['b']);
      expect(equipmentInSlot(ctx, 'a', 'armor')).toEqual([]);
      expect(equipmentInSlot(ctx, 'b', 'armor')).toEqual(['armor']);
    });
    settled(game);
  },
);

it.each(['heart', 'diamond', 'club'] as const)(
  '闪电判定 %s 5 不造成雷电伤害，实体与原宣告传至下一角色',
  async (suit) => {
    const game = cardGame({
      hands: { a: [card('lightning', 'lightning')] },
      draw: [card('judgment', 'jink', suit, 5)],
    });
    await use(game, physical('lightning'));
    const original = delayedCards(game.room.world, 'a')[0]!.source;
    await game.room.run('judge', (ctx) => runPhase(ctx, 'a', 'judge'));
    expect(game.room.world.player('a').hp).toBe(4);
    expect(game.room.history.facts(Damage.dealt)).toEqual([]);
    expect(delayedCards(game.room.world, 'a')).toEqual([]);
    expect(delayedCards(game.room.world, 'b')).toMatchObject([
      {
        cards: ['lightning'],
        source: { useId: original.useId, actor: original.actor, card: original.card },
      },
    ]);
    expect(game.room.world.position('judgment')).toBe('discard');
    expect(game.room.history.facts(Judgment.finished)).toHaveLength(1);
    settled(game);
  },
);

it.each(['indulgence', 'lightning'] as const)(
  '%s 安装前拒绝错误本人/他人目标，安装后拒绝同名且不提前判定',
  async (name) => {
    const game = cardGame({ hands: { a: [card('first', name), card('second', name)] } });
    const self = name === 'lightning';
    expect(await use(game, physical('first', self ? ['b'] : ['a']))).toMatchObject({
      value: { kind: 'unavailable' },
    });
    expect(game.room.world.position('first')).toBe('a:hand');
    expect(await use(game, physical('first', self ? [] : ['b']))).toMatchObject({
      value: { kind: 'used' },
    });
    expect(await use(game, physical('second', self ? [] : ['b']))).toMatchObject({
      value: { kind: 'unavailable' },
    });
    expect(game.room.world.position('second')).toBe('a:hand');
    expect(delayedCards(game.room.world, self ? 'a' : 'b')).toHaveLength(1);
    expect(game.room.history.facts(Judgment.finished)).toEqual([]);
    settled(game);
  },
);

it('无中生有仅以本人为目标，实际摸两张并完成材料善后', async () => {
  const game = cardGame({
    hands: { a: [card('spell', 'ex_nihilo')] },
    draw: [card('one', 'slash'), card('two', 'jink'), card('three', 'peach')],
  });
  expect(await use(game, physical('spell', ['b']))).toMatchObject({
    value: { kind: 'unavailable' },
  });
  expect(game.room.world.position('spell')).toBe('a:hand');
  expect(await use(game, physical('spell', ['a']))).toMatchObject({ value: { kind: 'used' } });
  expect(game.room.world.zone('a:hand').cards).toEqual(['one', 'two']);
  expect(game.room.world.zone('draw').cards).toEqual(['three']);
  expect(game.room.world.zone('discard').cards).toEqual(['spell']);
  expect(game.room.history.facts(Draw.completed)).toHaveLength(1);
  settled(game);
});

it.each([1, 2])(
  '无中生有被 %s 层真实无懈反制：奇数不摸、偶数摸两张，材料独立善后',
  async (depth) => {
    const game = cardGame({
      hands: {
        a: [card('spell', 'ex_nihilo')],
        b: [card('first', 'nullification')],
        c: depth === 2 ? [card('second', 'nullification')] : [],
      },
      draw: [card('one', 'slash'), card('two', 'jink')],
    });
    installCounterspells(game.room);
    const running = use(game, physical('spell', ['a']));
    for (const material of ['first', 'second'].slice(0, depth)) {
      const request = await nextRequest(game.room);
      expect(request.kind).toBe('use-card');
      expect(
        game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: material }),
      ).toEqual({ kind: 'accepted' });
    }
    expect(await running).toMatchObject({
      value: { use: { effects: [{ state: depth === 1 ? 'cancelled' : 'resolved' }] } },
    });
    expect(game.room.world.zone('a:hand').cards).toEqual(depth === 1 ? [] : ['one', 'two']);
    expect(game.room.world.zone('draw').cards).toEqual(depth === 1 ? ['one', 'two'] : []);
    expect(game.room.world.zone('discard').cards).toEqual(
      depth === 1 ? ['first', 'spell'] : ['second', 'first', 'spell'],
    );
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(depth + 1);
    expect(game.room.history.facts(Draw.completed)).toHaveLength(depth === 1 ? 0 : 1);
    settled(game);
  },
);
