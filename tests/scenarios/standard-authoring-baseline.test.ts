import { expect, it } from 'vitest';
import { standardGeneralSkills } from '../../src/content/standard/generals';
import { loseHp, runPhase } from '../../src/sdk';
import type { CardChoice } from '../../src/sdk';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';

// 同样的数量/区域入口，对每个标准配方实测；成功用牌与响应另见各技能专项。
const recipes = [
  {
    skill: 'wusheng',
    recipe: 'red-slash',
    material: 'peach',
    suit: 'heart',
    name: 'slash',
    equipment: true,
    response: true,
    wrong: 'spade',
  },
  {
    skill: 'longdan',
    recipe: 'jink-slash',
    material: 'jink',
    suit: 'diamond',
    name: 'slash',
    equipment: false,
    response: true,
    wrong: 'slash',
  },
  {
    skill: 'longdan',
    recipe: 'slash-jink',
    material: 'slash',
    suit: 'spade',
    name: 'jink',
    equipment: false,
    response: true,
    wrong: 'jink',
  },
  {
    skill: 'qixi',
    recipe: 'black-dismantlement',
    material: 'jink',
    suit: 'spade',
    name: 'dismantlement',
    equipment: true,
    response: false,
    wrong: 'heart',
  },
  {
    skill: 'qingguo',
    recipe: 'black-jink',
    material: 'slash',
    suit: 'club',
    name: 'jink',
    equipment: false,
    response: true,
    wrong: 'heart',
  },
  {
    skill: 'guose',
    recipe: 'diamond-indulgence',
    material: 'slash',
    suit: 'diamond',
    name: 'indulgence',
    equipment: true,
    response: false,
    wrong: 'club',
  },
  {
    skill: 'jijiu',
    recipe: 'red-peach',
    material: 'jink',
    suit: 'heart',
    name: 'peach',
    equipment: true,
    response: false,
    wrong: 'spade',
  },
] as const;

function create(input: (typeof recipes)[number]) {
  const material = (id: string) => card(id, input.material, input.suit, 9);
  const game = cardGame({
    hands: {
      a: [
        material('one'),
        material('two'),
        ['slash', 'jink'].includes(input.wrong)
          ? card('wrong', input.wrong, input.suit, 9)
          : card('wrong', input.material, input.wrong as 'spade' | 'heart' | 'club', 9),
      ],
      b: [material('foreign')],
    },
    // 区域约束独立于印刷牌型，便于检验作者牌面过滤等组合仍不能扩张手牌范围。
    equipment: { a: [material('equipped')] },
    skills: standardGeneralSkills,
  });
  return game;
}

for (const input of recipes) {
  it(`${input.skill}/${input.recipe} 恰好一张本人合法手牌，数量/牌面/归属和打出用途分别校验`, async () => {
    const game = create(input);
    await game.room.run('grant', (ctx) =>
      game.skills.grant(ctx, {
        owner: 'a',
        skill: `standard:${input.skill}`,
        source: { kind: 'general', id: 'baseline' },
      }),
    );
    const instance = game.room.world.snapshot.skills[0]!.id;
    await game.room.run('inspect-recipe', (ctx) => {
      const before = ctx.world.snapshot;
      const facts = ctx.history.facts();
      const build = (materials: readonly string[], purpose: 'use' | 'response' = 'use') =>
        game.book.build(
          ctx,
          'a',
          { kind: 'viewAs', instance, recipe: input.recipe, materials },
          purpose,
        );
      expect(build(['one'])).toMatchObject({
        ok: true,
        value: { name: `standard:${input.name}`, suit: input.suit, rank: 9, materials: ['one'] },
      });
      for (const materials of [[], ['one', 'two'], ['one', 'one'], ['foreign'], ['wrong']])
        expect(build(materials).ok, JSON.stringify(materials)).toBe(false);
      expect(build(['one'], 'response').ok).toBe(input.response);
      expect(ctx.world.snapshot).toEqual(before);
      expect(ctx.history.facts()).toEqual(facts);
    });
  });

  it(`${input.skill}/${input.recipe} 装备区域材料按本技能边界处理`, async () => {
    const game = create(input);
    await game.room.run('grant', (ctx) =>
      game.skills.grant(ctx, {
        owner: 'a',
        skill: `standard:${input.skill}`,
        source: { kind: 'general', id: 'baseline' },
      }),
    );
    await game.room.run('inspect-equipment', (ctx) => {
      const instance = ctx.world.snapshot.skills[0]!.id;
      expect(
        game.book.build(
          ctx,
          'a',
          {
            kind: 'viewAs',
            instance,
            recipe: input.recipe,
            materials: ['equipped'],
          },
          'use',
        ).ok,
      ).toBe(input.equipment);
      expect(ctx.world.position('equipped')).toBe('a:equipment');
    });
  });
}

it.each(['wusheng', 'paoxiao'] as const)(
  '%s 实际授予后保留杀的距离/自身目标/完整闪使用，阶段额度按该技能分别生效',
  async (skill) => {
    const game = cardGame({
      hands: {
        a: [
          card('first', skill === 'wusheng' ? 'peach' : 'slash', 'heart'),
          card('second', skill === 'wusheng' ? 'peach' : 'slash', 'heart'),
        ],
        b: [card('defense', 'jink')],
      },
      skills: standardGeneralSkills,
    });
    await game.room.run('grant', (ctx) =>
      game.skills.grant(ctx, {
        owner: 'a',
        skill: `standard:${skill}`,
        source: { kind: 'general', id: 'baseline' },
      }),
    );
    const instance = game.room.world.snapshot.skills[0]!.id;
    const choice = (id: string): CardChoice =>
      skill === 'wusheng'
        ? { kind: 'viewAs', instance, recipe: 'red-slash', materials: [id] }
        : { kind: 'physical', card: id };
    const running = game.room.run('play', (ctx) =>
      runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
        const intent = {
          actor: 'a',
          choice: choice('first'),
          targets: ['b'],
          timing: phase.playTiming(),
        };
        expect(game.book.validateUse(at, { ...intent, targets: ['c'] }).ok).toBe(false);
        expect(game.book.validateUse(at, { ...intent, targets: ['a'] }).ok).toBe(false);
        expect((await game.book.use(at, intent)).kind).toBe('used');
        const second = { ...intent, choice: choice('second') };
        expect(game.book.validateUse(at, second).ok).toBe(skill === 'paoxiao');
        if (skill === 'paoxiao') expect((await game.book.use(at, second)).kind).toBe('used');
      }),
    );
    const response = await nextRequest(game.room);
    expect(response.player).toBe('b');
    expect(
      game.room.decisions.submit(response.id, response.token, {
        kind: 'physical',
        card: 'defense',
      }),
    ).toEqual({ kind: 'accepted' });
    await running;
    expect(game.room.world.player('b').hp).toBe(skill === 'paoxiao' ? 3 : 4);
    expect(game.room.world.position('second')).toBe(skill === 'paoxiao' ? 'discard' : 'a:hand');
    expect(
      game.room.history
        .facts('card.used')
        .map(
          (fact) =>
            (fact.data.detail as { declaration: { card: { name: string } } }).declaration.card.name,
        ),
    ).toContain('standard:jink');
    expect(game.room.history.facts('card.responded')).toHaveLength(0);
  },
);

it('急救在无本人回合的规则使用中可用红牌自疗，仍是实际使用桃', async () => {
  const game = cardGame({
    hands: { a: [card('material', 'jink', 'heart')] },
    skills: standardGeneralSkills,
  });
  await game.room.run('setup', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'a',
      skill: 'standard:jijiu',
      source: { kind: 'general', id: 'baseline' },
    });
    await loseHp(ctx, { player: 'a', amount: 1, reason: 'initial wound' });
  });
  const instance = game.room.world.snapshot.skills[0]!.id;
  expect(
    await use(game, {
      actor: 'a',
      choice: { kind: 'viewAs', instance, recipe: 'red-peach', materials: ['material'] },
      targets: ['a'],
      timing: { kind: 'effect' },
    }),
  ).toMatchObject({ value: { kind: 'used', use: { card: { name: 'standard:peach' } } } });
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.world.position('material')).toBe('discard');
  expect(game.room.history.facts('card.used')).toHaveLength(1);
  expect(game.room.history.facts('card.responded')).toHaveLength(0);
});
