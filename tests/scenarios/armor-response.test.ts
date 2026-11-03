import { expect, it } from 'vitest';
import {
  blockSkill,
  defineSkill,
  equip,
  kill,
  moveCards,
  on,
  withLifetime,
  Resolve,
  Use,
  Judgment,
  Response,
  Cost,
} from '../../src/sdk';
import type { CardChoice, CardEffect, ResponseOpportunity, UseIntent } from '../../src/sdk';
import { eightDiagram } from '../../src/content/standard/armor';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { CardEvent } from '../../src/sdk';
import { Equipment } from '../../src/sdk';
import { Skill } from '../../src/sdk';

type Game = ReturnType<typeof cardGame>;
const slash = (id = 'slash1', actor = 'a', target = 'b'): UseIntent => ({
  actor,
  choice: { kind: 'physical', card: id },
  targets: [target],
  timing: { kind: 'effect' },
});
const generated = (name = 'jink'): CardChoice => ({
  kind: 'generated',
  face: { name: `standard:${name}` },
  materials: [],
  reason: 'probe:supply',
});
async function answer(game: Game, value: unknown, kind = 'invoke') {
  const request = await nextRequest(game.room);
  expect(request.kind).toBe(kind);
  expect(game.room.decisions.submit(request.id, request.token, value).kind).toBe('accepted');
}
const armor = { b: [card('armor', 'eight_diagram')] };
const red = [card('red', 'peach', 'heart')];

it('八卦阵无手牌也能判定供闪，抵消杀时零材料走一次使用与完成，历史可重建', async () => {
  const game = cardGame({ equipment: armor, draw: red });
  let finished = 0;
  game.room.on(Use.finished, {
    id: 'observe',
    owner: null,
    eligible: (_ctx, result) => result.card.name === 'standard:jink',
    run: () => {
      finished++;
    },
  });
  const running = use(game, slash());
  await answer(game, true);
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('armor')).toBe('b:equipment');
  expect(game.room.world.zone('discard').cards).toEqual(['red', 'slash1']);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(finished).toBe(1);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it.each([false, true])('八卦不发动或黑判后回到普通闪选择：发动 %s', async (invoke) => {
  const game = cardGame({
    equipment: armor,
    hands: { b: [card('jink', 'jink')] },
    draw: [card('black', 'slash')],
  });
  const running = use(game, slash());
  await answer(game, invoke);
  await answer(game, { kind: 'physical', card: 'jink' }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(Judgment.finished)).toHaveLength(invoke ? 1 : 0);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
});

it('禁止响应闪时不诱导八卦发动；判定后新禁令也不能绕过最终供牌验证', async () => {
  const before = cardGame({
    equipment: armor,
    draw: red,
    policy: { prohibitUse: (_ctx, _actor, card) => card.name === 'standard:jink' },
  });
  await use(before, slash());
  expect(before.room.world.player('b').hp).toBe(3);
  expect(before.room.history.facts(Skill.invoked)).toHaveLength(0);
  expect(before.room.world.position('red')).toBe('draw');
  let prohibited = false;
  const after = cardGame({
    equipment: armor,
    draw: red,
    policy: { prohibitUse: (_ctx, _actor, card) => card.name === 'standard:jink' && prohibited },
  });
  after.room.on(Judgment.finished, {
    id: 'prohibit',
    owner: null,
    eligible: () => true,
    run: () => {
      prohibited = true;
    },
  });
  const running = use(after, slash());
  await answer(after, true);
  await running;
  expect(after.room.history.facts(Skill.invoked)).toHaveLength(1);
  expect(after.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(after.room.world.player('b').hp).toBe(3);
});

it('八卦已经发动，判定期间失去防具不撤销本次技能；以后不再发动', async () => {
  const game = cardGame({ equipment: armor, draw: red });
  game.room.on(Judgment.finished, {
    id: 'lose',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await moveCards(
        ctx,
        [{ cards: ['armor'], from: 'b:equipment', to: 'discard', place: 'bottom' }],
        'probe:lose',
      );
    },
  });
  const running = use(game, slash());
  await answer(game, true);
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  await use(game, slash('slash2'));
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
});

it('装备失效生存期关闭后恢复；多闪需求分别打开机会，不把一次判定算作两闪', async () => {
  const game = cardGame({ equipment: armor, draw: red, policy: { responseTimes: () => 2 } });
  await game.room.run('block', async (ctx) => {
    const self = game.skills
      .bindings(ctx.world)
      .find(({ self }) => self.origin?.id === 'armor')!.self;
    await withLifetime(ctx, 'block', async (at, lifetime) => {
      blockSkill(at, self, lifetime);
      await game.book.use(at, slash());
    });
  });
  expect(game.room.world.player('b').hp).toBe(3);
  const running = use(game, slash('slash2'));
  await answer(game, true);
  await answer(game, false);
  await running;
  expect(game.room.world.player('b').hp).toBe(2);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(3);
});

it.each(['spade', 'heart'] as const)('仁王盾按语义颜色防杀：%s', async (suit) => {
  const game = cardGame({
    hands: { a: [card('s', 'slash', suit)] },
    equipment: { b: [card('shield', 'nioh_shield')] },
  });
  const result = await use(game, slash('s'));
  expect(game.room.world.player('b').hp).toBe(suit === 'spade' ? 4 : 3);
  expect(result).toMatchObject({
    value: { use: { effects: [{ state: suit === 'spade' ? 'cancelled' : 'resolved' }] } },
  });
});

it.each(['nioh_shield', 'eight_diagram'])(
  '青釭剑只声明当前杀忽略 %s，宣告后丢剑不撤销',
  async (name) => {
    const game = cardGame({
      equipment: { a: [card('sword', 'qinggang_sword')], b: [card('armor', name)] },
      draw: red,
    });
    game.room.on(Resolve.starting, {
      id: 'lose-sword',
      owner: null,
      eligible: (ctx) => ctx.world.position('sword') === 'a:equipment',
      async run(ctx) {
        await moveCards(
          ctx,
          [{ cards: ['sword'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
          'probe:lose',
        );
      },
    });
    const result = await use(game, slash());
    expect(result).toMatchObject({
      value: {
        use: {
          effects: [{ ignoredEquipment: [{ slot: 'armor', reason: 'standard:qinggang_sword' }] }],
        },
      },
    });
    expect(game.room.world.player('b').hp).toBe(3);
    expect(game.room.history.facts(Skill.invoked)).toHaveLength(0);
    expect(game.room.world.position('red')).toBe('draw');
    if (name === 'nioh_shield') {
      await use(game, slash('slash2'));
      expect(game.room.world.player('b').hp).toBe(3);
    }
  },
);

it('青釭剑不污染同一目标上的嵌套杀；效果快照关闭后不能再改', async () => {
  const game = cardGame({
    hands: { c: [card('inner', 'slash')] },
    equipment: { a: [card('sword', 'qinggang_sword')], b: [card('shield', 'nioh_shield')] },
  });
  game.room.on(Resolve.starting, {
    id: 'nested',
    owner: null,
    eligible: (_ctx, { effect }) => effect.actor === 'a',
    async run(ctx) {
      await game.book.use(ctx, slash('inner', 'c'));
    },
  });
  let liveEffect: CardEffect;
  // 用真实窗口句柄检查封口，不伪造一个计划。
  game.room.on(Resolve.starting, {
    id: 'capture',
    owner: null,
    eligible: (_ctx, { effect }) => effect.actor === 'a',
    run: (_ctx, payload) => {
      liveEffect = payload.effect;
    },
  });
  await use(game, slash());
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(Equipment.blocked)).toHaveLength(1);
  await game.room.run('late', (ctx) => {
    expect(() => liveEffect!.ignoreEquipment(ctx, 'armor', 'late')).toThrow();
  });
});

it('青釭剑声明只属于已指定身份，失去武器后追加和重复目标不自动继承', async () => {
  const game = cardGame({
    hands: { b: [card('new', 'nioh_shield')] },
    equipment: { a: [card('sword', 'qinggang_sword')], d: [card('old', 'nioh_shield')] },
  });
  game.room.on(Resolve.starting, {
    id: 'equip-now',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    async run(ctx) {
      await equip(ctx, game.book, { card: 'new', from: 'b:hand', owner: 'b' });
    },
  });
  game.room.on(Resolve.finished, {
    id: 'extend',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    async run(ctx, { use }) {
      await moveCards(
        ctx,
        [{ cards: ['sword'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
        'probe:lose',
      );
      use.addTarget(ctx, 'd', 'probe:add');
      use.repeatTarget(ctx, 'd', 'probe:repeat');
      expect(() => ctx.query(() => use.ignoreEquipment(ctx, 'weapon', 'pure'))).toThrow();
    },
  });
  const result = await use(game, slash());
  expect(result).toMatchObject({
    value: { use: { effects: [{ target: 'b' }, { target: 'd' }, { target: 'd' }] } },
  });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.player('d').hp).toBe(4);
});

it('供牌拒绝错误名称；支付后效重入和重复供牌均不重复宣告或费用', async () => {
  const game = cardGame();
  let request: ResponseOpportunity;
  let reentered = 0;
  game.room.on(Response.requested, {
    id: 'supply',
    owner: null,
    eligible: () => true,
    async run(ctx, payload) {
      request = payload;
      expect(await payload.provide(ctx, generated('slash'))).toMatchObject({ kind: 'unavailable' });
      expect(await payload.provide(ctx, generated())).toMatchObject({ kind: 'used', actor: 'b' });
      expect(await payload.provide(ctx, generated())).toMatchObject({ kind: 'unavailable' });
    },
  });
  game.room.on(Cost.paid, {
    id: 'reenter',
    owner: null,
    eligible: (_ctx, receipt) =>
      typeof receipt.declaration === 'object' &&
      receipt.declaration !== null &&
      'card' in receipt.declaration &&
      (receipt.declaration.card as { name: string }).name === 'standard:jink',
    async run(ctx) {
      reentered++;
      expect(await request.provide(ctx, generated())).toMatchObject({ kind: 'unavailable' });
    },
  });
  await use(game, slash());
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(reentered).toBe(1);
  await game.room.run('expired', async (ctx) => {
    expect(request.available(ctx)).toBe(false);
    expect(await request.provide(ctx, generated())).toMatchObject({ kind: 'unavailable' });
  });
  const other = cardGame();
  await other.room.run('foreign', async (ctx) => {
    expect(await request.provide(ctx, generated())).toMatchObject({ kind: 'unavailable' });
  });
});

it('跨角色委托只由实际供牌者支付，原受益者和 responseFinished 各保留一次', async () => {
  const game = cardGame({ hands: { c: [card('donor', 'jink')] } });
  game.room.on(Response.requested, {
    id: 'delegate',
    owner: null,
    eligible: (_ctx, r) => r.actor === 'b',
    async run(ctx, r) {
      await r.delegate(ctx, 'c');
    },
  });
  let responders: string[] = [];
  game.room.on(Response.finished, {
    id: 'finished',
    owner: null,
    eligible: () => true,
    run: (_ctx, r) => {
      responders = [...responders, r.actor];
    },
  });
  const running = use(game, slash());
  await answer(game, { kind: 'physical', card: 'donor' }, 'card-response');
  await running;
  expect(responders).toEqual(['c']);
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('donor')).toBe('discard');
  expect(game.room.history.facts(CardEvent.responded)).toMatchObject([
    { data: { detail: { actor: 'c', declaration: { beneficiary: 'b' } } } },
  ]);
  expect(game.room.history.facts(Response.delegated)).toHaveLength(1);
});

it('规则供牌入口不变成玩家伪造 generated 回复的入口，活跃请求也拒绝外部 World', async () => {
  const game = cardGame({ hands: { b: [card('j', 'jink')] } });
  const foreign = cardGame();
  game.room.on(Response.requested, {
    id: 'foreign',
    owner: null,
    eligible: () => true,
    async run(_ctx, request) {
      await foreign.room.run('foreign', async (at) => {
        expect(request.available(at)).toBe(false);
        expect(await request.provide(at, generated())).toMatchObject({ kind: 'unavailable' });
      });
    },
  });
  const running = use(game, slash());
  const request = await nextRequest(game.room);
  expect(game.room.decisions.submit(request.id, request.token, generated()).kind).toBe('rejected');
  expect(game.room.world.position('j')).toBe('b:hand');
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  await running;
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(foreign.room.history.facts(CardEvent.responded)).toHaveLength(0);
});

it('青釭剑作用于目标防具，受委托队友仍可发动自己的八卦阵', async () => {
  const game = cardGame({
    equipment: { a: [card('sword', 'qinggang_sword')], c: [card('armor', 'eight_diagram')] },
    draw: red,
  });
  game.room.on(Response.requested, {
    id: 'delegate',
    owner: null,
    eligible: (_ctx, r) => r.actor === 'b',
    async run(ctx, r) {
      await r.delegate(ctx, 'c');
    },
  });
  const running = use(game, slash());
  const pending = await nextRequest(game.room);
  expect(pending.player).toBe('c');
  game.room.decisions.submit(pending.id, pending.token, true);
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(CardEvent.responded)).toMatchObject([
    { data: { detail: { actor: 'c' } } },
  ]);
});

it('委托环被有界拒绝，失败委托仍可回退原角色供牌', async () => {
  const game = cardGame({ hands: { b: [card('own', 'jink')] } });
  game.room.on(Response.requested, {
    id: 'cycle',
    owner: null,
    eligible: (_ctx, r) => r.actors.length < 3,
    async run(ctx, r) {
      expect(await r.delegate(ctx, r.actor === 'b' ? 'c' : 'b')).toMatchObject({
        kind: 'unavailable',
      });
    },
  });
  const running = use(game, slash());
  await answer(game, { kind: 'physical', card: 'own' }, 'card-response');
  await running;
  expect(game.room.history.facts(Response.requested)).toHaveLength(2);
  expect(game.room.world.player('b').hp).toBe(4);
});

it('原受益者在队友支付后死亡，已打出事实保留，父请求不再采纳或重复支付', async () => {
  const game = cardGame({ hands: { c: [card('donor', 'jink')] } });
  game.room.on(Response.requested, {
    id: 'delegate',
    owner: null,
    eligible: (_ctx, r) => r.actor === 'b',
    async run(ctx, r) {
      await r.delegate(ctx, 'c');
    },
  });
  game.room.on(Response.finished, {
    id: 'die',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await kill(ctx, {
        player: 'b',
        killer: null,
        cause: { kind: 'rule', seq: null, data: null },
        reason: 'rule',
      });
    },
  });
  const running = use(game, slash());
  await answer(game, { kind: 'physical', card: 'donor' }, 'card-response');
  await running;
  expect(game.room.world.player('b').alive).toBe(false);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(game.room.history.facts(Response.delegated)).toHaveLength(0);
});

it('同一窗口可选择技能顺序，供牌后其余候选失效；选择说明使用可读名称', async () => {
  const supplier = defineSkill({
    id: 'probe:supplier',
    name: '直接供闪',
    triggers: [
      on(Response.requested, {
        id: 'supply',

        when: (ctx, r, self) => r.actor === self.owner && r.canProvide(ctx, generated()),
        async effect(ctx, r) {
          await r.provide(ctx, generated());
        },
      }),
    ],
  });
  const game = cardGame({ equipment: armor, draw: red, skills: [supplier] });
  await game.room.run('grant', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'b',
      skill: supplier.id,
      source: { kind: 'general', id: 'probe' },
    });
  });
  const running = use(game, slash());
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('trigger-order');
  const labels = (request.data as { labels: Record<string, string> }).labels;
  expect(Object.values(labels).sort()).toEqual(['八卦阵', '直接供闪'].sort());
  game.room.decisions.submit(
    request.id,
    request.token,
    Object.keys(labels).find((id) => labels[id] === '直接供闪'),
  );
  await running;
  expect(game.room.world.position('red')).toBe('draw');
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(0);
});

it('复用防具代码的普通角色技能不被误当成实际装备来源', async () => {
  const borrowedId = 'probe:borrowed-armor';
  const game = cardGame({
    equipment: { a: [card('sword', 'qinggang_sword')] },
    draw: red,
    skills: [defineSkill({ ...eightDiagram.equipment!.skill!, id: borrowedId })],
  });
  await game.room.run('grant', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'b',
      skill: borrowedId,
      source: { kind: 'general', id: 'probe' },
    });
  });
  const running = use(game, slash());
  await answer(game, true);
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
});
