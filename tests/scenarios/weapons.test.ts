import { expect, it } from 'vitest';
import {
  blockSkill,
  cardQueries,
  damage,
  defineSkill,
  modify,
  moveCards,
  ownedCards,
  withLifetime,
  Use,
  Attack,
  Damage,
  Cost,
  inspectUse,
  validateUse,
} from '../../src/sdk';
import type { CardChoice, CardOffer, DefenseDraft, UseIntent } from '../../src/sdk';
import { wusheng } from '../../src/content/standard/generals/guanyu';
import { card, cardGame, use, die } from '../fixtures/cards';
import { nextRequest, answer } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { CardEvent } from '../../src/sdk';
import { Skill } from '../../src/sdk';

const strike = (
  choice: CardChoice = { kind: 'physical', card: 's0' },
  targets = ['b'],
): UseIntent => ({ actor: 'a', choice, targets, timing: { kind: 'effect' } });
const generated: CardChoice = {
  kind: 'generated',
  face: { name: 'standard:slash' },
  materials: [],
  reason: 'probe',
};
function axeGame(extra = 2) {
  return cardGame({
    hands: {
      a: [
        card('s0', 'slash'),
        ...Array.from({ length: extra }, (_, i) => card(`fee${i}`, 'peach')),
      ],
      b: [card('j', 'jink')],
    },
    equipment: { a: [card('weapon', 'axe')] },
  });
}

it.each([false, true])(
  '贯石斧恢复原效果，保持闪已支付，并让伤害走统一防止管线：%s',
  async (prevent) => {
    const game = axeGame();
    if (prevent)
      game.room.on(Damage.inflicting, {
        id: 'prevent',
        owner: null,
        eligible: () => true,
        run: (_ctx, draft) => draft.prevent('probe'),
      });
    const running = use(game, strike());
    await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
    const request = await nextRequest(game.room);
    expect(
      game.room.decisions.submit(request.id, request.token, {
        cards: ['weapon', 'fee0'],
        targets: [],
      }).kind,
    ).toBe('rejected');
    await answer(game, { cards: ['fee0', 'fee1'], targets: [] }, 'cards-targets');
    await running;
    expect(game.room.world.player('b').hp).toBe(prevent ? 4 : 3);
    expect(game.room.world.position('weapon')).toBe('a:equipment');
    expect(game.room.world.position('j')).toBe('discard');
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
    expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
    expect(game.room.history.facts(Attack.defenseBroken)).toHaveLength(1);
    expect(game.room.history.facts(Attack.finished)).toMatchObject([
      {
        data: { detail: { kind: 'undefended', damage: { kind: prevent ? 'prevented' : 'dealt' } } },
      },
    ]);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  },
);

it.each([1, 2])('贯石斧材料不足或取消不收费：其他牌 %s', async (extra) => {
  const game = axeGame(extra);
  const running = use(game, strike());
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  if (extra === 2) {
    const request = await nextRequest(game.room);
    game.room.decisions.cancel(request.id, request.token);
  }
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('fee0')).toBe('a:hand');
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(0);
});

it.each(['lost', 'dead'])('贯石斧已支付后来源 %s，已宣告突破仍生效', async (event) => {
  const game = axeGame();
  game.room.on(Cost.paid, {
    id: 'source-leaves',
    owner: null,
    eligible: (_ctx, receipt) => receipt.skill === 'standard:axe-ability',
    async run(ctx) {
      if (event === 'lost')
        await moveCards(
          ctx,
          [{ cards: ['weapon'], from: 'a:equipment', to: 'c:hand', place: 'bottom' }],
          'probe',
        );
      else await die(ctx, 'a');
    },
  });
  const running = use(game, strike());
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  await answer(game, { cards: ['fee0', 'fee1'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
});

it('防御结果在全部闪满足后才开放；部分成功不会激活贯石斧', async () => {
  const game = cardGame({
    hands: {
      a: [card('s0', 'slash'), card('f0', 'peach'), card('f1', 'peach')],
      b: [card('j', 'jink')],
    },
    equipment: { a: [card('weapon', 'axe')] },
    rules: [modify(cardQueries.responseCount, () => 2)],
  });
  const running = use(game, strike());
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(Attack.defended)).toHaveLength(0);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(0);
});

it('防御结果禁止纯查询修改，封口后迟到突破被拒绝', async () => {
  const game = cardGame({ hands: { b: [card('j', 'jink')] } });
  let draft: DefenseDraft;
  game.room.on(Attack.defended, {
    id: 'capture',
    owner: null,
    eligible: () => true,
    run(ctx, value) {
      draft = value;
      expect(() => ctx.query(() => value.breakDefense('pure'))).toThrow();
    },
  });
  const running = use(game, strike({ kind: 'physical', card: 'slash1' }));
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  await running;
  await game.room.run('late', () => {
    expect(() => draft.breakDefense('late')).toThrow();
  });
  expect(game.room.world.player('b').hp).toBe(4);
});

it('万箭的闪不激活贯石斧；防具直接取消杀也不冒充闪避', async () => {
  const volley = cardGame({
    hands: {
      a: [card('v', 'archery_attack'), card('f0', 'peach'), card('f1', 'peach')],
      b: [card('j', 'jink')],
    },
    equipment: { a: [card('weapon', 'axe')] },
  });
  const running = use(volley, strike({ kind: 'physical', card: 'v' }, []));
  await answer(volley, { kind: 'physical', card: 'j' }, 'card-response');
  await running;
  expect(volley.room.history.facts(Skill.invoked)).toHaveLength(0);
  expect(volley.room.world.player('b').hp).toBe(4);
  const shield = cardGame({
    equipment: { a: [card('weapon', 'axe')], b: [card('armor', 'nioh_shield')] },
  });
  await use(shield, strike({ kind: 'physical', card: 'slash1' }));
  expect(shield.room.history.facts(Attack.defended)).toHaveLength(0);
});

it('青龙追加杀具有独立身份与处理区，原杀仍是已防御', async () => {
  const game = cardGame({
    hands: { a: [card('s0', 'slash'), card('s1', 'slash')], b: [card('j', 'jink')] },
    equipment: { a: [card('weapon', 'blade')] },
  });
  let maxProcessing = 0;
  game.room.on(Use.declared, {
    id: 'processing',
    owner: null,
    eligible: () => true,
    run(ctx) {
      maxProcessing = Math.max(
        maxProcessing,
        ctx.world.snapshot.zones.filter((z) => z.kind === 'processing').length,
      );
    },
  });
  const running = use(game, strike());
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  await answer(game, { kind: 'physical', card: 's1' }, 'use-card');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(maxProcessing).toBe(2);
  const facts = game.room.history.facts(CardEvent.used);
  expect(facts).toHaveLength(3);
  expect(facts[1]?.data.detail).toMatchObject({ declaration: { card: { name: 'standard:jink' } } });
  expect(facts[2]?.data.detail).toMatchObject({
    declaration: { context: { kind: 'effect', ignoreDistance: true } },
  });
  expect(
    game.room.history.facts(Attack.finished).map((f) => (f.data.detail as { kind: string }).kind),
  ).toEqual(['undefended', 'defended']);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('青龙连续追杀依次嵌套，每次仍能闪避与选择继续', async () => {
  const game = cardGame({
    hands: {
      a: [card('s0', 'slash'), card('s1', 'slash'), card('s2', 'slash')],
      b: [card('j0', 'jink'), card('j1', 'jink')],
    },
    equipment: { a: [card('weapon', 'blade')] },
  });
  const running = use(game, strike());
  for (let i = 0; i < 2; i++) {
    await answer(game, { kind: 'physical', card: `j${i}` }, 'card-response');
    await answer(game, { kind: 'physical', card: `s${i + 1}` }, 'use-card');
  }
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(5);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
});

it.each([false, true])('青龙忽略变化后的距离，但仍受目标禁令约束：禁止 %s', async (prohibited) => {
  let changed = false;
  const game = cardGame({
    hands: {
      a: [card('s0', 'slash'), card('s1', 'slash'), card('s2', 'slash')],
      b: [card('j', 'jink')],
    },
    equipment: { a: [card('weapon', 'blade')] },
    rules: [
      modify(cardQueries.distanceCorrection, () => (changed ? 50 : 0)),
      modify(cardQueries.prohibitTarget, () => changed && prohibited),
    ],
  });
  game.room.on(Use.finished, {
    id: 'change',
    owner: null,
    eligible: (_ctx, use) => use.card.name === 'standard:jink',
    run: () => {
      changed = true;
    },
  });
  const running = use(game, strike());
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  if (!prohibited) await answer(game, { kind: 'physical', card: 's1' }, 'use-card');
  await running;
  expect(game.room.world.player('b').hp).toBe(prohibited ? 4 : 3);
  await game.room.run('normal', (ctx) => {
    expect(validateUse(ctx, strike({ kind: 'physical', card: 's2' })).ok).toBe(false);
  });
});

it('青龙在发动前离场不再追杀；主动拒绝追杀也不消耗杀', async () => {
  for (const lost of [false, true]) {
    const game = cardGame({
      hands: { a: [card('s0', 'slash'), card('s1', 'slash')], b: [card('j', 'jink')] },
      equipment: { a: [card('weapon', 'blade')] },
    });
    if (lost)
      game.room.on(Use.finished, {
        id: 'lost',
        owner: null,
        eligible: (_ctx, use) => use.card.name === 'standard:jink',
        async run(ctx) {
          await moveCards(
            ctx,
            [{ cards: ['weapon'], from: 'a:equipment', to: 'c:hand', place: 'bottom' }],
            'lost',
          );
        },
      });
    const running = use(game, strike());
    await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
    if (!lost) {
      const request = await nextRequest(game.room);
      game.room.decisions.cancel(request.id, request.token);
    }
    await running;
    expect(game.room.world.player('b').hp).toBe(4);
    expect(game.room.world.position('s1')).toBe('a:hand');
  }
});

it('青龙允许武圣以刀本身追杀，宣告离场后不再继续追杀', async () => {
  const game = cardGame({
    hands: { a: [card('s0', 'slash')], b: [card('j0', 'jink'), card('j1', 'jink')] },
    equipment: { a: [card('weapon', 'blade', 'heart')] },
    skills: [wusheng],
  });
  await game.room.run('grant', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'a',
      skill: wusheng.id,
      source: { kind: 'general', id: 'guan-yu' },
    });
  });
  const running = use(game, strike());
  await answer(game, { kind: 'physical', card: 'j0' }, 'card-response');
  const request = await nextRequest(game.room);
  const offer = (request.data as { offers: CardOffer[] }).offers.find((o) => o.label === '武圣')!;
  await answer(game, { kind: 'viewAs', ...offer.choice, materials: ['weapon'] }, 'use-card');
  await answer(game, { kind: 'physical', card: 'j1' }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('weapon')).toBe('discard');
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(4);
});

it('方天最后手牌杀的目标数量与最终验证一致，支付后不丢失已声明目标', async () => {
  const game = cardGame({
    hands: { a: [card('s0', 'slash')] },
    equipment: { a: [card('weapon', 'halberd')] },
  });
  await game.room.run('preview', (ctx) => {
    expect(inspectUse(ctx, strike()).targetCount).toEqual({ min: 1, max: 3 });
    expect(inspectUse(ctx, strike(undefined, ['b', 'c', 'd'])).complete).toBe(true);
  });
  await use(game, strike(undefined, ['b', 'c', 'd']));
  for (const id of ['b', 'c', 'd']) expect(game.room.world.player(id).hp).toBe(3);
  expect(game.room.world.position('weapon')).toBe('a:equipment');
});

it('方天有其他手牌时仍限一目标；空手零材料杀也不凭空增加目标', async () => {
  for (const empty of [false, true]) {
    const game = cardGame({
      hands: { a: empty ? [] : [card('s0', 'slash'), card('other', 'peach')] },
      equipment: { a: [card('weapon', 'halberd')] },
    });
    const choice = empty ? generated : undefined;
    expect(await use(game, strike(choice, ['b', 'c']))).toMatchObject({
      value: { kind: 'unavailable' },
    });
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(0);
  }
});

it('方天支持多材料用尽手牌；武器作材料或来源失效则不提供范围和额外目标', async () => {
  const game = cardGame({
    hands: { a: [card('x', 'jink'), card('y', 'peach')] },
    equipment: { a: [card('weapon', 'halberd')] },
  });
  const choice: CardChoice = {
    ...generated,
    kind: 'generated',
    face: { name: 'standard:slash' },
    materials: ['x', 'y'],
  };
  await game.room.run('queries', async (ctx) => {
    expect(inspectUse(ctx, strike(choice)).targetCount.max).toBe(3);
    expect(
      inspectUse(ctx, strike({ ...choice, materials: ['x', 'y', 'weapon'] })).targetCount.max,
    ).toBe(1);
    const self = game.skills
      .bindings(ctx.world)
      .find(({ self }) => self.origin?.id === 'weapon')!.self;
    await withLifetime(ctx, 'block', (at, lifetime) => {
      blockSkill(at, self, lifetime);
      expect(inspectUse(at, strike(choice)).targetCount.max).toBe(1);
    });
    expect(inspectUse(ctx, strike(choice)).targetCount.max).toBe(3);
  });
  await use(game, strike(choice, ['b', 'c', 'd']));
  expect(game.room.world.player('c').hp).toBe(3);
});

it('额外目标查询按加法组合，不改变自动目标牌的手动选择数量', async () => {
  const bonus = defineSkill({
    id: 'probe:targets',
    name: '追加目标',
    triggers: [],
    modifiers: [modify(cardQueries.extraTargets, () => 1)],
  });
  const game = cardGame({
    hands: { a: [card('s0', 'slash'), card('aoe', 'archery_attack')] },
    equipment: { a: [card('weapon', 'halberd')] },
    skills: [bonus],
  });
  await game.room.run('query', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'a',
      skill: bonus.id,
      source: { kind: 'general', id: 'probe' },
    });
    const all: CardChoice = {
      ...generated,
      kind: 'generated',
      face: { name: 'standard:slash' },
      materials: ownedCards(ctx.world, 'a'),
    };
    expect(inspectUse(ctx, strike(all)).targetCount.max).toBe(4);
    expect(inspectUse(ctx, strike({ kind: 'physical', card: 'aoe' }, [])).targetCount).toEqual({
      min: 0,
      max: 0,
    });
  });
});

function bowGame() {
  return cardGame({
    hands: { a: [card('s0', 'slash', 'heart')] },
    equipment: {
      a: [card('weapon', 'kylin_bow')],
      b: [card('horse0', 'chitu'), card('horse1', 'dilu'), card('armor', 'nioh_shield')],
    },
  });
}
it('麒麟弓只展示坐骑，选择一张后丢弃并继续原伤害', async () => {
  const game = bowGame();
  const running = use(game, strike());
  const request = await nextRequest(game.room);
  expect(request).toMatchObject({
    player: 'a',
    kind: 'cards-targets',
    data: {
      preview: {
        cards: [
          { id: 'horse0', label: '赤兔' },
          { id: 'horse1', label: '的卢' },
        ],
      },
    },
  });
  await answer(game, { cards: ['horse0'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('horse0')).toBe('discard');
  expect(game.room.world.position('horse1')).toBe('b:equipment');
  expect(game.room.world.position('armor')).toBe('b:equipment');
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('麒麟弓拒绝发动不丢坐骑；伤害前发动后才被防止时保留已完成的弃置', async () => {
  for (const discard of [false, true]) {
    const game = bowGame();
    game.room.on(Damage.inflicting, {
      id: 'prevent',
      owner: null,
      eligible: () => true,
      run: (_ctx, draft) => draft.prevent('probe'),
    });
    const running = use(game, strike());
    if (discard) await answer(game, { cards: ['horse0'], targets: [] }, 'cards-targets');
    else {
      const request = await nextRequest(game.room);
      game.room.decisions.cancel(request.id, request.token);
    }
    await running;
    expect(game.room.world.player('b').hp).toBe(4);
    expect(game.room.world.position('horse0')).toBe(discard ? 'discard' : 'b:equipment');
  }
});

it.each(['horse', 'bow'])(
  '麒麟弓发动后 %s 离场，重查选中坐骑位置并保留已发动效果',
  async (lost) => {
    const game = bowGame();
    game.room.on(Cost.paid, {
      id: 'take',
      owner: null,
      eligible: (_ctx, paid) => paid.skill === 'standard:kylin_bow-ability',
      async run(ctx) {
        const id = lost === 'horse' ? 'horse0' : 'weapon';
        await moveCards(
          ctx,
          [{ cards: [id], from: ctx.world.position(id), to: 'c:hand', place: 'bottom' }],
          'probe',
        );
      },
    });
    const running = use(game, strike());
    await answer(game, { cards: ['horse0'], targets: [] }, 'cards-targets');
    await running;
    expect(game.room.world.position('horse0')).toBe(lost === 'horse' ? 'c:hand' : 'discard');
    expect(game.room.world.player('b').hp).toBe(3);
  },
);

it('麒麟弓不处理无牌伤害或已经防止的伤害', async () => {
  const game = bowGame();
  await game.room.run('plain', async (ctx) => {
    await damage(ctx, { from: 'a', to: 'b', amount: 1, nature: 'normal' });
  });
  game.room.on(Damage.causing, {
    id: 'prevent-first',
    owner: null,
    eligible: () => true,
    run: (_ctx, draft) => draft.prevent('probe'),
  });
  await use(game, strike());
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('horse0')).toBe('b:equipment');
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(0);
});
