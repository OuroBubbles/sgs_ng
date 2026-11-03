import { expect, it } from 'vitest';
import {
  defineSkill,
  on,
  equipmentCard,
  equipmentLost,
  equipmentInSlot,
  moveCards,
  equip,
  withLifetime,
  blockSkill,
  modify,
  defineQuery,
  cardQueries,
  kill,
  pay,
  CardBook,
  SkillBook,
  Cards,
  Cost,
} from '../../src/sdk';
import type {
  CardDefinition,
  Context,
  CardOffer,
  CardChoice,
  UseIntent,
  SemanticCard,
} from '../../src/sdk';
import { wusheng } from '../../src/content/standard/generals/guanyu';
import { standardCards } from '../../src/content/standard/cards';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { World } from '../../src/core/state/world';
import { Equipment } from '../../src/sdk';
import { Skill } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

const install = (id: string, actor = 'a'): UseIntent => ({
  actor,
  choice: { kind: 'physical', card: id },
  targets: [],
  timing: { kind: 'effect' },
});
const semantic: SemanticCard = {
  name: 'standard:slash',
  suit: 'spade',
  color: 'black',
  rank: 7,
  nature: 'normal',
  materials: [],
  source: null,
};

function transform(offer: CardOffer, materials: readonly string[]): CardChoice {
  if (!('instance' in offer.choice)) throw new Error('Expected a conversion offer.');
  return { kind: 'viewAs', ...offer.choice, materials };
}

it('装备自动以自己为目标，同槽替换一次提交，移牌后效立即看见新攻击范围', async () => {
  let rangeReads = 0;
  const spear = equipmentCard({
    id: 'test:spear',
    label: '丈八蛇矛',
    slot: 'weapon',
    get range() {
      return ++rangeReads <= 3 ? 3 : 0;
    },
  });
  const game = cardGame({
    hands: { a: [{ ...card('new', 'spear'), name: spear.id }] },
    equipment: { a: [card('old', 'crossbow')] },
    definitions: [spear],
  });
  expect(rangeReads).toBe(1);
  const observations: number[] = [];
  game.room.on(Cards.moved, {
    id: 'observe',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.to === 'a:equipment'),
    run(ctx) {
      expect(ctx.world.position('old')).toBe('discard');
      expect(game.room.history.facts(Equipment.equipped)).toHaveLength(1);
      expect(equipmentInSlot(ctx.world, game.book, 'a', 'weapon')).toEqual(['new']);
      observations.push(game.book.attackRange(ctx, 'a', semantic));
    },
  });
  expect(await use(game, { ...install('new'), targets: ['a'] })).toMatchObject({
    value: { kind: 'unavailable' },
  });
  expect(await use(game, install('new'))).toMatchObject({
    value: { use: { effects: [{ target: 'a', state: 'resolved' }] } },
  });
  expect(observations).toEqual([3]);
  expect(game.room.world.position('new')).toBe('a:equipment');
  expect(game.room.world.snapshot.skills).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('普通移牌转移装备后，能力跟随实体与持有者，不需要安装/卸载通知', async () => {
  const game = cardGame({
    hands: {
      a: [card('a1', 'jink'), card('a2', 'peach')],
      b: [card('b1', 'jink'), card('b2', 'peach')],
    },
    equipment: { a: [card('weapon', 'spear')] },
  });
  await game.room.run('transfer', async (ctx) => {
    const old = game.book.offers(ctx, 'a', 'use').find((offer) => offer.label === '丈八蛇矛')!;
    expect(old).toBeDefined();
    await equip(ctx, game.book, { card: 'weapon', owner: 'b', from: 'a:equipment' });
    expect(game.book.offers(ctx, 'a', 'use').some((offer) => offer.label === '丈八蛇矛')).toBe(
      false,
    );
    expect(
      game.book.offers(ctx, 'b', 'response').find((offer) => offer.label === '丈八蛇矛')?.count,
    ).toEqual({ min: 2, max: 2 });
    expect(game.book.attackRange(ctx, 'a', semantic)).toBe(1);
    expect(game.book.attackRange(ctx, 'b', semantic)).toBe(3);
    expect(
      game.book.validateUse(ctx, {
        actor: 'a',
        choice: transform(old, ['a1', 'a2']),
        targets: ['b'],
        timing: { kind: 'effect' },
      }),
    ).toMatchObject({ ok: false });
  });
});

it('诸葛连弩允许阶段内连续用杀，卸下立即恢复已累计的次数限制', async () => {
  const game = cardGame({
    hands: { a: [card('s1', 'slash'), card('s2', 'slash'), card('s3', 'slash')] },
    equipment: { a: [card('weapon', 'crossbow')] },
  });
  await game.room.run('play', (ctx) =>
    withLifetime(ctx, 'play', async (at, phase) => {
      for (const id of ['s1', 's2'])
        expect(
          await game.book.use(at, {
            ...install(id),
            targets: ['b'],
            timing: { kind: 'play', owner: 'a', phase },
          }),
        ).toMatchObject({ kind: 'used' });
      await moveCards(
        at,
        [{ cards: ['weapon'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
        'remove',
      );
      expect(
        game.book.validateUse(at, {
          ...install('s3'),
          targets: ['b'],
          timing: { kind: 'play', owner: 'a', phase },
        }),
      ).toMatchObject({ ok: false, reason: 'Usage limit reached.' });
      expect(at.world.position('s3')).toBe('a:hand');
    }),
  );
  expect(game.room.world.player('b').hp).toBe(2);
});

it.each(['spear', 'chitu'])('以红色 %s 作杀材料时，不能继续借用其距离/攻击范围', async (name) => {
  const game = cardGame({
    hands: { a: [] },
    equipment: { a: [card('weapon', name, 'heart')] },
    skills: [wusheng],
  });
  await game.room.run('probe', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'a',
      skill: wusheng.id,
      source: { kind: 'general', id: 'guan-yu' },
    });
    const offer = game.book.offers(ctx, 'a', 'use').find((offer) => offer.label === '武圣')!;
    const choice = {
      kind: 'viewAs' as const,
      ...offer.choice,
      materials: ['weapon'],
    } as UseIntent['choice'];
    expect(
      game.book.validateUse(ctx, { actor: 'a', choice, targets: ['c'], timing: { kind: 'effect' } })
        .ok,
    ).toBe(false);
    expect(
      game.book.validateUse(ctx, { actor: 'a', choice, targets: ['b'], timing: { kind: 'effect' } })
        .ok,
    ).toBe(true);
  });
});

it('把连弩当第二张杀的材料，不能借用即将失去的无限次数', async () => {
  const game = cardGame({
    hands: { a: [card('s1', 'slash')] },
    equipment: { a: [card('weapon', 'crossbow', 'heart')] },
    skills: [wusheng],
  });
  await game.room.run('probe', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'a',
      skill: wusheng.id,
      source: { kind: 'general', id: 'guan-yu' },
    });
    await withLifetime(ctx, 'play', async (at, phase) => {
      await game.book.use(at, {
        ...install('s1'),
        targets: ['b'],
        timing: { kind: 'play', owner: 'a', phase },
      });
      const offer = game.book.offers(at, 'a', 'use').find((offer) => offer.label === '武圣')!;
      const choice = {
        kind: 'viewAs' as const,
        ...offer.choice,
        materials: ['weapon'],
      } as UseIntent['choice'];
      expect(
        game.book.validateUse(at, {
          actor: 'a',
          choice,
          targets: ['b'],
          timing: { kind: 'play', owner: 'a', phase },
        }),
      ).toMatchObject({ ok: false });
      expect(at.world.position('weapon')).toBe('a:equipment');
    });
  });
});

it('正负马按来源相加，两个马槽独立替换，距离至少为一且自己为零', async () => {
  const game = cardGame({
    hands: { a: [card('new', 'dayuan')] },
    equipment: { a: [card('off', 'chitu'), card('def', 'dilu')], c: [card('other', 'jueying')] },
  });
  await game.room.run('distance', async (ctx) => {
    expect(game.book.distance(ctx, 'a', 'c')).toBe(2);
    expect(game.book.distance(ctx, 'a', 'b')).toBe(1);
    expect(game.book.distance(ctx, 'b', 'a')).toBe(2);
    expect(game.book.distance(ctx, 'a', 'a')).toBe(0);
    await game.book.use(ctx, install('new'));
    expect(ctx.world.position('off')).toBe('discard');
    expect(equipmentInSlot(ctx.world, game.book, 'a', 'defensive-horse')).toEqual(['def']);
    expect(equipmentInSlot(ctx.world, game.book, 'a', 'offensive-horse')).toEqual(['new']);
  });
});

it.each([
  ['heart', 'diamond', 'red'],
  ['heart', 'heart', 'red'],
  ['club', 'spade', 'black'],
  ['heart', 'club', 'none'],
] as const)('丈八两张 %s/%s 手牌可作为一次完整杀，颜色为 %s', async (a, b, color) => {
  const game = cardGame({
    hands: { a: [card('x', 'jink', a), card('y', 'peach', b)] },
    equipment: { a: [card('weapon', 'spear')] },
  });
  await game.room.run('spear', async (ctx) => {
    const offer = game.book.offers(ctx, 'a', 'use').find((offer) => offer.label === '丈八蛇矛')!;
    const result = await game.book.use(ctx, {
      actor: 'a',
      choice: { kind: 'viewAs', ...offer.choice, materials: ['x', 'y'] } as UseIntent['choice'],
      targets: ['c'],
      timing: { kind: 'effect' },
    });
    expect(result).toMatchObject({
      use: {
        card: { name: 'standard:slash', suit: 'none', color, materials: ['x', 'y'], rank: 0 },
      },
    });
  });
  expect(game.room.world.player('c').hp).toBe(3);
  expect(game.room.world.zone('discard').cards).toEqual(['x', 'y']);
  expect(game.room.world.position('weapon')).toBe('a:equipment');
});

it('丈八复用同一响应管线，装备失效后转换与范围一起关闭，到期一起恢复', async () => {
  const game = cardGame({
    hands: { a: [card('x', 'jink'), card('y', 'peach')] },
    equipment: { a: [card('weapon', 'spear')] },
  });
  await game.room.run('block', async (ctx) => {
    const self = game.skills
      .bindings(ctx.world)
      .find(({ self }) => self.origin?.id === 'weapon')!.self;
    await withLifetime(ctx, 'turn', (at, lifetime) => {
      blockSkill(at, self, lifetime);
      expect(game.book.offers(at, 'a', 'response')).toEqual([
        expect.objectContaining({ kind: 'physical', label: '闪' }),
      ]);
      expect(game.book.attackRange(at, 'a', semantic)).toBe(1);
    });
    expect(game.book.attackRange(ctx, 'a', semantic)).toBe(3);
  });
  const running = game.room.run('respond', (ctx) =>
    game.book.respond(ctx, 'a', ['standard:slash'], {
      useId: 'duel',
      effectId: 'duel:b',
      actor: 'b',
      target: 'a',
      card: semantic,
      processing: 'unused',
    }),
  );
  const request = await nextRequest(game.room);
  const offer = (request.data as { offers: { label: string; choice: object }[] }).offers.find(
    (item) => item.label === '丈八蛇矛',
  )!;
  expect(
    game.room.decisions.submit(request.id, request.token, {
      kind: 'viewAs',
      ...offer.choice,
      materials: ['x', 'y'],
    }).kind,
  ).toBe('accepted');
  expect(await running).toMatchObject({ value: { kind: 'responded' } });
});

function lossDefinition(allowDead = false): CardDefinition {
  return equipmentCard({
    id: 'probe:loss',
    label: '离场探针',
    slot: 'armor',
    skill: defineSkill({
      id: 'probe:loss-ability',
      name: '离场探针',
      triggers: [
        on(Cards.moved, {
          locked: true,
          id: 'lost',
          retain: (ctx, moved, self) =>
            (allowDead || ctx.world.player(self.owner).alive) &&
            equipmentLost(ctx.world, moved, self),
          when: (ctx, moved, self) => equipmentLost(ctx.world, moved, self),
          effect(ctx, _event, self) {
            ctx.commit(testTiming('probe:equipment-lost'), [], {
              owner: self.owner,
              card: self.origin!.id,
            });
          },
        }),
      ],
    }),
  });
}

it('离场能力从移动前快照补入，支付材料后也触发，普通手牌移动不触发', async () => {
  const definition = lossDefinition();
  const game = cardGame({
    hands: { a: [card('hand', 'jink')] },
    equipment: { a: [{ ...card('armor', 'slash'), name: definition.id }] },
    definitions: [definition],
  });
  await game.room.run('loss', async (ctx) => {
    await moveCards(
      ctx,
      [{ cards: ['hand'], from: 'a:hand', to: 'discard', place: 'bottom' }],
      'not-equipment',
    );
    expect(game.room.history.facts(testTiming('probe:equipment-lost'))).toHaveLength(0);
    await moveCards(
      ctx,
      [{ cards: ['armor'], from: 'a:equipment', to: 'a:hand', place: 'bottom' }],
      'lost',
    );
    expect(game.room.history.facts(testTiming('probe:equipment-lost'))).toHaveLength(1);
    await equip(ctx, game.book, { card: 'armor', owner: 'a', from: 'a:hand' });
  });
  // 普通费用接口同样经 cardsMoved；无需装备专用卸载函数。
  await game.room.run('pay', (ctx) =>
    pay(ctx, { actor: 'a', cards: ['armor'], to: 'discard', reason: 'probe' }),
  );
  expect(game.room.history.facts(testTiming('probe:equipment-lost'))).toHaveLength(2);
  expect(game.room.world.snapshot.skills).toHaveLength(0);
});

it.each([false, true])('埋葬移牌保留装备离场事实，是否允许死亡来源执行为 %s', async (allowDead) => {
  const definition = lossDefinition(allowDead);
  const game = cardGame({
    hands: { a: [] },
    equipment: { a: [{ ...card('armor', 'slash'), name: definition.id }] },
    definitions: [definition],
  });
  await game.room.run('death', (ctx) =>
    kill(ctx, {
      player: 'a',
      killer: null,
      reason: 'rule',
      cause: { kind: 'rule', seq: null, data: null },
    }),
  );
  expect(game.room.history.facts(testTiming('probe:equipment-lost'))).toHaveLength(
    allowDead ? 1 : 0,
  );
  expect(game.room.world.position('armor')).toBe('discard');
});

it('装备材料宣告后被取走，不安装新装备，也不弃置原装备或再次善后材料', async () => {
  const game = cardGame({
    hands: { a: [card('new', 'spear')] },
    equipment: { a: [card('old', 'crossbow')] },
  });
  game.room.on(Cost.paid, {
    id: 'take',
    owner: null,
    eligible: (_ctx, receipt) => receipt.cards.includes('new'),
    async run(ctx) {
      await moveCards(
        ctx,
        [{ cards: ['new'], from: ctx.world.position('new'), to: 'b:hand', place: 'bottom' }],
        'take-away',
      );
    },
  });
  await use(game, install('new'));
  expect(game.room.world.position('new')).toBe('b:hand');
  expect(game.room.world.position('old')).toBe('a:equipment');
  expect(game.room.history.facts(Equipment.equipped)).toHaveLength(0);
});

it('新装备在移牌后效中被取走，装备事实仍在真实安装的提交处，查询立即停止', async () => {
  const game = cardGame({ hands: { a: [card('weapon', 'spear')] } });
  game.room.on(Cards.moved, {
    id: 'take-installed',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.to === 'a:equipment'),
    async run(ctx) {
      expect(game.room.history.facts(Equipment.equipped)).toHaveLength(1);
      expect(game.book.attackRange(ctx, 'a', semantic)).toBe(3);
      await moveCards(
        ctx,
        [{ cards: ['weapon'], from: 'a:equipment', to: 'b:hand', place: 'bottom' }],
        'take',
      );
      expect(game.book.attackRange(ctx, 'a', semantic)).toBe(1);
    },
  });
  expect(await use(game, install('weapon'))).toMatchObject({ value: { kind: 'used' } });
  expect(game.room.world.position('weapon')).toBe('b:hand');
  const installed = game.room.history.facts(Equipment.equipped)[0]!;
  const moved = game.room.history.facts(Cards.moved).find((fact) => fact.seq > installed.seq)!;
  expect(moved.seq).toBeGreaterThan(installed.seq);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('已失效装备的离场候选不能绕过失效；到期重新装回后可再次发动', async () => {
  const definition = lossDefinition();
  const game = cardGame({
    hands: { a: [] },
    equipment: { a: [{ ...card('armor', 'slash'), name: definition.id }] },
    definitions: [definition],
  });
  await game.room.run('blocked-loss', async (ctx) => {
    const self = game.skills
      .bindings(ctx.world)
      .find(({ self }) => self.origin?.id === 'armor')!.self;
    await withLifetime(ctx, 'turn', async (at, lifetime) => {
      blockSkill(at, self, lifetime);
      await moveCards(
        at,
        [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
        'blocked',
      );
      expect(game.room.history.facts(testTiming('probe:equipment-lost'))).toHaveLength(0);
    });
    await equip(ctx, game.book, { card: 'armor', owner: 'a', from: 'discard' });
    await moveCards(
      ctx,
      [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
      'active',
    );
    expect(game.room.history.facts(testTiming('probe:equipment-lost'))).toHaveLength(1);
  });
});

it('技能与装备共同贡献纯查询，预览不提交；写操作会被查询守卫拒绝', async () => {
  const score = defineQuery<{ readonly actor: string }, number>('probe:score', (a, b) => a + b);
  const general = defineSkill({
    id: 'probe:general',
    name: '查询',
    triggers: [],
    modifiers: [
      modify(score, (_ctx, { input, self }) => (input.actor === self.owner ? 2 : undefined)),
    ],
  });
  const armor = equipmentCard({
    id: 'probe:query',
    label: '查询甲',
    slot: 'armor',
    skill: defineSkill({
      id: 'probe:armor',
      name: '甲',
      triggers: [],
      modifiers: [modify(score, () => 3)],
    }),
  });
  const game = cardGame({
    hands: { a: [] },
    equipment: { a: [{ ...card('armor', 'slash'), name: armor.id }] },
    definitions: [armor],
    skills: [general],
  });
  await game.room.run('query', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'a',
      skill: general.id,
      source: { kind: 'general', id: 'g' },
    });
    const revision = ctx.world.snapshot.revision;
    expect(game.skills.query(ctx, score, { actor: 'a' }, 1)).toBe(6);
    expect(ctx.world.snapshot.revision).toBe(revision);
    await moveCards(
      ctx,
      [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
      'remove',
    );
    expect(game.skills.query(ctx, score, { actor: 'a' }, 1)).toBe(3);
  });
  const impure = defineSkill({
    id: 'probe:impure',
    name: '非法查询',
    triggers: [],
    modifiers: [modify(cardQueries.handLimitCorrection, (ctx) => ctx.randomInt(2))],
  });
  const broken = cardGame({ skills: [impure] });
  await expect(
    broken.room.run('impure', async (ctx) => {
      await broken.skills.grant(ctx, {
        owner: 'a',
        skill: impure.id,
        source: { kind: 'general', id: 'g' },
      });
      broken.book.handLimit(ctx, 'a');
    }),
  ).rejects.toThrow('Pure queries cannot perform rule operations.');
});

it('禁止目标查询阻止装备使用，不能以过滤成零目标的方式支付掉装备', async () => {
  const skill = defineSkill({
    id: 'probe:prohibit',
    name: '禁止',
    triggers: [],
    modifiers: [modify(cardQueries.prohibitTarget, () => true)],
  });
  const game = cardGame({ hands: { a: [card('weapon', 'spear')] }, skills: [skill] });
  await game.room.run('probe', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'a',
      skill: skill.id,
      source: { kind: 'general', id: 'g' },
    });
    expect(game.book.validateUse(ctx, install('weapon')).ok).toBe(false);
    expect(ctx.world.position('weapon')).toBe('a:hand');
  });
});

it('重建和替换快照后，装备能力按当前实体与持有者派生', async () => {
  const game = cardGame({
    hands: { a: [card('weapon', 'spear'), card('x', 'jink'), card('y', 'peach')] },
  });
  await use(game, install('weapon'));
  const restored = new World(rebuildWorld(game.initial, game.room.history.facts()));
  const skills = new SkillBook([]);
  new CardBook(standardCards, skills);
  expect(skills.bindings(restored.reader).map(({ definition }) => definition.name)).toEqual([
    '丈八蛇矛',
  ]);
  const original = restored.reader.snapshot;
  const changed = new World({
    ...original,
    cards: original.cards.map((card) =>
      card.id === 'weapon' ? { ...card, name: 'standard:crossbow' } : card,
    ),
  });
  // 同 revision、同区域表换了实体牌记录，也必须按当前牌定义派生能力。
  expect(changed.reader.snapshot.revision).toBe(original.revision);
  expect(changed.reader.snapshot.zones).toBe(original.zones);
  restored.apply(changed.reader.snapshot);
  const current = skills.bindings(restored.reader)[0]!;
  expect(current.definition.name).toBe('诸葛连弩');
  expect(current.definition.viewAs ?? []).toEqual([]);
  expect(current.self.active({ world: restored.reader } as Context)).toBe(true);

  for (const [from, to] of [
    ['a', 'b'],
    ['b', 'a'],
  ]) {
    restored.apply(
      restored.prepare([
        {
          kind: 'move',
          cards: ['weapon'],
          from: `${from}:equipment`,
          to: `${to}:equipment`,
          place: 'bottom',
        },
      ]),
    );
    expect(skills.bindings(restored.reader)).toMatchObject([
      { self: { owner: to, origin: { kind: 'equipment', id: 'weapon' } } },
    ]);
    expect(current.self.active({ world: restored.reader } as Context)).toBe(to === 'a');
  }
  expect(game.room.history.facts(Skill.changed)).toHaveLength(0);
});
