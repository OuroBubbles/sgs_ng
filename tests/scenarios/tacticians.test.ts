import { expect, it } from 'vitest';
import { playMatch } from '../fixtures/match';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { standardGeneralSkills } from '../../src/content/standard/generals';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { RoleMatch } from '../../src/app/offline/role-match';
import { projectMatch } from '../../src/app/offline/projection';
import { standardCards } from '../../src/content/standard/cards';
import {
  useDeclarations,
  defineSkill,
  modify,
  cardQueries,
  delayedCards,
  installCounterspells,
  kill,
  ownedCards,
  moveCards,
  Use,
  Target,
  Resolve,
  Cost,
} from '../../src/sdk';
import type { UseIntent, CardEffect, UsePlanView } from '../../src/sdk';
import { legacyGenerals } from '../fixtures/generals';
import { CardEvent } from '../../src/sdk';
import { Draw } from '../../src/rules/cards/draw';
import { Skill } from '../../src/sdk';
type Game = ReturnType<typeof cardGame>;
const source = { kind: 'general', id: 'test' } as const;
function scenario(options: Parameters<typeof cardGame>[0] = {}) {
  return cardGame({
    ...options,
    hands: { a: [], ...options.hands },
    skills: options.skills ?? standardGeneralSkills,
  });
}
async function grant(game: Game, skill: string, owner = 'a') {
  await game.room.run('grant', (ctx) => game.skills.grant(ctx, { owner, skill, source }));
}
async function answer(game: Game, value: unknown, kind = 'invoke') {
  const r = await nextRequest(game.room);
  expect(r.kind).toBe(kind);
  expect(game.room.decisions.submit(r.id, r.token, value)).toEqual({ kind: 'accepted' });
}
async function cancel(game: Game) {
  const r = await nextRequest(game.room);
  expect(game.room.decisions.cancel(r.id, r.token)).toEqual({ kind: 'accepted' });
}
const physical = (id: string, actor = 'a', targets = ['b']): UseIntent => ({
  actor,
  choice: { kind: 'physical', card: id },
  targets,
  timing: { kind: 'effect' },
});
function replay(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(useDeclarations(game.room.world)).toEqual([]);
  expect(game.room.world.snapshot.zones.filter((zone) => zone.kind === 'processing')).toEqual([]);
}

it.each([true, false])('集智普通锦囊接受=%s，在锦囊效果之前摸牌，宣告仅一次', async (accepted) => {
  const game = scenario({
    hands: { a: [card('trick', 'ex_nihilo')] },
    draw: [card('one', 'jink'), card('two', 'slash'), card('three', 'peach')],
  });
  await grant(game, 'standard:jizhi');
  const running = use(game, physical('trick', 'a', ['a']));
  await answer(game, accepted);
  await running;
  expect(ownedCards(game.room.world, 'a')).toHaveLength(accepted ? 3 : 2);
  const draws = game.room.history.facts(Draw.completed);
  expect(draws.map((f) => (f.data.detail as { input: { reason: string } }).input.reason)).toEqual(
    accepted ? ['standard:jizhi', 'standard:ex_nihilo'] : ['standard:ex_nihilo'],
  );
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  replay(game);
});
it.each(['converted', 'generated-material', 'delayed', 'equipment', 'basic'] as const)(
  '集智不响应 %s',
  async (kind) => {
    const name =
      kind === 'delayed'
        ? 'indulgence'
        : kind === 'equipment'
          ? 'crossbow'
          : kind === 'basic'
            ? 'slash'
            : 'jink';
    const game = scenario({ hands: { a: [card('fee', name, 'diamond')] } });
    await grant(game, 'standard:jizhi');
    let intent: UseIntent = physical('fee', 'a', kind === 'equipment' ? [] : ['b']);
    if (kind === 'converted') {
      await grant(game, 'standard:guose');
      intent = {
        ...intent,
        choice: {
          kind: 'viewAs',
          instance: game.room.world.snapshot.skills.find((s) => s.skill === 'standard:guose')!.id,
          recipe: 'diamond-indulgence',
          materials: ['fee'],
        },
      };
    }
    if (kind === 'generated-material')
      intent = {
        ...intent,
        targets: ['a'],
        choice: {
          kind: 'generated',
          face: { name: 'standard:ex_nihilo' },
          materials: ['fee'],
          reason: 'test',
        },
      };
    await use(game, intent);
    expect(game.room.decisions.pending).toEqual([]);
    expect(game.room.history.facts(Skill.invoked)).toEqual([]);
    replay(game);
  },
);
it('零材料虚拟普通锦囊仍能集智，接受后失去技能不撤销摸牌', async () => {
  const game = scenario({
    draw: [card('one', 'jink'), card('two', 'slash'), card('three', 'peach')],
  });
  await grant(game, 'standard:jizhi');
  game.room.on(Cost.paid, {
    id: 'lose',
    owner: null,
    eligible: (_ctx, receipt) => receipt.reason === 'standard:jizhi',
    async run(ctx) {
      await game.skills.revoke(ctx, 'a', 'standard:jizhi', source);
    },
  });
  const running = use(game, {
    ...physical('unused', 'a', ['a']),
    choice: {
      kind: 'generated',
      face: { name: 'standard:ex_nihilo' },
      materials: [],
      reason: 'test',
    },
  });
  await answer(game, true);
  await running;
  expect(ownedCards(game.room.world, 'a')).toHaveLength(3);
  replay(game);
});
it('真实无懈可击也是普通锦囊，集智摸牌发生在反制生效前', async () => {
  const game = scenario({
    hands: { a: [card('duel', 'duel')], b: [card('null', 'nullification')] },
    draw: [card('drawn', 'jink')],
  });
  installCounterspells(game.room, game.book);
  await grant(game, 'standard:jizhi', 'b');
  const running = use(game, physical('duel'));
  await answer(game, { kind: 'physical', card: 'null' }, 'use-card');
  await answer(game, true);
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(ownedCards(game.room.world, 'b')).toEqual(['drawn']);
  replay(game);
});
it('奇才只豁免锦囊距离，不改变真实距离或杀的范围', async () => {
  const game = scenario({
    hands: { a: [card('trick', 'snatch'), card('slash', 'slash')], c: [card('loot', 'jink')] },
  });
  await grant(game, 'standard:qicai');
  await game.room.run('inspect', (ctx) => {
    expect(game.book.distance(ctx, 'a', 'c')).toBe(2);
    expect(game.book.validateUse(ctx, physical('trick', 'a', ['c'])).ok).toBe(true);
    expect(game.book.validateUse(ctx, physical('slash', 'a', ['c'])).ok).toBe(false);
  });
  replay(game);
});
it('作者新建锦囊只需声明类别，集智和奇才无需增补牌名表', async () => {
  const game = scenario({
    hands: { a: [{ id: 'custom', name: 'author:trick', suit: 'club', rank: 8 }] },
    draw: [card('drawn', 'jink')],
    definitions: [
      {
        id: 'author:trick',
        type: 'trick',
        label: '作者锦囊',
        use: {
          count: { min: 1, max: 1 },
          target: (ctx, { request, target, book }) =>
            target !== request.actor && book.withinDistance(ctx, request, target, 1),
          resolve: () => {},
        },
      },
    ],
  });
  await grant(game, 'standard:jizhi');
  await grant(game, 'standard:qicai');
  const running = use(game, physical('custom', 'a', ['c']));
  await answer(game, true);
  await running;
  expect(ownedCards(game.room.world, 'a')).toEqual(['drawn']);
  replay(game);
});
it('奇才不绕过目标禁令、空区域和同名延时牌限制', async () => {
  const ban = defineSkill({
    id: 'test:ban',
    name: '禁止',
    triggers: [],
    modifiers: [
      modify(cardQueries.prohibitTarget, (_ctx, { input: request }) =>
        request.target === 'c' ? true : undefined,
      ),
    ],
  });
  const game = scenario({
    hands: {
      a: [card('trick', 'snatch'), card('delay', 'indulgence'), card('delay2', 'indulgence')],
      c: [card('loot', 'jink')],
    },
    skills: [...standardGeneralSkills, ban],
  });
  await grant(game, 'standard:qicai');
  await grant(game, ban.id);
  await game.room.run('inspect', (ctx) => {
    expect(game.book.validateUse(ctx, physical('trick', 'a', ['c'])).ok).toBe(false);
    expect(game.book.validateUse(ctx, physical('trick', 'a', ['b'])).ok).toBe(false);
  });
  await use(game, physical('delay'));
  expect(await use(game, physical('delay2'))).toMatchObject({ value: { kind: 'unavailable' } });
  replay(game);
});

it.each([0, 1, 2])('无双杀连续两闪，实际提供 %i 张', async (count) => {
  const game = scenario({
    hands: {
      a: [card('slash', 'slash')],
      b: Array.from({ length: count }, (_, i) => card(`j${i}`, 'jink')),
    },
  });
  await grant(game, 'standard:wushuang');
  const running = use(game, physical('slash'));
  for (let i = 0; i < count; i++)
    await answer(game, { kind: 'physical', card: `j${i}` }, 'card-response');
  const result = await running;
  expect(game.room.world.player('b').hp).toBe(count === 2 ? 4 : 3);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(count + 1);
  expect(result).toMatchObject({
    value: {
      use: {
        effects: [
          { responseRequirements: [{ actor: 'b', minimum: 2, reason: 'standard:wushuang' }] },
        ],
      },
    },
  });
  replay(game);
});
it('无双的声明在技能失去后保留，但没有响应机会时不强开两闪', async () => {
  for (const forbidden of [false, true]) {
    const game = scenario({
      hands: { a: [card('slash', 'slash')], b: [card('j1', 'jink'), card('j2', 'jink')] },
      ...(forbidden ? { policy: { responseTimes: () => 0 } } : {}),
    });
    await grant(game, 'standard:wushuang');
    game.room.on(Resolve.starting, {
      id: 'lose',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        await game.skills.revoke(ctx, 'a', 'standard:wushuang', source);
      },
    });
    const running = use(game, physical('slash'));
    if (!forbidden)
      for (const id of ['j1', 'j2'])
        await answer(game, { kind: 'physical', card: id }, 'card-response');
    await running;
    expect(game.room.world.player('b').hp).toBe(forbidden ? 3 : 4);
    replay(game);
  }
});
it.each(['a', 'b', 'both'])('无双决斗按响应方记录要求，来源=%s', async (owner) => {
  const game = scenario({
    hands: {
      a: [card('duel', 'duel'), card('a1', 'slash'), card('a2', 'slash')],
      b: [card('b1', 'slash'), card('b2', 'slash')],
    },
  });
  if (owner !== 'b') await grant(game, 'standard:wushuang');
  if (owner !== 'a') await grant(game, 'standard:wushuang', 'b');
  const running = use(game, physical('duel'));
  await answer(game, { kind: 'physical', card: 'b1' }, 'card-response');
  if (owner !== 'b') await answer(game, { kind: 'physical', card: 'b2' }, 'card-response');
  await answer(game, { kind: 'physical', card: 'a1' }, 'card-response');
  if (owner !== 'a') await answer(game, { kind: 'physical', card: 'a2' }, 'card-response');
  if (owner === 'b') await cancel(game);
  await running;
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.world.player('b').hp).toBe(3);
  replay(game);
});
it.each(['hand', 'equipment'])(
  '国色的方块 %s 进入持久延时区，保留牌面并防同名叠放',
  async (area) => {
    const game = scenario({
      hands: {
        a: [
          card('extra', 'jink', 'diamond'),
          ...(area === 'hand' ? [card('fee', 'jink', 'diamond')] : []),
        ],
      },
      equipment: area === 'equipment' ? { a: [card('fee', 'crossbow', 'diamond')] } : {},
    });
    await grant(game, 'standard:guose');
    const instance = game.room.world.snapshot.skills[0]!.id;
    const intent: UseIntent = {
      ...physical('unused'),
      choice: { kind: 'viewAs', instance, recipe: 'diamond-indulgence', materials: ['fee'] },
    };
    expect(await use(game, intent)).toMatchObject({ value: { kind: 'used' } });
    expect(delayedCards(game.room.world, 'b')).toMatchObject([
      {
        cards: ['fee'],
        source: { card: { name: 'standard:indulgence', suit: 'diamond', materials: ['fee'] } },
      },
    ]);
    expect(
      await use(game, {
        ...intent,
        choice: { kind: 'viewAs', instance, recipe: 'diamond-indulgence', materials: ['extra'] },
      }),
    ).toMatchObject({ value: { kind: 'unavailable' } });
    replay(game);
  },
);
it('国色拒绝非方块和他人材料，不改变材料位置', async () => {
  const game = scenario({
    hands: { a: [card('black', 'jink')], b: [card('other', 'jink', 'diamond')] },
  });
  await grant(game, 'standard:guose');
  for (const material of ['black', 'other'])
    expect(
      await use(game, {
        ...physical('unused'),
        choice: {
          kind: 'viewAs',
          instance: game.room.world.snapshot.skills[0]!.id,
          recipe: 'diamond-indulgence',
          materials: [material],
        },
      }),
    ).toMatchObject({ value: { kind: 'unavailable' } });
  expect(game.room.history.facts(CardEvent.used)).toEqual([]);
  replay(game);
});

function liuliGame(options: Parameters<typeof cardGame>[0] = {}) {
  return scenario({
    ...options,
    hands: { a: [card('slash', 'slash')], b: [card('fee', 'jink')], ...options.hands },
  });
}
it('流离费用与目标替换原子提交，忽略出杀者距离，保留杀的来源与材料', async () => {
  const game = liuliGame();
  await grant(game, 'standard:liuli', 'b');
  let checked = false;
  game.room.on(Cost.paid, {
    id: 'atomic',
    owner: null,
    eligible: (_ctx, receipt) => receipt.reason === 'standard:liuli',
    run(ctx) {
      checked = true;
      expect(ctx.world.position('fee')).toBe('discard');
      expect(useDeclarations(ctx.world)[0]!.effects).toMatchObject([
        { target: 'b', cancelled: 'standard:liuli' },
        { target: 'c', cancelled: null },
      ]);
    },
  });
  const running = use(game, physical('slash'));
  await answer(game, { cards: ['fee'], targets: ['c'] }, 'cards-targets');
  const result = await running;
  expect(checked).toBe(true);
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.player('c').hp).toBe(3);
  expect(result).toMatchObject({
    value: {
      use: {
        actor: 'a',
        card: { materials: ['slash'] },
        effects: [
          { target: 'b', state: 'cancelled' },
          { target: 'c', state: 'resolved' },
        ],
      },
    },
  });
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  replay(game);
});
it.each(['weapon', 'horse'])(
  '流离弃 %s 后不能借用离场装备的范围，联合反馈可先选目标',
  async (kind) => {
    const gear = kind === 'weapon' ? card('gear', 'spear') : card('gear', 'chitu');
    const game = liuliGame({ equipment: { b: [gear] } });
    await grant(game, 'standard:liuli', 'b');
    const running = use(game, physical('slash'));
    const r = await nextRequest(game.room);
    expect(r.kind).toBe('cards-targets');
    expect(game.room.decisions.preview(r.id, { cards: ['gear'], targets: ['d'] })).toMatchObject({
      valid: false,
    });
    expect(game.room.decisions.preview(r.id, { cards: ['fee'], targets: ['d'] })).toMatchObject({
      valid: true,
    });
    expect(
      game.room.decisions.submit(r.id, r.token, { cards: ['gear'], targets: ['d'] }).kind,
    ).toBe('rejected');
    expect(game.room.world.position('gear')).toBe('b:equipment');
    expect(game.room.decisions.submit(r.id, r.token, { cards: ['fee'], targets: ['d'] }).kind).toBe(
      'accepted',
    );
    await running;
    expect(game.room.world.player('d').hp).toBe(3);
    replay(game);
  },
);
it('流离不能给本人、出杀者、被禁止或已在本次杀内的目标', async () => {
  const game = liuliGame({
    policy: { attackRange: () => 3, prohibitTarget: (_ctx, _actor, target) => target === 'd' },
  });
  await grant(game, 'standard:liuli', 'b');
  game.room.on(Use.declared, {
    id: 'extra',
    owner: null,
    eligible: () => true,
    run(ctx, plan) {
      plan.addTarget(ctx, 'c', 'test');
    },
  });
  const running = use(game, physical('slash'));
  await cancel(game);
  await running;
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  expect(game.room.world.position('fee')).toBe('b:hand');
  expect(game.room.world.player('b').hp).toBe(3);
  replay(game);
});
it('流离取消不支付，新目标独立确认并继承来源无双', async () => {
  for (const redirected of [false, true]) {
    const game = liuliGame({ hands: { c: [card('j1', 'jink'), card('j2', 'jink')] } });
    await grant(game, 'standard:liuli', 'b');
    await grant(game, 'standard:wushuang');
    const running = use(game, physical('slash'));
    if (redirected) {
      await answer(game, { cards: ['fee'], targets: ['c'] }, 'cards-targets');
      for (const id of ['j1', 'j2'])
        await answer(game, { kind: 'physical', card: id }, 'card-response');
    } else {
      await cancel(game);
      await cancel(game);
    }
    await running;
    expect(game.room.world.player('c').hp).toBe(4);
    expect(game.room.world.player('b').hp).toBe(redirected ? 4 : 3);
    expect(game.room.world.position('fee')).toBe(redirected ? 'discard' : 'b:hand');
    replay(game);
  }
});
it('流离新目标的仁王盾仍生效，青釭剑规则仍随杀传递', async () => {
  for (const sword of [false, true]) {
    const game = liuliGame({
      equipment: {
        c: [card('armor', 'nioh_shield')],
        ...(sword ? { a: [card('sword', 'qinggang_sword')] } : {}),
      },
    });
    await grant(game, 'standard:liuli', 'b');
    game.room.on(Resolve.finished, {
      id: 'target-is-still-declared',
      owner: null,
      eligible: (_ctx, { effect }) => effect.target === 'c',
      run(ctx, { use }) {
        expect(use.targets).toEqual(['c']);
        expect(() => use.addTarget(ctx, 'c', 'implicit-repeat')).toThrow('repeat it explicitly');
      },
    });
    const running = use(game, physical('slash'));
    await answer(game, { cards: ['fee'], targets: ['c'] }, 'cards-targets');
    await running;
    expect(game.room.world.player('c').hp).toBe(sword ? 3 : 4);
    replay(game);
  }
});
it('支付后失去流离不撤销转移，目标死亡则跳过，不退费用', async () => {
  const game = liuliGame();
  await grant(game, 'standard:liuli', 'b');
  game.room.on(Cost.paid, {
    id: 'remove-and-kill',
    owner: null,
    eligible: (_ctx, receipt) => receipt.reason === 'standard:liuli',
    async run(ctx) {
      await game.skills.revoke(ctx, 'b', 'standard:liuli', source);
      await kill(ctx, {
        player: 'c',
        killer: null,
        reason: 'rule',
        cause: { kind: 'rule', seq: null, data: 'test' },
      });
    },
  });
  const running = use(game, physical('slash'));
  await answer(game, { cards: ['fee'], targets: ['c'] }, 'cards-targets');
  expect(await running).toMatchObject({
    value: { use: { effects: [{ state: 'cancelled' }, { target: 'c', state: 'skipped' }] } },
  });
  expect(game.room.world.position('fee')).toBe('discard');
  expect(game.room.world.player('b').hp).toBe(4);
  replay(game);
});

it.each(['mixed', 'all-liuli'])(
  '新武将 %s 对局由基础 AI 经正式决策走到胜负',
  async (kind) => {
    const lineup =
      kind === 'mixed'
        ? [18, 19, 20, 20, 15, 13, 9, 14].map((i) => legacyGenerals[i]!.id)
        : Array<string>(4).fill('standard:daqiao');
    const match = createOfflineMatch({ seed: 14, preset: 'standard:identity', lineup });
    await playMatch(match, { steps: 9000 });
  },
  60000,
);

it.each(['redirect', 'cancel'])('公开用牌目标 %s 与原宣告日志分别保留语义', async (kind) => {
  const match = new RoleMatch({
    id: 'public-targets',
    seed: 42,
    players: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
    roles: ['lord', 'rebel', 'loyalist', 'renegade'],
    content: {
      cards: standardCards,
      skills: standardGeneralSkills,
    },
    deck: [
      card('slash', 'slash'),
      card('fee', 'jink'),
      ...Array.from({ length: 24 }, (_, i) => card(`p${i}`, 'peach')),
    ],
  });
  await match.prepare();
  await match.room.run('fixture', async (ctx) => {
    const moves = [
      ['slash', 'a:hand'],
      ['fee', 'b:hand'],
    ]
      .filter(([id, to]) => ctx.world.position(id!) !== to)
      .map(([id, to]) => ({
        cards: [id!],
        from: ctx.world.position(id!),
        to: to!,
        place: 'bottom' as const,
      }));
    if (moves.length) await moveCards(ctx, moves, 'fixture');
    if (kind === 'redirect')
      await match.skills.grant(ctx, { owner: 'b', skill: 'standard:liuli', source });
  });
  const check = () => {
    const view = projectMatch(match, 'a', null);
    expect(
      view.actions.find((action) => action.kind === 'use' && action.actor === 'a')!.targets,
    ).toEqual([kind === 'redirect' ? 'c' : 'b']);
    expect(view.log.some((entry) => entry.text === 'a使用【杀】 → b')).toBe(true);
  };
  if (kind === 'cancel')
    match.room.on(Resolve.starting, {
      id: 'cancel',
      owner: null,
      eligible: () => true,
      run(ctx, { effect }) {
        effect.cancel(ctx, 'test:blocked');
        check();
      },
    });
  else
    match.room.on(Cost.paid, {
      id: 'check-atomic-projection',
      owner: null,
      eligible: (_ctx, receipt) => receipt.reason === 'standard:liuli',
      run() {
        check();
      },
    });
  const running = match.room.run('use', (ctx) => match.book.use(ctx, physical('slash')));
  if (kind === 'redirect') {
    const r = await nextRequest(match.room);
    expect(
      match.room.decisions.submit(r.id, r.token, { cards: ['fee'], targets: ['c'] }).kind,
    ).toBe('accepted');
  }
  await running;
  check();
  expect(useDeclarations(match.room.world)).toEqual([]);
  await match.room.run('later public history', (ctx) => {
    for (let i = 0; i < 110; i++)
      ctx.commit(Draw.completed, [], {
        kind: 'drawn',
        input: { player: 'a', count: 0, reason: 'test' },
        count: 0,
        cards: [],
        edits: [],
      });
  });
  const later = projectMatch(match, 'a', null);
  expect(
    later.actions.find((action) => action.kind === 'use' && action.actor === 'a')!.targets,
  ).toEqual([kind === 'redirect' ? 'c' : 'b']);
  expect(later.log.some((entry) => entry.text === 'a使用【杀】 → b')).toBe(false);
});
it('人类可以支付新的费用再次流离回旧目标，每次创建独立效果身份', async () => {
  const game = liuliGame({ hands: { c: [card('fee2', 'jink')] } });
  await grant(game, 'standard:liuli', 'b');
  await grant(game, 'standard:liuli', 'c');
  const confirmed: string[] = [];
  game.room.on(Target.confirming, {
    id: 'trace',
    owner: null,
    eligible: () => true,
    run(_ctx, { effect }) {
      confirmed.push(effect.effectId);
    },
  });
  const running = use(game, physical('slash'));
  await answer(game, { cards: ['fee'], targets: ['c'] }, 'cards-targets');
  await answer(game, { cards: ['fee2'], targets: ['b'] }, 'cards-targets');
  const result = await running;
  expect(confirmed).toHaveLength(3);
  expect(new Set(confirmed).size).toBe(3);
  expect(result).toMatchObject({
    value: {
      use: {
        effects: [
          { target: 'b', state: 'cancelled' },
          { target: 'c', state: 'cancelled' },
          { target: 'b', state: 'resolved' },
        ],
      },
    },
  });
  expect(game.room.world.player('b').hp).toBe(3);
  replay(game);
});
it('目标声明只在本次生存期可改写，纯查询与关闭后调用不能写入', async () => {
  const game = liuliGame();
  let retained: UsePlanView | undefined;
  let effect: CardEffect | undefined;
  game.room.on(Target.specified, {
    id: 'guard',
    owner: null,
    eligible: () => true,
    run(ctx, event) {
      retained = event.use;
      effect = event.effect;
      expect(
        event.use.canReplaceTarget(ctx, event.effect.effectId, 'c', { ignoreDistance: true }),
      ).toBe(true);
      expect(() =>
        ctx.query(() =>
          event.use.replaceTargetChange(ctx, event.effect.effectId, 'c', 'test', {
            ignoreDistance: true,
          }),
        ),
      ).toThrow('Pure queries');
      expect(() => ctx.query(() => event.effect.requireResponses(ctx, 'b', 2, 'test'))).toThrow(
        'Pure queries',
      );
    },
  });
  const running = use(game, physical('slash'));
  await cancel(game);
  await running;
  await game.room.run('late', (ctx) => {
    expect(retained!.canReplaceTarget(ctx, effect!.effectId, 'c')).toBe(false);
    expect(() => retained!.replaceTargetChange(ctx, effect!.effectId, 'c', 'late')).toThrow();
    expect(() => effect!.requireResponses(ctx, 'b', 2, 'late')).toThrow();
  });
  expect(retained!.snapshot().effects[0]!.state).toBe('resolved');
  replay(game);
});
