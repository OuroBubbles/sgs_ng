import { expect, it } from 'vitest';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest, answer } from '../fixtures/room';
import {
  defineSkill,
  modify,
  cardQueries,
  payDiscard,
  discardCards,
  withLifetime,
  used,
  blockSkill,
  runPhase,
  playPhase,
  setGender,
  delayedCards,
  moveCards,
  kill,
  Cards,
  Cost,
} from '../../src/sdk';
import type { DiscardQuery, PaymentReceipt, UsageLimit } from '../../src/sdk';
import type { DecisionRequest } from '../../src/core/decisions/hub';
import { jieyin } from '../../src/content/standard/generals/sunshangxiang';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { Discard } from '../../src/rules/cards/discard';
import { testTiming } from '../fixtures/timing';

type Game = ReturnType<typeof cardGame>;
const source = { kind: 'general', id: 'test' } as const;
const protection = (accepts: (input: DiscardQuery) => boolean) =>
  defineSkill({
    id: 'test:protection',
    name: '保护',
    triggers: [],
    modifiers: [
      modify(
        cardQueries.prohibitDiscard,
        (_ctx, { input, self }) => input.owner === self.owner && accepts(input),
      ),
      modify(cardQueries.prohibitDiscard, () => false),
    ],
  });
async function grant(game: Game, owner = 'b', skill = 'test:protection') {
  await game.room.run('grant', (ctx) => game.skills.grant(ctx, { owner, skill, source }));
  return game.room.world.snapshot.skills.find(
    (entry) => entry.owner === owner && entry.skill === skill,
  )!.id;
}
const options = (request: DecisionRequest) =>
  (request.data as { preview: { cards: { id: string; label: string }[] } }).preview.cards;
const strike = {
  actor: 'a',
  choice: { kind: 'physical', card: 's' },
  targets: ['b'],
  timing: { kind: 'effect' },
} as const;

it('弃置查询包含操作者/持有者/原因/区域/牌面，否决不可被 false 覆盖，失效后实时恢复', async () => {
  const skill = protection((input) => {
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.materials)).toBe(true);
    return (
      input.actor === input.owner &&
      input.reason === 'fee' &&
      input.area === 'hand' &&
      input.face.suit === 'heart'
    );
  });
  const game = cardGame({
    hands: { a: [], b: [card('guarded', 'peach', 'heart')] },
    skills: [skill],
  });
  const instance = await grant(game);
  await game.room.run('query', async (ctx) => {
    const input = { actor: 'b', owner: 'b', card: 'guarded', reason: 'fee' };
    expect(game.book.canDiscard(ctx, input)).toBe(false);
    expect(game.book.canDiscard(ctx, { ...input, actor: 'a' })).toBe(true);
    expect(game.book.canDiscard(ctx, { ...input, reason: 'other' })).toBe(true);
    expect(game.book.canDiscard(ctx, { ...input, owner: 'a' })).toBe(false);
    expect(game.book.canDiscard(ctx, { ...input, card: 'missing' })).toBe(false);
    await withLifetime(ctx, 'silence', (at, lifetime) => {
      blockSkill(at, instance, lifetime);
      expect(game.book.canDiscard(at, input)).toBe(true);
    });
    expect(game.book.canDiscard(ctx, input)).toBe(false);
    await game.skills.revoke(ctx, 'b', skill.id, source);
    expect(game.book.canDiscard(ctx, input)).toBe(true);
  });
});

it('弃牌费用保留原型字段与私有方法，实时资格、次数和宣告走同一支付流程', async () => {
  const game = cardGame({ hands: { a: [card('fee', 'jink')], b: [] } });
  class TestCost {
    #enabled = false;
    #reason = 'prototype.discard';

    constructor(readonly limit: UsageLimit) {}

    get actor() {
      return 'a';
    }
    get cards() {
      return ['fee'];
    }
    get areas() {
      return ['hand'] as const;
    }
    get reason() {
      return this.#reason;
    }
    get factKind() {
      return testTiming<unknown, PaymentReceipt>(this.#reason);
    }
    get declaration() {
      return { label: this.#reason };
    }
    legal() {
      return this.#enabled;
    }
    enable() {
      this.#enabled = true;
    }
  }
  await game.room.run('cost', (ctx) =>
    withLifetime(ctx, 'phase', async (at, lifetime) => {
      const limit = { key: 'once', source: 'prototype', max: 1, lifetime };
      const spec = new TestCost(limit);
      expect(await payDiscard(at, spec)).toMatchObject({ kind: 'unavailable' });
      expect(at.world.position('fee')).toBe('a:hand');
      expect(used(at.world, 'a', limit)).toBe(0);
      expect(game.room.history.facts(spec.factKind)).toEqual([]);

      const order: string[] = [];
      at.defer(
        game.room.on(Cards.moved, {
          id: 'prototype-move',
          owner: null,
          eligible: () => true,
          run(child) {
            expect(child.world.position('fee')).toBe('discard');
            expect(used(child.world, 'a', limit)).toBe(1);
            order.push('moved');
          },
        }),
      );
      at.defer(
        game.room.on(Cost.paid, {
          id: 'prototype-paid',
          owner: null,
          eligible: () => true,
          run: () => {
            order.push('paid');
          },
        }),
      );
      spec.enable();
      expect(await payDiscard(at, spec)).toMatchObject({
        kind: 'paid',
        receipt: {
          actor: 'a',
          cards: ['fee'],
          reason: spec.reason,
          declaration: { label: spec.reason },
        },
      });
      expect(order).toEqual(['moved', 'paid']);
      expect(await payDiscard(at, spec)).toMatchObject({ kind: 'unavailable' });
      expect(used(at.world, 'a', limit)).toBe(1);
      expect(game.room.history.facts(spec.factKind)).toHaveLength(1);
    }),
  );
  expect(game.room.status).toBe('ready');
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('费用整批重查，受保护材料不能部分支付，也不能被自定义 legal=true 绕过；解除后费用/次数同次提交', async () => {
  const skill = protection((input) => input.card === 'guarded');
  const game = cardGame({
    hands: { a: [card('guarded', 'jink'), card('free', 'jink')], b: [] },
    skills: [skill],
  });
  await grant(game, 'a');
  await game.room.run('cost', (ctx) =>
    withLifetime(ctx, 'phase', async (at, lifetime) => {
      const limit = { key: 'once', source: 'skill', max: 1, lifetime };
      let materialReads = 0;
      const spec = {
        actor: 'a',
        get cards() {
          return ++materialReads === 2 ? ['free'] : ['free', 'guarded'];
        },
        reason: 'fee',
        limit,
        legal: () => true,
      };
      expect(await payDiscard(at, spec)).toMatchObject({ kind: 'unavailable' });
      expect(materialReads).toBe(1);
      expect(at.world.zone('a:hand').cards).toEqual(['guarded', 'free']);
      expect(used(at.world, 'a', limit)).toBe(0);
      await game.skills.revoke(at, 'a', skill.id, source);
      at.defer(
        game.room.on(Cards.moved, {
          id: 'atomic',
          owner: null,
          eligible: () => true,
          run(child) {
            expect(child.world.zone('a:hand').cards).toEqual([]);
            expect(used(child.world, 'a', limit)).toBe(1);
          },
        }),
      );
      materialReads = 0;
      expect(await payDiscard(at, spec)).toMatchObject({ kind: 'paid' });
      expect(materialReads).toBe(1);
    }),
  );
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

for (const free of [0, 1]) {
  it(`弃牌阶段不足额可弃牌 ${free} 张：弃尽可弃部分并完成阶段，不生成无法完成的必选`, async () => {
    const game = cardGame({
      hands: { a: Array.from({ length: 4 }, (_, i) => card(`h${i}`, 'jink')), b: [] },
      skills: [protection((input) => input.card !== 'h0' || free === 0)],
    });
    await grant(game, 'a');
    await game.room.run('hp', (ctx) =>
      ctx.commit(testTiming('fixture'), [{ kind: 'vitality', player: 'a', hp: 1 }], null),
    );
    const running = game.room.run('discard', (ctx) => runPhase(ctx, game.book, 'a', 'discard'));
    if (free) {
      const request = await nextRequest(game.room);
      expect(request.prompt).toBe('弃置 1 张手牌');
      expect(options(request).map((item) => item.id)).toEqual(['h0']);
      expect(game.room.decisions.preview(request.id, { cards: ['h1'], targets: [] })?.valid).toBe(
        false,
      );
      await answer(game, { cards: ['h0'], targets: [] }, 'cards-targets');
    }
    await running;
    expect(game.room.world.zone('a:hand').cards).toHaveLength(4 - free);
    expect(game.room.history.facts(Discard.limited)).toHaveLength(1);
    expect(game.room.decisions.pending).toEqual([]);
  });
}

it('结姻的候选和支付使用同一弃置权限，不能提交受保护手牌', async () => {
  const game = cardGame({
    hands: { a: [card('guarded', 'jink'), card('f1', 'jink'), card('f2', 'jink')], b: [] },
    skills: [jieyin, protection((input) => input.card === 'guarded')],
  });
  const instance = await grant(game, 'a', jieyin.id);
  await grant(game, 'a');
  await game.room.run('setup', (ctx) => {
    setGender(ctx, 'b', 'male');
    ctx.commit(testTiming('wound'), [{ kind: 'vitality', player: 'b', hp: 2 }], null);
  });
  const running = game.room.run('play', (ctx) => runPhase(ctx, game.book, 'a', 'play', playPhase));
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('play-action');
  const input = { instance: instance, action: 'discard-heal', cards: ['f1', 'f2'], targets: ['b'] };
  const preview = game.room.decisions.preview(request.id, input)!;
  expect((preview.feedback as { cards: { id: string }[] }).cards.map((item) => item.id)).toEqual([
    'f1',
    'f2',
  ]);
  expect(
    game.room.decisions.preview(request.id, { ...input, cards: ['guarded', 'f1'] })?.valid,
  ).toBe(false);
  await answer(game, input, 'play-action');
  await running;
  expect(game.room.world.position('guarded')).toBe('a:hand');
  expect(game.room.world.player('b').hp).toBe(3);
});

it('拆桥只给合法的不透明手牌选项，真实牌 ID 无法代答；保护牌仍留在目标手里', async () => {
  const game = cardGame({
    hands: {
      a: [card('remove', 'dismantlement')],
      b: [card('guarded', 'peach'), card('free', 'jink')],
    },
    skills: [protection((input) => input.card === 'guarded')],
  });
  await grant(game);
  const running = use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 'remove' },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  const request = await nextRequest(game.room);
  expect(options(request)).toHaveLength(1);
  expect(options(request)[0]!.label).toMatch(/^未知手牌/);
  expect(JSON.stringify(request.data)).not.toMatch(/guarded|standard:peach|free/);
  expect(
    game.room.decisions.submit(request.id, request.token, { cards: ['free'], targets: [] }).kind,
  ).toBe('rejected');
  await answer(game, { cards: [options(request)[0]!.id], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.position('free')).toBe('discard');
  expect(game.room.world.position('guarded')).toBe('b:hand');
});

it('所有牌都禁止被弃置时拆桥正常空结算；顺手获得不受弃置禁止影响', async () => {
  for (const name of ['dismantlement', 'snatch']) {
    const game = cardGame({
      hands: { a: [card('trick', name)], b: [card('guarded', 'peach')] },
      skills: [protection(() => true)],
    });
    await grant(game);
    const running = use(game, {
      actor: 'a',
      choice: { kind: 'physical', card: 'trick' },
      targets: ['b'],
      timing: { kind: 'effect' },
    });
    if (name === 'snatch') {
      const request = await nextRequest(game.room);
      await answer(game, { cards: [options(request)[0]!.id], targets: [] }, 'cards-targets');
    }
    await running;
    expect(game.room.world.position('guarded')).toBe(name === 'snatch' ? 'a:hand' : 'b:hand');
    expect(game.room.world.position('trick')).toBe('discard');
  }
});

for (const count of [0, 2]) {
  it(`延时牌 ${count} 材料按整体语义查询，解除保护后整体丢弃且事实可重建`, async () => {
    const game = cardGame({
      hands: { a: Array.from({ length: count }, (_, i) => card(`m${i}`, 'jink')), b: [] },
      skills: [protection((input) => input.face.name === 'standard:indulgence')],
    });
    await grant(game);
    await use(game, {
      actor: 'a',
      choice: {
        kind: 'generated',
        face: { name: 'standard:indulgence' },
        materials: Array.from({ length: count }, (_, i) => `m${i}`),
        reason: 'test',
      },
      targets: ['b'],
      timing: { kind: 'effect' },
    });
    const entry = delayedCards(game.room.world, 'b')[0]!;
    await game.room.run('discard', async (ctx) => {
      const input = { actor: 'a', owner: 'b', cards: [entry.id], reason: 'effect' };
      expect(await discardCards(ctx, input)).toMatchObject({ kind: 'unavailable' });
      if (count) {
        expect(
          game.book.canDiscard(ctx, { actor: 'a', owner: 'b', card: 'm0', reason: 'effect' }),
        ).toBe(false);
        // 捕获移牌事实已提交、附件善后尚未执行的瞬间，剩余材料仍归逻辑延时牌管理。
        ctx.commit(
          testTiming('fixture-before-attachment-cleanup'),
          [{ kind: 'move', cards: ['m0'], from: entry.id, to: 'discard', place: 'bottom' }],
          null,
        );
        expect(
          game.book.canDiscard(ctx, { actor: 'a', owner: 'b', card: 'm1', reason: 'effect' }),
        ).toBe(false);
      }
      const remaining = delayedCards(ctx.world, 'b', true)[0]!.cards;
      await game.skills.revoke(ctx, 'b', 'test:protection', source);
      ctx.defer(
        game.room.on(Cards.moved, {
          id: 'atomic-removal',
          owner: null,
          eligible: () => true,
          run(child) {
            expect(delayedCards(child.world, 'b')).toEqual([]);
          },
        }),
      );
      expect(await discardCards(ctx, input)).toMatchObject({
        kind: 'discarded',
        cards: remaining,
      });
    });
    expect(delayedCards(game.room.world, 'b')).toEqual([]);
    expect(game.room.world.zone('discard').cards).toHaveLength(count);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  });
}

it('效果弃置批内有一张禁止就整体失败；普通转移、用牌善后、装备替换和死亡清理不被误拦', async () => {
  const game = cardGame({
    hands: { a: [card('s', 'slash'), card('new', 'crossbow'), card('guarded', 'peach')], b: [] },
    equipment: { a: [card('old', 'spear')] },
    skills: [protection(() => true)],
  });
  await grant(game, 'a');
  await game.room.run('reject', async (ctx) => {
    expect(
      await discardCards(ctx, {
        actor: 'a',
        owner: 'a',
        cards: ['guarded', 's'],
        reason: 'discard',
      }),
    ).toMatchObject({ kind: 'unavailable' });
    await moveCards(
      ctx,
      [{ cards: ['guarded'], from: 'a:hand', to: 'b:hand', place: 'bottom' }],
      'give',
    );
  });
  await use(game, strike);
  expect(game.room.world.position('s')).toBe('discard');
  await use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 'new' },
    targets: [],
    timing: { kind: 'effect' },
  });
  expect(game.room.world.position('old')).toBe('discard');
  await game.room.run('death', (ctx) =>
    kill(ctx, {
      player: 'a',
      killer: null,
      reason: 'rule',
      cause: { kind: 'rule', seq: null, data: null },
    }),
  );
  expect(game.room.world.position('new')).toBe('discard');
  expect(game.room.world.position('guarded')).toBe('b:hand');
});

it('贯石斧无法用禁止弃置的牌付费用，闪仍抵消原杀', async () => {
  const game = cardGame({
    hands: {
      a: [card('s', 'slash'), card('fee1', 'peach'), card('fee2', 'peach')],
      b: [card('j', 'jink')],
    },
    equipment: { a: [card('w', 'axe')] },
    skills: [protection((input) => input.card.startsWith('fee'))],
  });
  await grant(game, 'a');
  const running = use(game, strike);
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.zone('a:hand').cards).toEqual(['fee1', 'fee2']);
});

it('双股剑目标不能自弃受保护手牌时，改为来源摸牌', async () => {
  const game = cardGame({
    hands: { a: [card('s', 'slash')], b: [card('guarded', 'peach')] },
    equipment: { a: [card('w', 'double_swords')] },
    draw: [card('top', 'jink')],
    skills: [protection((input) => input.actor === input.owner)],
  });
  await grant(game);
  await game.room.run('gender', (ctx) => {
    setGender(ctx, 'a', 'male');
    setGender(ctx, 'b', 'female');
  });
  const running = use(game, strike);
  await answer(game, true, 'invoke');
  await running;
  expect(game.room.world.position('top')).toBe('a:hand');
  expect(game.room.world.position('guarded')).toBe('b:hand');
});

it('寒冰剑目标没有可弃牌时不提供防伤替代；麒麟弓宣告后新增保护会阻止实际弃置', async () => {
  const ice = cardGame({
    hands: { a: [card('s', 'slash')], b: [card('guarded', 'peach')] },
    equipment: { a: [card('w', 'ice_sword')] },
    skills: [protection(() => true)],
  });
  await grant(ice);
  await use(ice, strike);
  expect(ice.room.world.player('b').hp).toBe(3);
  expect(ice.room.world.position('guarded')).toBe('b:hand');
  const bow = cardGame({
    hands: { a: [card('s', 'slash')], b: [] },
    equipment: { a: [card('w', 'kylin_bow')], b: [card('horse', 'chitu')] },
    skills: [protection(() => true)],
  });
  bow.room.on(Cost.paid, {
    id: 'new-protection',
    owner: null,
    eligible: (_ctx, receipt) => receipt.skill === 'standard:kylin_bow-ability',
    async run(ctx) {
      await bow.skills.grant(ctx, { owner: 'b', skill: 'test:protection', source });
    },
  });
  const running = use(bow, strike);
  await answer(bow, { cards: ['horse'], targets: [] }, 'cards-targets');
  await running;
  expect(bow.room.world.position('horse')).toBe('b:equipment');
  expect(bow.room.world.player('b').hp).toBe(3);
  expect(bow.room.history.facts(Discard.committed)).toEqual([]);
});

it('麒麟弓已完成选择与宣告后来源死亡，后续弃置仍可继续，存活资格不被权限查询重复代判', async () => {
  const game = cardGame({
    hands: { a: [card('s', 'slash')], b: [] },
    equipment: {
      a: [card('w', 'kylin_bow')],
      b: [card('horse', 'chitu')],
    },
  });
  game.room.on(Cost.paid, {
    id: 'source-death',
    owner: null,
    eligible: (_ctx, receipt) => receipt.skill === 'standard:kylin_bow-ability',
    async run(ctx) {
      await kill(ctx, {
        player: 'a',
        killer: null,
        reason: 'rule',
        cause: { kind: 'rule', seq: null, data: null },
      });
    },
  });
  const running = use(game, strike);
  await answer(game, { cards: ['horse'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.player('a').alive).toBe(false);
  expect(game.room.world.position('horse')).toBe('discard');
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(Discard.committed)).toHaveLength(1);
});
