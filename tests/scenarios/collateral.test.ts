import { expect, it } from 'vitest';
import {
  equip,
  cardQueries,
  defineSkill,
  modify,
  playPhase,
  runPhase,
  installCounterspells,
  moveCards,
  withLifetime,
  Use,
  useCard,
  useSelection,
  validateUse,
} from '../../src/sdk';
import type { CardOffer, UseIntent } from '../../src/sdk';
import { wusheng } from '../../src/content/standard/generals/guanyu';
import { card, cardGame, use, die } from '../fixtures/cards';
import { nextRequest, answer } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { CardEvent } from '../../src/sdk';
import { Collateral } from '../../src/content/standard/collateral';
import { Equipment } from '../../src/sdk';

type Game = ReturnType<typeof cardGame>;
const intent = (parameters: unknown = { victim: 'c' }): UseIntent => ({
  actor: 'a',
  choice: { kind: 'physical', card: 'borrow' },
  targets: ['b'],
  timing: { kind: 'effect' },
  parameters,
});
function create(slashes = 0) {
  return cardGame({
    hands: {
      a: [card('borrow', 'collateral')],
      b: Array.from({ length: slashes }, (_, i) => card(`s${i}`, 'slash')),
    },
    equipment: { b: [card('weapon', 'crossbow')] },
  });
}
function killPlayer(game: Game, target: string) {
  game.room.on(Use.declared, {
    id: `kill-${target}`,
    owner: null,
    eligible: (_ctx, use) => use.card.name === 'standard:collateral',
    async run(ctx) {
      await die(ctx, target);
    },
  });
}

it('同一草稿提交持械者与出杀目标；锦囊只结算持械者，随后完整使用杀', async () => {
  const game = create(1);
  const running = game.room.run('phase', (ctx) =>
    runPhase(ctx, 'a', 'play', (at, phase) => playPhase(at, phase)),
  );
  const request = await nextRequest(game.room);
  expect(request).toMatchObject({
    player: 'a',
    kind: 'play-action',
  });
  expect(game.room.world.position('borrow')).toBe('a:hand');
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(0);
  expect(
    game.room.decisions.submit(request.id, request.token, {
      choice: intent().choice,
      targets: ['b'],
    }).kind,
  ).toBe('rejected');
  expect(game.room.decisions.pending[0]?.id).toBe(request.id);
  await answer(game, { choice: intent().choice, targets: ['b', 'c'] }, 'play-action');
  const useRequest = await nextRequest(game.room);
  expect(useRequest).toMatchObject({
    player: 'b',
    kind: 'use-card',
    data: { targets: ['c'], timing: 'effect' },
  });
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  await answer(game, { kind: 'physical', card: 's0' }, 'use-card');
  expect((await running).kind).toBe('resolved');
  expect(game.room.history.facts(CardEvent.finished)[1]?.data.detail).toMatchObject({
    parameters: { victim: 'c' },
    effects: [{ target: 'b' }],
  });
  expect(game.room.world.player('c').hp).toBe(3);
  expect(game.room.world.position('weapon')).toBe('b:equipment');
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('取消附属选择不支付、不开放反制，且没有遗留处理区', async () => {
  const game = create();
  const running = game.room.run('selection', async (ctx) => {
    const { actor, choice, timing } = intent();
    return ctx.ask(useSelection(ctx, { actor, choice, timing }));
  });
  const request = await nextRequest(game.room);
  expect(game.room.decisions.cancel(request.id, request.token).kind).toBe('accepted');
  expect(await running).toMatchObject({ value: { kind: 'cancelled' } });
  expect(game.room.world.position('borrow')).toBe('a:hand');
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(0);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
});

it('没有杀自动获得武器；选择拒绝用杀时同样获得，装备能力随实体离场', async () => {
  for (const count of [0, 1]) {
    const game = create(count);
    const running = use(game, intent());
    if (count) {
      const request = await nextRequest(game.room);
      game.room.decisions.cancel(request.id, request.token);
    }
    await running;
    expect(game.room.world.position('weapon')).toBe('a:hand');
    expect(game.room.history.facts(Collateral.weaponTaken)).toHaveLength(1);
    expect(
      game.skills.bindings(game.room.world).some(({ self }) => self.origin?.id === 'weapon'),
    ).toBe(false);
    expect(game.room.world.player('c').hp).toBe(4);
  }
});

it.each([null, {}, { victim: 'b' }, { victim: 'd' }, { victim: 'unknown' }])(
  '附属目标无效时不宣告、不支付：%j',
  async (parameters) => {
    const game = create();
    expect(await use(game, intent(parameters))).toMatchObject({ value: { kind: 'unavailable' } });
    expect(game.room.world.position('borrow')).toBe('a:hand');
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(0);
  },
);

it('受害者可以是借刀者；禁止锦囊指定受害者不冒充禁止指定真正目标', async () => {
  const game = cardGame({
    hands: { a: [card('borrow', 'collateral')], b: [card('slash', 'slash')] },
    equipment: { b: [card('weapon', 'crossbow')] },
    rules: [
      modify(
        cardQueries.prohibitTarget,
        (_ctx, { input: { target, card: face } }) =>
          face.name === 'standard:collateral' && target === 'a',
      ),
    ],
  });
  const running = use(game, intent({ victim: 'a' }));
  await answer(game, { kind: 'physical', card: 'slash' }, 'use-card');
  await running;
  expect(game.room.world.player('a').hp).toBe(3);
  expect(game.room.world.position('weapon')).toBe('b:equipment');
});

it('没有任何合法杀目标或持武器者被禁止时，借刀不可用', async () => {
  for (const prohibitTarget of [
    modify(
      cardQueries.prohibitTarget,
      (_ctx, { input: { card } }) => card.name === 'standard:slash',
    ),
    modify(
      cardQueries.prohibitTarget,
      (_ctx, { input: { target, card } }) => card.name === 'standard:collateral' && target === 'b',
    ),
  ]) {
    const game = cardGame({
      hands: { a: [card('borrow', 'collateral')] },
      equipment: { b: [card('weapon', 'crossbow')] },
      rules: [prohibitTarget],
    });
    expect(await use(game, intent())).toMatchObject({
      value: { kind: 'unavailable' },
    });
    expect(game.room.decisions.pending).toHaveLength(0);
  }
});

it('杀被仁王盾抵消仍已履行用杀，不再交武器', async () => {
  const game = cardGame({
    hands: { a: [card('borrow', 'collateral')], b: [card('s', 'slash')] },
    equipment: { b: [card('weapon', 'crossbow')], c: [card('shield', 'nioh_shield')] },
  });
  const running = use(game, intent());
  await answer(game, { kind: 'physical', card: 's' }, 'use-card');
  await running;
  expect(game.room.world.player('c').hp).toBe(4);
  expect(game.room.world.position('weapon')).toBe('b:equipment');
  expect(game.room.history.facts(Equipment.blocked)).toHaveLength(1);
  expect(game.room.history.facts(Collateral.weaponTaken)).toHaveLength(0);
});

it('被要求的杀可用转换配方，仍是用牌而非打出响应', async () => {
  const game = cardGame({
    hands: { a: [card('borrow', 'collateral')], b: [card('red', 'peach', 'heart')] },
    equipment: { b: [card('weapon', 'crossbow')] },
    skills: [wusheng],
  });
  await game.room.run('grant', async (ctx) => {
    await game.skills.grant(ctx, {
      owner: 'b',
      skill: wusheng.id,
      source: { kind: 'general', id: 'guan-yu' },
    });
  });
  const running = use(game, intent());
  const request = await nextRequest(game.room);
  const offer = (request.data as { offers: CardOffer[] }).offers.find(
    (offer) => offer.label === '武圣',
  )!;
  await answer(game, { kind: 'viewAs', ...offer.choice, materials: ['red'] }, 'use-card');
  await running;
  expect(game.room.world.player('c').hp).toBe(3);
  expect(game.room.world.position('red')).toBe('discard');
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
});

it('借刀额外用杀不受出牌阶段限次影响，也不消耗新的阶段次数', async () => {
  const game = cardGame({
    hands: {
      a: [card('borrow', 'collateral')],
      b: [card('s0', 'slash'), card('s1', 'slash'), card('s2', 'slash')],
    },
    equipment: { b: [card('weapon', 'qinggang_sword')] },
  });
  const running = game.room.run('play', (ctx) =>
    withLifetime(ctx, 'play', async (at, phase) => {
      const play = {
        actor: 'b',
        choice: { kind: 'physical', card: 's0' },
        targets: ['c'],
        timing: { kind: 'play', owner: 'b', phase },
      } as const;
      await useCard(at, play);
      await useCard(at, intent());
      expect(validateUse(at, { ...play, choice: { kind: 'physical', card: 's2' } })).toMatchObject({
        ok: false,
        reason: 'Usage limit reached.',
      });
    }),
  );
  await answer(game, { kind: 'physical', card: 's1' }, 'use-card');
  await running;
  expect(game.room.world.player('c').hp).toBe(2);
});

it.each([false, true])('拒绝用杀时只取结算当前的武器：替换 %s', async (replace) => {
  const game = cardGame({
    hands: { a: [card('borrow', 'collateral')], b: replace ? [card('new', 'qinggang_sword')] : [] },
    equipment: { b: [card('weapon', 'crossbow')] },
  });
  game.room.on(Use.declared, {
    id: 'change-weapon',
    owner: null,
    eligible: (_ctx, use) => use.card.name === 'standard:collateral',
    async run(ctx) {
      if (replace) await equip(ctx, { card: 'new', owner: 'b', from: 'b:hand' });
      else
        await moveCards(
          ctx,
          [{ cards: ['weapon'], from: 'b:equipment', to: 'd:hand', place: 'bottom' }],
          'probe:take',
        );
    },
  });
  await use(game, intent());
  expect(game.room.world.position('weapon')).toBe(replace ? 'discard' : 'd:hand');
  if (replace) expect(game.room.world.position('new')).toBe('a:hand');
  else expect(game.room.history.facts(Collateral.weaponTaken)).toHaveLength(0);
});

it('持武器者死亡则跳过；受害者死亡导致无法出杀时执行交武器分支', async () => {
  for (const target of ['b', 'c']) {
    const game = create(1);
    killPlayer(game, target);
    await use(game, intent());
    expect(game.room.world.position('weapon')).toBe(target === 'b' ? 'discard' : 'a:hand');
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  }
});

it.each([0, 1])('借刀者死亡不吞掉已宣告效果，但不会获得武器：杀数量 %s', async (count) => {
  const game = create(count);
  killPlayer(game, 'a');
  const running = use(game, intent());
  if (count) await answer(game, { kind: 'physical', card: 's0' }, 'use-card');
  await running;
  expect(game.room.world.player('c').hp).toBe(count ? 3 : 4);
  expect(game.room.world.position('weapon')).toBe('b:equipment');
});

it('无懈只反制持武器者上的借刀效果，不向附属目标再开一份锦囊效果', async () => {
  const game = cardGame({
    hands: { a: [card('borrow', 'collateral')], c: [card('n', 'nullification')] },
    equipment: { b: [card('weapon', 'crossbow')] },
  });
  installCounterspells(game.room);
  const running = use(game, intent());
  await answer(game, { kind: 'physical', card: 'n' }, 'use-card');
  const result = await running;
  expect(result).toMatchObject({
    value: { use: { effects: [{ target: 'b', state: 'cancelled' }] } },
  });
  expect(game.room.world.position('weapon')).toBe('b:equipment');
  expect(game.room.history.facts(Collateral.weaponTaken)).toHaveLength(0);
});

it('转移、重复与追加持械者保留同一受害者，各自完整用杀', async () => {
  const extra = defineSkill({
    id: 'probe:collateral-target',
    name: '多目标',
    triggers: [],
    modifiers: [
      modify(cardQueries.extraTargets, (_ctx, { input: use }) =>
        use.card.name === 'standard:collateral' && use.targets.includes('b') ? 1 : undefined,
      ),
    ],
  });
  for (const mode of ['repeat', 'replace', 'additional']) {
    const game = cardGame({
      hands: {
        a: [card('borrow', 'collateral')],
        b: [card('b0', 'slash'), card('b1', 'slash')],
        d: [card('d0', 'slash')],
      },
      equipment: { b: [card('bw', 'crossbow')], d: [card('dw', 'crossbow')] },
      skills: [extra],
    });
    game.room.on(Use.declared, {
      id: 'edit',
      owner: null,
      eligible: (_ctx, use) => use.card.name === 'standard:collateral',
      run: (ctx, use) => {
        if (mode === 'replace')
          use.replaceTarget(ctx, use.effects[0]!.effectId, 'd', 'probe:transfer');
        if (mode === 'repeat') use.repeatTarget(ctx, 'b', 'probe:repeat');
      },
    });
    if (mode === 'additional')
      await game.room.run('grant', (ctx) =>
        game.skills.grant(ctx, {
          owner: 'a',
          skill: extra.id,
          source: { kind: 'general', id: 'probe' },
        }),
      );
    const running =
      mode === 'additional'
        ? game.room.run('use', (ctx) => {
            const { actor, choice, timing } = intent();
            const selection = useSelection(ctx, { actor, choice, timing });
            const selected = selection.validate({ cards: [], targets: ['b', 'd', 'c'] });
            expect(selected).toEqual({
              ok: true,
              value: { targets: ['b', 'd'], parameters: { victim: 'c' } },
            });
            if (!selected.ok) throw new Error(selected.reason);
            return useCard(ctx, { actor, choice, timing, ...selected.value });
          })
        : use(game, intent());
    await answer(game, { kind: 'physical', card: mode === 'replace' ? 'd0' : 'b0' }, 'use-card');
    if (mode !== 'replace')
      await answer(
        game,
        { kind: 'physical', card: mode === 'additional' ? 'd0' : 'b1' },
        'use-card',
      );
    await running;
    expect(game.room.world.player('c').hp).toBe(mode === 'replace' ? 3 : 2);
    expect(game.room.world.position('bw')).toBe('b:equipment');
    expect(game.room.world.position('dw')).toBe('d:equipment');
  }
});

it('外部修改预填参数不改变已宣告受害者', async () => {
  const game = create(1);
  const input = { victim: 'c' };
  const running = use(game, intent(input));
  const request = await nextRequest(game.room);
  input.victim = 'a';
  await answer(game, { kind: 'physical', card: 's0' }, 'use-card');
  await running;
  expect(request.data).toMatchObject({ targets: ['c'] });
  expect(game.room.world.player('c').hp).toBe(3);
  expect(game.room.world.player('a').hp).toBe(4);
});
