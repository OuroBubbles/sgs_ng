import { expect, it } from 'vitest';
import {
  moveCards,
  Use,
  Target,
  Resolve,
  Damage,
  cardQueries,
  modify,
  attackRange,
  distance,
  useCard,
} from '../../src/sdk';
import { withLifetime } from '../../src/rules/scopes/lifetime';
import { used, Cost } from '../../src/rules/costs/pay';
import { buildCard } from '../../src/rules/cards/card';
import type { CardEffect, UsePlanView } from '../../src/sdk';
import type { UseSnapshot } from '../../src/rules/cards/types';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Hp } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

const slash = {
  actor: 'a',
  choice: { kind: 'physical', card: 'slash1' },
  targets: ['b'],
  timing: { kind: 'effect' },
} as const;
const stringMatcher: unknown = expect.any(String);

it('目标与材料空槽返回不可用，不故障、不宣告或支付', async () => {
  for (const field of ['targets', 'materials'] as const) {
    const game = cardGame();
    const missing = new Array<string>(1);
    const result = await use(game, {
      ...slash,
      targets: field === 'targets' ? missing : ['b'],
      choice:
        field === 'targets'
          ? slash.choice
          : {
              kind: 'generated',
              reason: 'probe',
              materials: missing,
              face: { name: 'standard:slash', suit: 'none', color: 'none', rank: 0 },
            },
    });
    expect(result).toMatchObject({ kind: 'resolved', value: { kind: 'unavailable' } });
    expect(game.room.status).toBe('ready');
    expect(game.room.world.position('slash1')).toBe('a:hand');
    expect(game.room.history.facts()).toEqual([]);
    expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  }
});

it('杀宣告支付、伤害关联、收束与处理区善后完整结束', async () => {
  const game = cardGame();
  const result = await use(game, slash);
  expect(result).toMatchObject({
    kind: 'resolved',
    value: {
      kind: 'used',
      use: {
        card: { name: 'standard:slash', materials: ['slash1'] },
        effects: [{ target: 'b', state: 'resolved' }],
      },
    },
  });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.zone('discard').cards).toEqual(['slash1']);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(game.room.history.facts(CardEvent.used)[0]?.data.detail).toMatchObject({
    cards: ['slash1'],
    declaration: { card: { name: 'standard:slash' }, targets: ['b'] },
  });
  expect(game.room.history.facts(Damage.dealt)[0]?.data.detail).toMatchObject({
    input: {
      card: { useId: stringMatcher, effectId: stringMatcher, card: { materials: ['slash1'] } },
    },
  });
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('闪响应只防止当前效果，回复关联稳定 UseId/EffectId，重复回复不再次支付', async () => {
  const game = cardGame({ hands: { b: [card('jink', 'jink')] } });
  const running = use(game, slash);
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('card-response');
  expect(request.data).toMatchObject({
    names: ['standard:jink'],
    to: { useId: stringMatcher, effectId: stringMatcher },
  });
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'jink' }).kind,
  ).toBe('accepted');
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'jink' }),
  ).toMatchObject({ reason: 'closed' });
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.zone('discard').cards).toEqual(['jink', 'slash1']);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(game.room.history.facts(CardEvent.used)[1]?.data.detail).toMatchObject({
    declaration: {
      context: { kind: 'response', to: { useId: stringMatcher, effectId: stringMatcher } },
    },
  });
  expect(game.room.history.facts(Damage.dealt)).toEqual([]);
});

it('取消闪响应后正常受伤，不支付未打出的闪', async () => {
  const game = cardGame({ hands: { b: [card('jink', 'jink')] } });
  const running = use(game, slash);
  const request = await nextRequest(game.room);
  game.room.decisions.cancel(request.id, request.token);
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.zone('b:hand').cards).toEqual(['jink']);
});

it('攻击距离、重复目标和不可主动使用的牌均在支付前拒绝', async () => {
  const game = cardGame();
  expect(await use(game, { ...slash, targets: ['c'] })).toMatchObject({
    value: { kind: 'unavailable' },
  });
  expect(await use(game, { ...slash, targets: ['b', 'b'] })).toMatchObject({
    value: { kind: 'unavailable' },
  });
  const generated = {
    kind: 'generated',
    face: { name: 'standard:jink' },
    materials: [],
    reason: 'test',
  } as const;
  expect(await use(game, { ...slash, choice: generated })).toMatchObject({
    value: { kind: 'unavailable' },
  });
  expect(game.room.history.facts(CardEvent.used)).toEqual([]);
  expect(game.room.world.zone('discard').cards).toEqual([]);
});

it('出牌阶段杀次数只在宣告时记录，每次额外阶段有独立次数', async () => {
  const game = cardGame();
  await game.room.run('turn', async (ctx) => {
    for (const id of ['slash1', 'slash2'])
      await withLifetime(ctx, 'play', async (play, phase) => {
        const timing = { kind: 'play', owner: 'a', phase } as const;
        expect(
          await useCard(play, { ...slash, choice: { kind: 'physical', card: id }, timing }),
        ).toMatchObject({ kind: 'used' });
        const limit = { key: 'standard:slash', per: 'phase', times: 1 } as const;
        expect(used(play, 'a', limit)).toBe(1);
        expect(
          await useCard(play, {
            ...slash,
            choice: {
              kind: 'generated',
              face: { name: 'standard:slash' },
              materials: [],
              reason: 'test',
            },
            timing,
          }),
        ).toMatchObject({ kind: 'unavailable', reason: 'Usage limit reached.' });
      });
  });
  expect(game.room.world.player('b').hp).toBe(2);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(game.room.world.snapshot.states).toEqual([]);
});

it('冒用其他角色的出牌阶段不能宣告', async () => {
  const game = cardGame();
  await game.room.run('phase', (ctx) =>
    withLifetime(ctx, 'play', async (play, phase) => {
      expect(
        await useCard(play, { ...slash, timing: { kind: 'play', owner: 'b', phase } }),
      ).toMatchObject({ kind: 'unavailable' });
    }),
  );
  expect(game.room.history.facts(CardEvent.used)).toEqual([]);
});

it('技能添加的目标各自响应，防止一个目标不防止整张牌', async () => {
  const game = cardGame({
    hands: { b: [card('jink', 'jink')] },
    rules: [modify(cardQueries.attackRange, () => 3)],
  });
  await game.room.run('range', (ctx) => {
    const built = buildCard(ctx, 'a', slash.choice, 'use');
    if (!built.ok) throw new Error(built.reason);
    expect(attackRange(ctx, 'a', built.value)).toBe(3);
  });
  game.room.on(Use.targets, {
    id: 'extra',
    owner: 'a',
    eligible: (_ctx, plan) => plan.card.name === 'standard:slash',
    run: (ctx, plan) => {
      plan.addTarget(ctx, 'c', 'extra target');
    },
  });
  const running = use(game, slash);
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'jink' });
  const result = await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.player('c').hp).toBe(3);
  if (result.kind !== 'resolved' || result.value.kind !== 'used') throw new Error('Expected use.');
  expect(result.value.use.effects.map((effect) => effect.target)).toEqual(['b', 'c']);
  expect(new Set(result.value.use.effects.map((effect) => effect.effectId)).size).toBe(2);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
});

it('转移目标创建新的效果身份，旧效果取消且不退材料', async () => {
  const game = cardGame({ rules: [modify(cardQueries.attackRange, () => 3)] });
  game.room.on(Target.confirming, {
    id: 'redirect',
    owner: 'a',
    eligible: (_ctx, event) => event.effect.target === 'b',
    run: (ctx, event) => {
      event.use.replaceTarget(ctx, event.effect.effectId, 'c', 'redirect');
    },
  });
  const result = await use(game, slash);
  expect(result).toMatchObject({
    value: {
      use: {
        effects: [
          { target: 'b', state: 'cancelled' },
          { target: 'c', state: 'resolved' },
        ],
      },
    },
  });
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.player('c').hp).toBe(3);
  expect(game.room.world.zone('discard').cards).toEqual(['slash1']);
  if (result.kind !== 'resolved' || result.value.kind !== 'used')
    throw new Error('Missing use result.');
  expect(result.value.use.edits[0]?.fromEffectId).toBe(result.value.use.effects[0]?.effectId);
  expect(result.value.use.edits[0]?.effectId).toBe(result.value.use.effects[1]?.effectId);
});

it('显式再次结算创建新 EffectId，已结算目标不会隐式重跑', async () => {
  const game = cardGame();
  game.room.on(Resolve.finished, {
    id: 'repeat',
    owner: 'a',
    eligible: (_ctx, event) => event.effect.effectId.endsWith(':1'),
    run: (ctx, event) => {
      expect(() => event.use.addTarget(ctx, 'b', 'accidental duplicate')).toThrow(
        'repeat it explicitly',
      );
      event.use.repeatTarget(ctx, 'b', 'explicit repeat');
    },
  });
  const result = await use(game, slash);
  expect(game.room.world.player('b').hp).toBe(2);
  expect(result).toMatchObject({
    value: { use: { effects: [{ state: 'resolved' }, { state: 'resolved' }] } },
  });
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
});

it('多材料中的一张被伤害后技能获得，结尾只清理余牌', async () => {
  const game = cardGame();
  game.room.on(Damage.received, {
    id: 'take-material',
    owner: 'b',
    eligible: (_ctx, hit) => hit.input.card !== undefined,
    run: async (ctx, hit) => {
      const ref = hit.input.card;
      if (!ref) throw new Error('Missing card association.');
      await moveCards(
        ctx,
        [{ cards: ['slash1'], from: ref.processing, to: 'c:hand', place: 'bottom' }],
        'obtain one material',
      );
    },
  });
  await use(game, {
    ...slash,
    choice: {
      kind: 'generated',
      face: { name: 'standard:slash' },
      materials: ['slash1', 'slash2'],
      reason: 'multi-material test',
    },
  });
  expect(game.room.world.zone('c:hand').cards).toEqual(['slash1']);
  expect(game.room.world.zone('discard').cards).toEqual(['slash2']);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
});

it('来源在宣告后死亡，已产生的牌效果仍结算', async () => {
  const game = cardGame();
  game.room.on(Cost.paid, {
    id: 'source-dies',
    owner: 'b',
    eligible: (_ctx, cost) => cost.cards.includes('slash1'),
    run: (ctx) => {
      ctx.commit(
        testTiming('source.died'),
        [{ kind: 'vitality', player: 'a', hp: 0, alive: false }],
        {},
      );
    },
  });
  expect(await use(game, slash)).toMatchObject({ value: { kind: 'used' } });
  expect(game.room.world.player('b').hp).toBe(3);
});

it('关闭的计划/已结算效果不能继续改写，事实快照保持冻结', async () => {
  const game = cardGame();
  const captured: { plan?: UsePlanView; effect?: CardEffect; snapshot?: UseSnapshot } = {};
  game.room.on(Use.declared, {
    id: 'plan',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, plan) => {
      captured.plan = plan;
    },
  });
  game.room.on(Target.confirming, {
    id: 'effect',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, event) => {
      captured.effect = event.effect;
    },
  });
  game.room.on(Use.finished, {
    id: 'snapshot',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, snapshot) => {
      captured.snapshot = snapshot;
    },
  });
  await use(game, slash);
  await game.room.run('late', (ctx) => {
    expect(() => captured.plan?.repeatTarget(ctx, 'b', 'late')).toThrow();
    expect(() => captured.effect?.cancel(ctx, 'late')).toThrow();
  });
  expect(Object.isFrozen(captured.snapshot?.effects)).toBe(true);
  expect(captured.snapshot?.effects[0]?.state).toBe('resolved');
});

it('需要两张闪时，第一张已经支付但不足以防止伤害', async () => {
  const game = cardGame({
    hands: { b: [card('jink', 'jink')] },
    rules: [modify(cardQueries.responseCount, () => 2)],
  });
  const running = use(game, slash);
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'jink' });
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.zone('discard').cards).toEqual(['jink', 'slash1']);
});

it('禁止使用与禁止响应分别查询，不能把两种含义混成一个标记', async () => {
  const game = cardGame({
    hands: { b: [card('jink', 'jink')] },
    rules: [
      modify(
        cardQueries.prohibitResponse,
        (_ctx, { input: { card } }) => card.name === 'standard:jink',
      ),
    ],
  });
  const running = use(game, slash);
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'jink' });
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  const prohibited = cardGame({
    hands: { b: [card('jink', 'jink')] },
    rules: [
      modify(cardQueries.prohibitUse, (_ctx, { input: { card } }) => card.name === 'standard:jink'),
    ],
  });
  await use(prohibited, slash);
  expect(prohibited.room.world.player('b').hp).toBe(3);
  expect(prohibited.room.world.zone('b:hand').cards).toEqual(['jink']);
});

it('回复不能伪造 generated 指令或不匹配的响应牌', async () => {
  const game = cardGame({ hands: { b: [card('jink', 'jink'), card('bslash', 'slash')] } });
  const running = use(game, slash);
  const request = await nextRequest(game.room);
  expect(
    game.room.decisions.submit(request.id, request.token, {
      kind: 'generated',
      face: { name: 'standard:jink' },
      materials: [],
      reason: 'forged',
    }),
  ).toMatchObject({ reason: 'invalid' });
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'bslash' }),
  ).toMatchObject({ reason: 'invalid' });
  game.room.decisions.cancel(request.id, request.token);
  await running;
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
});

it('桃只回复合法目标，满体力时不支付', async () => {
  const game = cardGame();
  const intent = { ...slash, choice: { kind: 'physical', card: 'peach' }, targets: ['a'] } as const;
  expect(await use(game, intent)).toMatchObject({ value: { kind: 'unavailable' } });
  await game.room.run('wound', (ctx) =>
    ctx.commit(testTiming('hp.changed'), [{ kind: 'vitality', player: 'a', hp: 3 }], {}),
  );
  expect(await use(game, intent)).toMatchObject({ value: { kind: 'used' } });
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.history.facts(Hp.recovered)).toHaveLength(1);
});

it('决斗轮流响应杀，不消耗出牌阶段杀次数', async () => {
  const game = cardGame({ hands: { b: [card('bslash', 'slash')] } });
  const running = game.room.run('phase', (ctx) =>
    withLifetime(ctx, 'play', async (play, phase) => {
      const timing = { kind: 'play', owner: 'a', phase } as const;
      await useCard(play, { ...slash, choice: { kind: 'physical', card: 'duel' }, timing });
      expect(used(play, 'a', { key: 'standard:slash', per: 'phase', times: 1 })).toBe(0);
      await useCard(play, { ...slash, choice: { kind: 'physical', card: 'slash2' }, timing });
    }),
  );
  const first = await nextRequest(game.room);
  expect(first.player).toBe('b');
  game.room.decisions.submit(first.id, first.token, { kind: 'physical', card: 'bslash' });
  const second = await nextRequest(game.room);
  expect(second.player).toBe('a');
  game.room.decisions.submit(second.id, second.token, { kind: 'physical', card: 'slash1' });
  await running;
  expect(game.room.world.player('b').hp).toBe(2);
  const responses = game.room.history.facts(CardEvent.responded);
  expect(responses).toHaveLength(2);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
});

it('响应中使用闪的后效与处理区关闭完成后，上层用牌才返回', async () => {
  const game = cardGame({ hands: { b: [card('jink', 'jink')] } });
  const order: string[] = [];
  game.room.on(Use.finished, {
    id: 'after-response',
    owner: 'a',
    eligible: (_ctx, use) => use.card.name === 'standard:jink',
    run: async (ctx) => {
      await ctx.flow('nested', () => {
        order.push('nested response effect');
      });
    },
  });
  const running = use(game, slash).then(() => {
    order.push('use done');
  });
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'jink' });
  await running;
  expect(order).toEqual(['nested response effect', 'use done']);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
});

it('多个效果重复取消同一目标是幂等的，不导致已付费对局崩溃', async () => {
  const game = cardGame();
  for (const id of ['one', 'two'])
    game.room.on(Target.confirming, {
      id,
      owner: 'b',
      eligible: () => true,
      run: (ctx, event) => {
        event.effect.cancel(ctx, id);
      },
    });
  expect(await use(game, slash)).toMatchObject({
    value: { use: { effects: [{ state: 'cancelled', reason: 'one' }] } },
  });
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.zone('discard').cards).toEqual(['slash1']);
  expect(game.room.status).toBe('ready');
});

it('距离修正经具名查询参与同一目标验证，不需要特殊杀实现', async () => {
  const game = cardGame({
    rules: [
      modify(cardQueries.distanceCorrection, (ctx, { input: { from } }) =>
        from === 'a' && ctx.world.player(from).hp === 4 ? -1 : 0,
      ),
    ],
  });
  await game.room.run('live-policy', (ctx) => {
    expect(distance(ctx, 'a', 'c')).toBe(1);
    ctx.commit(testTiming('wound'), [{ kind: 'vitality', player: 'a', hp: 3 }], null);
    expect(distance(ctx, 'a', 'c')).toBe(2);
    ctx.commit(testTiming('recover'), [{ kind: 'vitality', player: 'a', hp: 4 }], null);
    expect(distance(ctx, 'a', 'c')).toBe(1);
  });
  expect(await use(game, { ...slash, targets: ['c'] })).toMatchObject({ value: { kind: 'used' } });
  expect(game.room.world.player('c').hp).toBe(3);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});
