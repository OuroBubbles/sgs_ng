import { expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { playMatch } from '../fixtures/match';
import { card, cardGame, use, grant } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { longdan } from '../../src/content/standard/generals/zhaoyun';
import { paoxiao } from '../../src/content/standard/generals/zhangfei';
import { qixi } from '../../src/content/standard/generals/ganning';
import { xiaoji } from '../../src/content/standard/generals/sunshangxiang';
import { standardGenerals } from '../../src/content/standard/generals';
import {
  runPhase,
  defineSkill,
  modify,
  cardQueries,
  moveCards,
  generalOf,
  roleOf,
} from '../../src/sdk';
import { createRoleMatch } from '../../src/host/content';
import { CardEvent } from '../../src/sdk';

const source = { kind: 'general', id: 'test' } as const;

it('龙胆将闪当杀沿用原花色点数、材料和伤害管线', async () => {
  const game = cardGame({
    hands: { a: [card('j', 'jink', 'diamond', 9)], b: [] },
    skills: [longdan],
  });
  const instance = (await grant(game, longdan.id)).id;
  await use(game, {
    actor: 'a',
    choice: { kind: 'viewAs', instance, recipe: 'jink-slash', materials: ['j'] },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('j')).toBe('discard');
  expect(game.room.history.facts(CardEvent.used)[0]!.data.detail).toMatchObject({
    declaration: {
      card: { name: 'standard:slash', suit: 'diamond', rank: 9, source: { skill: longdan.id } },
    },
  });
});

it('龙胆响应时杀可当闪，不能直接以实体杀响应闪，不能冒用对方的材料', async () => {
  const game = cardGame({
    hands: { a: [card('mine', 'slash')], b: [card('enemy', 'slash')] },
    skills: [longdan],
  });
  const instance = (await grant(game, longdan.id)).id;
  const running = use(game, {
    actor: 'b',
    choice: { kind: 'physical', card: 'enemy' },
    targets: ['a'],
    timing: { kind: 'effect' },
  });
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('card-response');
  expect(game.room.decisions.preview(request.id, { kind: 'physical', card: 'mine' })?.valid).toBe(
    false,
  );
  expect(
    game.room.decisions.preview(request.id, {
      kind: 'viewAs',
      instance,
      recipe: 'slash-jink',
      materials: ['enemy'],
    })?.valid,
  ).toBe(false);
  expect(
    game.room.decisions.submit(request.id, request.token, {
      kind: 'viewAs',
      instance,
      recipe: 'slash-jink',
      materials: ['mine'],
    }).kind,
  ).toBe('accepted');
  await running;
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.world.position('mine')).toBe('discard');
  expect(game.room.history.facts(CardEvent.used)[1]!.data.detail).toMatchObject({
    declaration: { card: { name: 'standard:jink', source: { skill: longdan.id } } },
  });
});

it('龙胆不绕过杀的距离与阶段次数，失去技能后旧配方立即不可用', async () => {
  const game = cardGame({
    hands: { a: [card('j1', 'jink'), card('j2', 'jink')], b: [] },
    skills: [longdan],
  });
  const instance = (await grant(game, longdan.id)).id;
  await game.room.run('phase', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      const intent = {
        actor: 'a',
        choice: { kind: 'viewAs', instance, recipe: 'jink-slash', materials: ['j1'] },
        targets: ['b'],
        timing: phase.playTiming(),
      } as const;
      expect(game.book.validateUse(at, { ...intent, targets: ['c'] }).ok).toBe(false);
      await game.book.use(at, intent);
      const next = { ...intent, choice: { ...intent.choice, materials: ['j2'] } };
      expect(game.book.validateUse(at, next).ok).toBe(false);
      await game.skills.revoke(at, 'a', longdan.id, source);
      expect(game.book.validateUse(at, { ...next, timing: { kind: 'effect' } }).ok).toBe(false);
    }),
  );
  expect(game.room.world.position('j2')).toBe('a:hand');
});

it('咆哮允许连续用杀但仍累计次数，失去后恢复已累计的上限，新阶段独立重置', async () => {
  const game = cardGame({
    hands: { a: [card('s1', 'slash'), card('s2', 'slash'), card('s3', 'slash')], b: [] },
    skills: [paoxiao],
  });
  await grant(game, paoxiao.id);
  await game.room.run('phases', async (ctx) => {
    await runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      for (const id of ['s1', 's2']) {
        const used = await game.book.use(at, {
          actor: 'a',
          choice: { kind: 'physical', card: id },
          targets: ['b'],
          timing: phase.playTiming(),
        });
        expect(used).toMatchObject({ kind: 'used' });
      }
      await game.skills.revoke(at, 'a', paoxiao.id, source);
      expect(
        game.book.validateUse(at, {
          actor: 'a',
          choice: { kind: 'physical', card: 's3' },
          targets: ['b'],
          timing: phase.playTiming(),
        }).ok,
      ).toBe(false);
    });
    await runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      expect(
        await game.book.use(at, {
          actor: 'a',
          choice: { kind: 'physical', card: 's3' },
          targets: ['b'],
          timing: phase.playTiming(),
        }),
      ).toMatchObject({ kind: 'used' });
    });
  });
  expect(game.room.world.player('b').hp).toBe(1);
});

it('奇袭可以使用受自弃禁止的黑色装备作材料，仍触发枭姬，目标弃牌另查目标权限', async () => {
  const locked = defineSkill({
    id: 'test:locked',
    name: '不能自弃',
    triggers: [],
    modifiers: [
      modify(cardQueries.prohibitDiscard, (_ctx, { input }) => input.actor === input.owner),
    ],
  });
  const game = cardGame({
    hands: { a: [], b: [card('victim', 'peach')] },
    equipment: { a: [card('weapon', 'spear', 'club')] },
    skills: [qixi, xiaoji, locked],
    draw: [card('d1', 'jink'), card('d2', 'jink')],
  });
  const instance = (await grant(game, qixi.id)).id;
  await grant(game, xiaoji.id);
  await grant(game, locked.id);
  const running = use(game, {
    actor: 'a',
    choice: { kind: 'viewAs', instance, recipe: 'black-dismantlement', materials: ['weapon'] },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  const invoke = await nextRequest(game.room);
  expect(invoke.kind).toBe('invoke');
  game.room.decisions.submit(invoke.id, invoke.token, true);
  const selection = await nextRequest(game.room);
  const candidate = (selection.data as { preview: { cards: { id: string }[] } }).preview.cards[0]!;
  game.room.decisions.submit(selection.id, selection.token, { cards: [candidate.id], targets: [] });
  await running;
  expect(game.room.world.position('weapon')).toBe('discard');
  expect(game.room.world.position('victim')).toBe('discard');
  expect(game.room.world.zone('a:hand').cards).toEqual(['d1', 'd2']);
  expect(game.room.history.facts(CardEvent.used)[0]!.data.detail).toMatchObject({
    declaration: { card: { name: 'standard:dismantlement', source: { skill: qixi.id } } },
  });
});

it('奇袭拒绝红色牌和已交出的旧材料，不复制一次选择时的持有权', async () => {
  const game = cardGame({
    hands: {
      a: [card('red', 'jink', 'heart'), card('black', 'jink')],
      b: [card('target', 'peach')],
    },
    skills: [qixi],
  });
  const instance = (await grant(game, qixi.id)).id;
  await game.room.run('check', async (ctx) => {
    const intent = {
      actor: 'a',
      choice: { kind: 'viewAs', instance, recipe: 'black-dismantlement', materials: ['red'] },
      targets: ['b'],
      timing: { kind: 'effect' },
    } as const;
    expect(game.book.validateUse(ctx, intent).ok).toBe(false);
    await moveCards(
      ctx,
      [{ cards: ['black'], from: 'a:hand', to: 'b:hand', place: 'bottom' }],
      'give',
    );
    expect(
      game.book.validateUse(ctx, { ...intent, choice: { ...intent.choice, materials: ['black'] } })
        .ok,
    ).toBe(false);
  });
  expect(game.room.history.facts(CardEvent.used)).toEqual([]);
});

it('标准武将保持原包顺序：登记表顺序决定大厅列表与按种子抽将，目录内武将文件全部登记', () => {
  const files = readdirSync(new URL('../../src/content/standard/generals/', import.meta.url))
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .map((name) => `standard:${name.slice(0, -3)}`);
  expect(standardGenerals.map((general) => general.id).sort()).toEqual(files.sort());
  expect(standardGenerals.map((general) => general.id.replace('standard:', ''))).toEqual([
    'guanyu',
    'huanggai',
    'sunshangxiang',
    'zhaoyun',
    'zhangfei',
    'ganning',
    'xiahoudun',
    'xuchu',
    'zhenji',
    'simayi',
    'guojia',
    'caocao',
    'zhangliao',
    'liubei',
    'huatuo',
    'sunquan',
    'lvmeng',
    'luxun',
    'huangyueying',
    'lvbu',
    'daqiao',
    'machao',
    'zhouyu',
    'diaochan',
    'zhugeliang',
  ]);
});

it('首六武将完整初始化，主公奖励叠加目录体力，空武将引用不会被当作机制角色', async () => {
  expect(standardGenerals).toHaveLength(25);
  const match = createRoleMatch({
    seed: 42,
    preset: 'standard:identity',
    lineup: standardGenerals.slice(0, 6).map((general) => general.id),
  });
  await match.prepare();
  for (const [index, player] of match.initial.players.entries()) {
    const general = standardGenerals[index]!;
    expect(generalOf(match.room.world, player.id)).toBe(general.id);
    expect(match.room.world.player(player.id).maxHp).toBe(
      general.maxHp + (roleOf(match.room.world, player.id) === 'lord' ? 1 : 0),
    );
  }
  expect(() =>
    createRoleMatch({ seed: 42, preset: 'standard:identity', lineup: ['', 'standard:guanyu'] }),
  ).toThrow(/Unknown general/);
  match.room.abort('done');
});

it('六名真实武将全部由基础 AI 经正式决策走到身份胜负', async () => {
  const match = createRoleMatch({
    seed: 42,
    preset: 'standard:identity',
    lineup: standardGenerals.slice(0, 6).map((general) => general.id),
  });
  await playMatch(match, { steps: 2000 });
}, 60_000);
