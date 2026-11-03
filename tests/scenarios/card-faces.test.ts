import { expect, it } from 'vitest';
import {
  cardQueries,
  defineSkill,
  rulesOf,
  modify,
  moveCards,
  judge,
  runPhase,
  activeOffers,
  withRevealedCards,
  chooseOwnedCard,
  Judgment,
  Response,
  Cost,
} from '../../src/sdk';
import type { CardFaceChange, SkillDefinition, Context } from '../../src/sdk';
import { wusheng } from '../../src/content/standard/generals/guanyu';
import { qingguo } from '../../src/content/standard/generals/zhenji';
import { qixi } from '../../src/content/standard/generals/ganning';
import { longdan } from '../../src/content/standard/generals/zhaoyun';
import { jijiu } from '../../src/content/standard/generals/huatuo';
import { guose } from '../../src/content/standard/generals/daqiao';
import { guicai } from '../../src/content/standard/generals/simayi';
import { fanjian } from '../../src/content/standard/generals/zhouyu';
import { vermilion } from '../../src/content/workshop/faces';
import { card, cardGame, use, chooseAndActivate as activate } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { RoleMatch } from '../../src/app/offline/role-match';
import { standardCards } from '../../src/content/standard/cards';
import { cardView, projectMatch } from '../../src/app/offline/projection';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { decideBasic } from '../../src/app/offline/basic-agent';

type Game = ReturnType<typeof cardGame>;
const source = { kind: 'general', id: 'probe' } as const;
async function grant(game: Game, skill: string, owner = 'a') {
  await game.room.run('grant', (ctx) => game.skills.grant(ctx, { owner, skill, source }));
}
function clean(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(game.room.world.snapshot.states.some((state) => state.key === 'core:judgment-card')).toBe(
    false,
  );
}
function filter(id: string, change: CardFaceChange): SkillDefinition {
  return defineSkill({
    id,
    name: id,
    triggers: [],
    modifiers: [
      modify(cardQueries.cardFace, (_ctx, { input, self }) =>
        input.player === self.owner ? change : undefined,
      ),
    ],
  });
}

it('映绯统一当前手牌与装备面；印刷牌、他人手牌、公开牌堆不被改写', async () => {
  const game = cardGame({
    skills: [vermilion],
    hands: { a: [card('own', 'slash')], b: [card('other', 'slash')] },
    equipment: { a: [card('equip', 'eight_diagram')] },
    draw: [card('top', 'jink')],
  });
  await grant(game, vermilion.id);
  game.room.inspect((ctx) => {
    expect(game.book.face(ctx, 'own')).toMatchObject({ suit: 'heart', color: 'red' });
    expect(game.book.face(ctx, 'equip')).toMatchObject({ suit: 'heart', color: 'red' });
    expect(game.book.face(ctx, 'other').suit).toBe('spade');
    expect(game.book.face(ctx, 'top').suit).toBe('spade');
    expect(game.book.face(ctx, 'top', 'a').suit).toBe('heart');
    expect(game.book.face(ctx, 'top', 'b').suit).toBe('spade');
  });
  expect(game.room.world.card('own').suit).toBe('spade');
  clean(game);
});

it('牌转交后按新持有者查询，失去技能立即恢复原牌面，不回写实体', async () => {
  const game = cardGame({ skills: [vermilion], hands: { a: [card('own', 'jink')] } });
  await grant(game, vermilion.id);
  await grant(game, vermilion.id, 'b');
  await game.room.run('give', async (ctx) => {
    await moveCards(
      ctx,
      [{ cards: ['own'], from: 'a:hand', to: 'b:hand', place: 'bottom' }],
      'give',
    );
    expect(game.book.face(ctx, 'own').color).toBe('red');
    await game.skills.revoke(ctx, 'b', vermilion.id, source);
    expect(game.book.face(ctx, 'own').color).toBe('black');
    expect(ctx.world.card('own').suit).toBe('spade');
  });
  clean(game);
});

it.each([wusheng, jijiu])(
  '过滤后的黑桃可作为 $name 的红色材料，转换继承当前花色/颜色',
  async (skill) => {
    const game = cardGame({ skills: [vermilion, skill], hands: { a: [card('material', 'jink')] } });
    await grant(game, vermilion.id);
    await grant(game, skill.id);
    game.room.inspect((ctx) => {
      const offer = game.book.offers(ctx, 'a', 'use').find((entry) => entry.kind === 'viewAs');
      expect(offer?.materials).toEqual(['material']);
      if (!offer || !('instance' in offer.choice)) throw new Error('Missing recipe.');
      const built = game.book.build(
        ctx,
        'a',
        { kind: 'viewAs', ...offer.choice, materials: ['material'] },
        'use',
      );
      expect(built).toMatchObject({ ok: true, value: { suit: 'heart', color: 'red', rank: 7 } });
    });
    clean(game);
  },
);

it.each([qingguo, qixi])('过滤后的黑桃不再提供 $name 的黑色配方', async (skill) => {
  const game = cardGame({ skills: [vermilion, skill], hands: { a: [card('material', 'slash')] } });
  await grant(game, vermilion.id);
  await grant(game, skill.id);
  game.room.inspect((ctx) =>
    expect(
      game.book
        .offers(ctx, 'a', skill === qingguo ? 'response' : 'use')
        .filter((offer) => offer.kind === 'viewAs'),
    ).toEqual([]),
  );
  clean(game);
});

it('无花色与颜色独立：显式红色黑桃可武圣，转换继承红色而不重新从黑桃推成黑色', async () => {
  const red = filter('probe:red', { color: 'red' });
  const game = cardGame({
    skills: [red, wusheng, qingguo],
    hands: { a: [card('material', 'jink')] },
  });
  for (const id of [red.id, wusheng.id, qingguo.id]) await grant(game, id);
  game.room.inspect((ctx) => {
    const self = game.skills
      .bindings(ctx.world)
      .find((entry) => entry.self.skill === wusheng.id)!.self;
    expect(
      game.book.build(
        ctx,
        'a',
        { kind: 'viewAs', instance: self.id, recipe: 'red-slash', materials: ['material'] },
        'use',
      ),
    ).toMatchObject({ ok: true, value: { suit: 'spade', color: 'red' } });
    expect(game.book.offers(ctx, 'a', 'response').some((offer) => offer.label === '倾国')).toBe(
      false,
    );
  });
  clean(game);
});

it('过滤花色供国色，过滤名称供实体杀与龙胆，仍走正式牌型/材料校验', async () => {
  const diamond = filter('probe:diamond', { suit: 'diamond' });
  const rename = filter('probe:rename', { name: 'standard:slash' });
  const game = cardGame({
    skills: [diamond, rename, guose, longdan],
    hands: { a: [card('material', 'peach')] },
  });
  for (const id of [diamond.id, rename.id, guose.id, longdan.id]) await grant(game, id);
  game.room.inspect((ctx) => {
    expect(game.book.build(ctx, 'a', { kind: 'physical', card: 'material' }, 'use')).toMatchObject({
      ok: true,
      value: { name: 'standard:slash', suit: 'diamond', color: 'red' },
    });
    expect(
      game.book.offers(ctx, 'a', 'use').find((offer) => offer.label === '国色')?.materials,
    ).toEqual(['material']);
    expect(
      game.book.offers(ctx, 'a', 'response').find((offer) => offer.label === '龙胆 · 闪')
        ?.materials,
    ).toEqual(['material']);
  });
  expect(
    await use(game, {
      actor: 'a',
      choice: { kind: 'physical', card: 'material' },
      targets: ['b'],
      timing: { kind: 'effect' },
    }),
  ).toMatchObject({ value: { kind: 'used' } });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.card('material').name).toBe('standard:peach');
  clean(game);
});

it('已宣告红色杀在费用后失去映绯仍绕过仁王盾，快照不从处理区印刷牌重建', async () => {
  const game = cardGame({
    skills: [vermilion],
    hands: { a: [card('s', 'slash')] },
    equipment: { b: [card('shield', 'nioh_shield')] },
  });
  await grant(game, vermilion.id);
  game.room.on(Cost.paid, {
    id: 'lose-filter',
    owner: null,
    eligible: (_ctx, paid) => paid.cards.includes('s'),
    async run(ctx) {
      await game.skills.revoke(ctx, 'a', vermilion.id, source);
      expect(game.book.face(ctx, 's').color).toBe('black');
    },
  });
  await use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 's' },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts('card.used')[0]?.data.detail).toMatchObject({
    declaration: { card: { suit: 'heart', color: 'red' } },
  });
  clean(game);
});

it.each(['grant', 'revoke'] as const)(
  '判定在封口前 %s 过滤，实时牌面与最终匹配同步变化',
  async (action) => {
    const game = cardGame({ skills: [vermilion], draw: [card('top', 'jink')] });
    if (action === 'revoke') await grant(game, vermilion.id);
    game.room.on(Judgment.retrial, {
      id: 'change-filter',
      owner: null,
      eligible: () => true,
      async run(ctx, judgment) {
        expect(judgment.card?.suit).toBe(action === 'grant' ? 'spade' : 'heart');
        if (action === 'grant')
          await game.skills.grant(ctx, { owner: 'a', skill: vermilion.id, source });
        else await game.skills.revoke(ctx, 'a', vermilion.id, source);
        expect(judgment.card?.suit).toBe(action === 'grant' ? 'heart' : 'spade');
      },
    });
    await game.room.run('judge', async (ctx) =>
      expect(
        await judge(ctx, {
          player: 'a',
          reason: 'probe',
          match: (_at, card) => card.color === 'red',
        }),
      ).toMatchObject({
        matched: action === 'grant',
        card: { suit: action === 'grant' ? 'heart' : 'spade' },
      }),
    );
    clean(game);
  },
);

it('判定结束后失去过滤或将牌交给他人，不改变封口结果；接收手牌按新角色查询', async () => {
  const game = cardGame({ skills: [vermilion], draw: [card('top', 'slash')] });
  await grant(game, vermilion.id);
  game.room.on(Judgment.finished, {
    id: 'after-seal',
    owner: null,
    eligible: () => true,
    async run(ctx, result) {
      await game.skills.revoke(ctx, 'a', vermilion.id, source);
      await moveCards(
        ctx,
        [{ cards: ['top'], from: result.processing, to: 'b:hand', place: 'bottom' }],
        'take',
      );
      expect(result.card?.suit).toBe('heart');
      expect(game.book.face(ctx, 'top').suit).toBe('spade');
    },
  });
  await game.room.run('judge', async (ctx) =>
    expect(
      await judge(ctx, {
        player: 'a',
        reason: 'probe',
        match: (_at, card) => card.color === 'red',
      }),
    ).toMatchObject({ matched: true, card: { suit: 'heart' } }),
  );
  expect(game.room.world.position('top')).toBe('b:hand');
  clean(game);
});

it('他人红颜式手牌用于鬼才，打出为红、被判定者无过滤则最终判定仍为黑', async () => {
  const game = cardGame({
    skills: [vermilion, guicai],
    hands: { a: [card('replacement', 'slash')] },
    draw: [card('old', 'jink', 'heart')],
  });
  await grant(game, vermilion.id);
  await grant(game, 'standard:guicai');
  const seen: string[] = [];
  game.room.on(Response.finished, {
    id: 'played',
    owner: null,
    eligible: () => true,
    run(_ctx, response) {
      seen.push(response.card.color);
    },
  });
  const running = game.room.run('judge', (ctx) =>
    judge(ctx, {
      player: 'b',
      reason: 'probe',
      match: (_at, card) => card.color === 'red',
    }),
  );
  const request = await nextRequest(game.room);
  expect(request.data).toMatchObject({
    judgment: { alternatives: [{ id: 'replacement', suit: 'spade', color: 'black' }] },
  });
  expect(
    game.room.decisions.submit(request.id, request.token, { cards: ['replacement'], targets: [] })
      .kind,
  ).toBe('accepted');
  expect(await running).toMatchObject({
    value: { matched: false, card: { suit: 'spade', color: 'black' } },
  });
  expect(seen).toEqual(['red']);
  clean(game);
});

it.each([false, true])('字段组合与同值贡献不依赖授予顺序：reverse=%s', async (reverse) => {
  const defs = [
    filter('probe:suit', { suit: 'heart' }),
    filter('probe:rank', { rank: 13 }),
    filter('probe:same', { suit: 'heart', color: undefined }),
  ];
  const game = cardGame({ skills: defs });
  for (const def of reverse ? defs.slice().reverse() : defs) await grant(game, def.id);
  game.room.inspect((ctx) =>
    expect(game.book.face(ctx, 'slash1')).toMatchObject({ suit: 'heart', rank: 13, color: 'red' }),
  );
  clean(game);
});

it.each([false, true])('同字段冲突明确报错，不靠登记顺序静默覆盖：reverse=%s', async (reverse) => {
  const defs = [filter('probe:heart', { suit: 'heart' }), filter('probe:club', { suit: 'club' })];
  const game = cardGame({ skills: defs });
  for (const def of reverse ? defs.slice().reverse() : defs) await grant(game, def.id);
  expect(() => game.room.inspect((ctx) => game.book.face(ctx, 'slash1'))).toThrow(
    'Conflicting card face field: suit',
  );
  expect(game.room.world.card('slash1').suit).toBe('spade');
  clean(game);
});

it.each([
  { suit: 'bad' },
  { rank: -1 },
  { rank: 14 },
  { color: 'purple' },
  { name: '' },
  { name: 4 },
  { typo: 'heart' },
])('非法作者贡献被诊断且不提交规则事实：%j', async (change) => {
  const game = cardGame({ skills: [filter('probe:bad', change as CardFaceChange)] });
  await grant(game, 'probe:bad');
  const before = game.room.history.entries.length;
  expect(() => game.room.inspect((ctx) => game.book.face(ctx, 'slash1'))).toThrow(
    'Invalid card face contribution',
  );
  expect(game.room.history.entries).toHaveLength(before);
  clean(game);
});

it('查询贡献不能借助捕获的运行上下文提交、随机或注册后效', async () => {
  let captured: Context;
  const bad = defineSkill({
    id: 'probe:write',
    name: '禁止写入',
    triggers: [],
    modifiers: [
      modify(cardQueries.cardFace, () => {
        captured.commit('bad', [], {});
        return {};
      }),
    ],
  });
  const game = cardGame({ skills: [bad] });
  await grant(game, bad.id);
  await game.room.run('query', (ctx) => {
    captured = ctx;
    expect(() => game.book.face(ctx, 'slash1')).toThrow('Pure queries');
  });
  expect(game.room.history.facts('bad')).toHaveLength(0);
  clean(game);
});

it('UI 与 AI 读取相同当前牌面，不泄漏其他手牌；观察不改变规则证据', async () => {
  const match = new RoleMatch({
    id: 'face-view',
    seed: 2,
    players: [{ id: 'a', skills: [vermilion.id] }, { id: 'b' }],
    deck: Array.from({ length: 20 }, (_, i) => card(`c${i}`, 'slash')),
    content: {
      cards: standardCards,
      skills: [vermilion],
    },
  });
  await match.prepare();
  const id = match.room.world.zone('a:hand').cards[0]!;
  const before = match.room.history.entries.length;
  expect(cardView(match, id)).toMatchObject({ suit: '♥', color: 'red' });
  expect(observeAgent(match, 'a').hand[0]).toMatchObject({ suit: 'heart', color: 'red' });
  expect(observeAgent(match, 'a').players.find((seat) => seat.id === 'b')!.handCount).toBe(4);
  expect(Object.keys(observeAgent(match, 'a').players[1]!)).not.toContain('hand');
  expect(match.room.world.card(id).suit).toBe('spade');
  expect(match.room.history.entries).toHaveLength(before);
});

it('递归牌面查询明确诊断，退出后不残留求值标记；不同实体的组合查询可以完成', async () => {
  let recursive = true;
  const game = cardGame({
    skills: [
      defineSkill({
        id: 'probe:recursive',
        name: '组合读取',
        triggers: [],
        modifiers: [
          modify(cardQueries.cardFace, (ctx, { input }) => {
            if (input.card.id !== 'slash1') return undefined;
            const other = rulesOf(ctx).face(ctx, recursive ? 'slash1' : 'peach');
            return { suit: other.suit };
          }),
        ],
      }),
    ],
  });
  await grant(game, 'probe:recursive');
  expect(() => game.room.inspect((ctx) => game.book.face(ctx, 'slash1'))).toThrow(
    'Recursive card face query',
  );
  recursive = false;
  game.room.inspect((ctx) => expect(game.book.face(ctx, 'slash1').suit).toBe('heart'));
  clean(game);
});

it('反间按接收后的当前花色比较：未过滤黑桃交给映绯角色，猜红桃不受伤', async () => {
  const game = cardGame({ skills: [fanjian, vermilion], hands: { a: [card('gift', 'slash')] } });
  await grant(game, fanjian.id);
  await grant(game, vermilion.id, 'b');
  const running = game.room.run('fanjian', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      const offer = activeOffers(at, game.book, phase)[0]!;
      await activate(at, game.book, phase, {
        instance: offer.choice.instance,
        action: offer.choice.action,
      });
    }),
  );
  const target = await nextRequest(game.room);
  expect(
    game.room.decisions.submit(target.id, target.token, { cards: [], targets: ['b'] }).kind,
  ).toBe('accepted');
  const guess = await nextRequest(game.room);
  expect(game.room.decisions.submit(guess.id, guess.token, 'heart').kind).toBe('accepted');
  const pick = await nextRequest(game.room);
  const candidates = (pick.data as { preview: { cards: { id: string }[] } }).preview.cards;
  expect(
    game.room.decisions.submit(pick.id, pick.token, { cards: [candidates[0]!.id], targets: [] })
      .kind,
  ).toBe('accepted');
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('gift')).toBe('b:hand');
  expect(game.room.world.card('gift').suit).toBe('spade');
  expect(game.room.history.facts('damage.dealt')).toHaveLength(0);
  clean(game);
});

it('基础 AI 改判使用接收者的判定候选面，不把自己黑色手牌误认为能破坏对方红判定', async () => {
  const match = new RoleMatch({
    id: 'filtered-retrial',
    seed: 2,
    players: [
      { id: 'a', skills: ['standard:guicai'] },
      { id: 'b', skills: [vermilion.id] },
    ],
    roles: ['lord', 'rebel'],
    deck: Array.from({ length: 24 }, (_, i) => card(`r${i}`, 'slash')),
    content: {
      cards: standardCards,
      skills: [vermilion, guicai],
    },
  });
  await match.prepare();
  const running = match.room.run('judge', (ctx) =>
    judge(ctx, {
      player: 'b',
      reason: 'standard:indulgence',
      match: (_at, face) => face.suit === 'heart',
    }),
  );
  const request = await nextRequest(match.room);
  expect(observeAgent(match, 'a').hand.every((card) => card.suit === 'spade')).toBe(true);
  const answer = decideBasic(observeAgent(match, 'a'), request, (input) =>
    match.room.decisions.preview(request.id, input),
  );
  expect(answer).toEqual({ kind: 'cancel' });
  expect(match.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
  expect(await running).toMatchObject({
    value: { matched: true, card: { suit: 'heart' } },
  });
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('complete');
});

it('角色选牌按区域投影：暗手牌无牌面，公开装备使用不透明选项和正常花色点数，本人手牌保留过滤', async () => {
  const match = new RoleMatch({
    id: 'owned-faces',
    seed: 2,
    players: [{ id: 'a' }, { id: 'b', skills: [vermilion.id] }],
    deck: [
      card('secret', 'ex_nihilo'),
      { ...card('shown', 'crossbow'), rank: 13 },
      ...Array.from({ length: 20 }, (_, i) => card(`d${i}`, 'slash')),
    ],
    content: {
      cards: standardCards,
      skills: [vermilion],
    },
  });
  await match.prepare();
  await match.room.run('setup', (ctx) =>
    moveCards(
      ctx,
      ctx.world.snapshot.cards.map((card) => ({
        cards: [card.id],
        from: ctx.world.position(card.id),
        to: card.id === 'secret' ? 'b:hand' : card.id === 'shown' ? 'b:equipment' : 'draw',
        place: 'bottom' as const,
      })),
      'setup',
    ),
  );
  for (const actor of ['a', 'b']) {
    const running = match.room.run('choose', (ctx) =>
      chooseOwnedCard(ctx, {
        actor,
        target: 'b',
        areas: ['hand', 'equipment'],
        reason: 'probe',
        optional: true,
      }),
    );
    const request = await nextRequest(match.room);
    const factsBeforeView = match.room.history.facts().length;
    const decision = projectMatch(match, actor, request).decision;
    expect(decision).toMatchObject({
      cardGroups: [
        {
          id: 'hand',
          label: 'b · 手牌',
          cards: [{ face: actor === 'a' ? null : { name: '无中生有', suit: '♥', color: 'red' } }],
        },
        {
          id: 'equipment',
          label: 'b · 装备',
          cards: [{ face: { name: '诸葛连弩', suit: '♥', rank: 'K', color: 'red' } }],
        },
      ],
    });
    expect(request.data).not.toHaveProperty('cards');
    if (actor === 'a') expect(JSON.stringify(request.data)).not.toContain('secret');
    expect(projectMatch(match, actor === 'a' ? 'b' : 'a', request).decision).toBeNull();
    expect(projectMatch(match, null, request).decision).toBeNull();
    expect(match.room.history.facts()).toHaveLength(factsBeforeView);
    if (decision?.kind !== 'cards-targets') throw Error('Expected card choice.');
    const equipment = decision.cardGroups?.find((group) => group.id === 'equipment')?.cards[0];
    expect(equipment?.face?.id).toBe(equipment?.id);
    expect(equipment?.id).not.toBe('shown');
    expect(
      match.room.decisions.submit(request.id, request.token, { cards: ['shown'], targets: [] }),
    ).toMatchObject({ kind: 'rejected', reason: 'invalid' });
    expect(
      match.room.decisions.submit(request.id, request.token, {
        cards: [equipment?.id],
        targets: [],
      }),
    ).toEqual({ kind: 'accepted' });
    expect(await running).toMatchObject({
      value: { kind: 'chosen', card: 'shown', from: 'b:equipment' },
    });
  }
  match.room.abort('complete');
});

it('桌面用牌快照与日志不因失去过滤而改变，手中余牌即时恢复原花色', async () => {
  const match = new RoleMatch({
    id: 'face-history',
    seed: 2,
    players: [{ id: 'a', skills: [vermilion.id] }, { id: 'b' }],
    deck: Array.from({ length: 20 }, (_, i) => card(`h${i}`, 'slash')),
    content: {
      cards: standardCards,
      skills: [vermilion],
    },
  });
  await match.prepare();
  const id = match.room.world.zone('a:hand').cards[0]!;
  await match.room.run('use', async (ctx) => {
    await match.book.use(ctx, {
      actor: 'a',
      choice: { kind: 'physical', card: id },
      targets: ['b'],
      timing: { kind: 'effect' },
    });
  });
  const before = projectMatch(match, 'a', null);
  await match.room.run('remove', async (ctx) => {
    const instance = ctx.world.snapshot.skills.find(
      (skill) => skill.owner === 'a' && skill.skill === vermilion.id,
    )!;
    await match.skills.revoke(ctx, 'a', vermilion.id, instance.grants[0]!.source);
  });
  const after = projectMatch(match, 'a', null);
  expect(after.actions[0]?.card).toMatchObject({ suit: '♥', color: 'red' });
  expect(after.actions).toEqual(before.actions);
  expect(after.hand.every((card) => card.suit === '♠' && card.color === 'black')).toBe(true);
  expect(after.log.filter((entry) => entry.text.includes('使用【杀】'))).toEqual(
    before.log.filter((entry) => entry.text.includes('使用【杀】')),
  );
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('complete');
});

it('日志窗口之外的公开牌池仍存活，同次公开多张牌保留展示顺序', async () => {
  const match = new RoleMatch({
    id: 'public-history',
    seed: 2,
    players: [{ id: 'a' }, { id: 'b' }],
    roles: ['lord', 'rebel'],
    content: {
      cards: standardCards,
    },
    deck: Array.from({ length: 24 }, (_, i) => card(`public${i}`, 'slash')),
  });
  await match.prepare();
  await match.room.run('public pools', (ctx) =>
    withRevealedCards(ctx, { count: 2, reason: 'outer' }, async (outerCtx, outer) => {
      await withRevealedCards(outerCtx, { count: 2, reason: 'inner' }, async (at, inner) => {
        const gifts = at.world.zone('a:hand').cards;
        await moveCards(
          at,
          [{ cards: gifts, from: 'a:hand', to: 'b:hand', place: 'bottom' }],
          'public gift',
          {
            kind: 'cards.given',
            data: { actor: 'a', target: 'b', cards: gifts, count: gifts.length, visible: true },
          },
        );
        // 后续公开叙事足够长，但不能使仍在处理中的旧公开牌池消失。
        for (let i = 0; i < 110; i++)
          at.commit('draw.completed', [], { input: { player: 'a' }, cards: [] });
        const shown = projectMatch(match, null, null);
        expect(shown.log).toHaveLength(100);
        expect(shown.log.every((entry) => entry.text === 'a摸了 0 张牌')).toBe(true);
        expect(shown.actions.map((action) => action.card.id)).toEqual(gifts.slice(-3));
        expect(shown.pools.map((pool) => pool.zone)).toEqual([outer.zone, inner.zone]);
        const taken = outer.remaining()[0]!;
        await moveCards(
          at,
          [{ cards: [taken], from: outer.zone, to: 'b:hand', place: 'bottom' }],
          'take public card',
        );
        expect(projectMatch(match, null, null).pools[0]!.cards.map((card) => card.id)).toEqual(
          outer.remaining(),
        );
        expect(shown.pools[0]!.cards).toHaveLength(2);
      });
      expect(projectMatch(match, null, null).pools.map((pool) => pool.zone)).toEqual([outer.zone]);
    }),
  );
  expect(projectMatch(match, null, null).pools).toEqual([]);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('complete');
});
