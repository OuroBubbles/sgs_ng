import { expect, it } from 'vitest';
import {
  installCounterspells,
  targetConfirming,
  effectFinished,
  cardsRevealed,
  withRevealedCards,
  moveCards,
  kill,
  useDeclared,
  defineSkill,
  viewAs,
  chooseOwnedCard,
} from '../../src/sdk';
import type { CardDefinition } from '../../src/sdk';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';

const automatic = (name: string) =>
  ({
    actor: 'a',
    choice: { kind: 'physical', card: name },
    targets: [],
    timing: { kind: 'effect' },
  }) as const;
async function choose(game: ReturnType<typeof cardGame>, player: string, id?: string) {
  const request = await nextRequest(game.room);
  expect(request).toMatchObject({ kind: 'cards-targets', player, optional: false });
  const data = request.data as { preview: { cards: readonly { id: string; label: string }[] } };
  const option = id ?? data.preview.cards[0]!.id;
  expect(
    game.room.decisions.submit(request.id, request.token, { cards: [option], targets: [] }).kind,
  ).toBe('accepted');
  return data.preview.cards;
}

it.each(['savage_assault', 'archery_attack'])(
  '%s 自动宣告完整目标，各目标独立响应，不能手工选择子集',
  async (name) => {
    const response = name === 'savage_assault' ? 'slash' : 'jink';
    const game = cardGame({
      hands: { a: [card(name, name)], b: [card('answer', response)], c: [], d: [] },
      policy: { prohibitTarget: (_ctx, _from, target) => target === 'c' },
    });
    expect(await use(game, { ...automatic(name), targets: ['b'] })).toMatchObject({
      value: { kind: 'unavailable' },
    });
    const running = use(game, automatic(name));
    const request = await nextRequest(game.room);
    expect(request.player).toBe('b');
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'answer' });
    const result = await running;
    expect(result).toMatchObject({
      value: { use: { effects: [{ target: 'b' }, { target: 'd' }] } },
    });
    expect(game.room.world.snapshot.players.map((player) => player.hp)).toEqual([4, 4, 4, 3]);
    expect(game.room.history.facts('card.used')[0]!.data.detail).toMatchObject({
      declaration: { targets: ['b', 'd'] },
    });
  },
);

it('无懈只取消南蛮当前目标，之后的目标继续响应或受伤', async () => {
  const game = cardGame({
    hands: {
      a: [card('aoe', 'savage_assault')],
      b: [card('n', 'nullification')],
      c: [card('s', 'slash')],
      d: [],
    },
  });
  installCounterspells(game.room, game.book);
  const running = use(game, automatic('aoe'));
  let request = await nextRequest(game.room);
  expect(request.player).toBe('b');
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'n' });
  request = await nextRequest(game.room);
  expect(request).toMatchObject({ kind: 'card-response', player: 'c' });
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 's' });
  expect(await running).toMatchObject({
    value: {
      use: {
        effects: [
          { target: 'b', state: 'cancelled' },
          { target: 'c', state: 'resolved' },
          { target: 'd', state: 'resolved' },
        ],
      },
    },
  });
  expect(game.room.world.snapshot.players.map((player) => player.hp)).toEqual([4, 4, 4, 3]);
});

it('自动目标在宣告时固定，前一目标效果中死亡的后续角色直接跳过', async () => {
  const game = cardGame({ hands: { a: [card('aoe', 'savage_assault')], b: [], c: [], d: [] } });
  game.room.on(targetConfirming, {
    id: 'kill-next',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    async run(ctx) {
      await kill(ctx, {
        player: 'c',
        killer: null,
        reason: 'rule',
        cause: { kind: 'rule', seq: null, data: null },
      });
    },
  });
  expect(await use(game, automatic('aoe'))).toMatchObject({
    value: {
      use: {
        effects: [
          { target: 'b', state: 'resolved' },
          { target: 'c', state: 'skipped' },
          { target: 'd', state: 'resolved' },
        ],
      },
    },
  });
  expect(game.room.world.player('d').hp).toBe(3);
});

it('桃园保留全部目标，未受伤者在效果前跳过，不提前消费无懈', async () => {
  const game = cardGame({
    hands: { a: [card('heal', 'god_salvation')], b: [], c: [card('n', 'nullification')], d: [] },
  });
  installCounterspells(game.room, game.book);
  await game.room.run('wounded', (ctx) => {
    ctx.commit(
      'wounded',
      [
        { kind: 'vitality', player: 'b', hp: 3 },
        { kind: 'vitality', player: 'd', hp: 1 },
      ],
      null,
    );
  });
  const running = use(game, automatic('heal'));
  const request = await nextRequest(game.room);
  expect(request.prompt).toContain('b');
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'n' });
  expect(await running).toMatchObject({
    value: {
      use: {
        effects: [
          { target: 'a', state: 'skipped' },
          { target: 'b', state: 'cancelled' },
          { target: 'c', state: 'skipped' },
          { target: 'd', state: 'resolved' },
        ],
      },
    },
  });
  expect(game.room.world.snapshot.players.map((player) => player.hp)).toEqual([4, 3, 4, 2]);
});

it('五谷共享公开牌池，某目标被无懈后不取牌；余牌与用牌材料各自善后', async () => {
  const game = cardGame({
    hands: { a: [card('grace', 'amazing_grace')], b: [card('n', 'nullification')], c: [], d: [] },
    draw: ['x', 'y', 'z', 'w'].map((id) => card(id, 'slash')),
  });
  installCounterspells(game.room, game.book);
  const running = use(game, automatic('grace'));
  let request = await nextRequest(game.room);
  game.room.decisions.cancel(request.id, request.token); // 不反制 a。
  await choose(game, 'a', 'x');
  request = await nextRequest(game.room);
  expect(request.prompt).toContain('b');
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'n' });
  await choose(game, 'c', 'z');
  await choose(game, 'd', 'y');
  await running;
  expect(game.room.world.zone('b:hand').cards).toEqual([]);
  expect(game.room.world.zone('discard').cards).toEqual(['n', 'w', 'grace']);
  expect(game.room.history.facts('draw.completed')).toEqual([]);
  expect(game.room.history.facts('cards.revealed')).toHaveLength(1);
  expect(game.room.world.snapshot.zones.filter((zone) => zone.kind === 'processing')).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('公开牌池牌不足时洗入弃牌，仍不足则只展示实有牌，绝不借走用牌材料', async () => {
  const game = cardGame({
    hands: { a: [card('grace', 'amazing_grace')], b: [], c: [], d: [] },
    draw: [card('top', 'slash')],
    discard: [card('last', 'jink')],
  });
  const running = use(game, automatic('grace'));
  const first = await choose(game, 'a', 'top');
  expect(first.map((card) => card.id)).toEqual(['top', 'last']);
  await choose(game, 'b', 'last');
  await running;
  expect(game.room.world.zone('c:hand').cards).toEqual([]);
  expect(game.room.world.zone('d:hand').cards).toEqual([]);
  expect(game.room.world.zone('discard').cards).toEqual(['grace']);
});

it('嵌套五谷的两个共享牌池由各自闭包拥有，内层不覆盖外层候选', async () => {
  const game = cardGame({
    hands: { a: [card('grace', 'amazing_grace')], b: [], c: [], d: [] },
    draw: Array.from({ length: 8 }, (_, i) => card(`p${i}`, 'slash')),
  });
  let nested = false;
  const pools: string[] = [];
  game.room.on(cardsRevealed, {
    id: 'nested-grace',
    owner: null,
    eligible: () => true,
    async run(ctx, pool) {
      pools.push(pool.zone);
      if (nested) return;
      nested = true;
      await game.book.use(ctx, {
        actor: 'b',
        choice: {
          kind: 'generated',
          face: { name: 'standard:amazing_grace' },
          materials: [],
          reason: 'probe',
        },
        targets: [],
        timing: { kind: 'effect' },
      });
      expect(ctx.world.zone(pool.zone).cards).toEqual(['p0', 'p1', 'p2', 'p3']);
    },
  });
  const running = use(game, automatic('grace'));
  for (const player of ['b', 'c', 'd', 'a', 'a', 'b', 'c', 'd']) await choose(game, player);
  await running;
  expect(new Set(pools).size).toBe(2);
  for (const player of ['a', 'b', 'c', 'd'])
    expect(game.room.world.zone(`${player}:hand`).cards).toHaveLength(2);
  expect(game.room.world.zone('discard').cards).toEqual(['grace']);
});

it('顺手暗选不给出隐藏牌 ID/牌名，实体 ID 不能冒充选项，实际移牌仍有明确身份', async () => {
  const game = cardGame({
    hands: { a: [card('snatch', 'snatch')], b: [card('secret-b', 'peach')], c: [], d: [] },
  });
  const running = use(game, { ...automatic('snatch'), targets: ['b'] });
  const request = await nextRequest(game.room);
  expect(JSON.stringify(request.data)).not.toContain('secret-b');
  expect(JSON.stringify(request.data)).not.toContain('peach');
  expect(
    game.room.decisions.submit(request.id, request.token, { cards: ['secret-b'], targets: [] })
      .kind,
  ).toBe('rejected');
  const data = request.data as { preview: { cards: readonly { id: string; label: string }[] } };
  expect(data.preview.cards[0]!.label).toContain('未知手牌');
  game.room.decisions.submit(request.id, request.token, {
    cards: [data.preview.cards[0]!.id],
    targets: [],
  });
  await running;
  expect(game.room.world.position('secret-b')).toBe('a:hand');
  expect(game.room.history.facts('card.taken')[0]!.data.detail).toMatchObject({
    card: 'secret-b',
    open: false,
  });
});

it('顺手受距离限制，拆桥可选远处公开装备和判定牌，但不碰私有特殊区', async () => {
  const game = cardGame({
    hands: {
      a: [
        card('snatch', 'snatch'),
        card('dismantle', 'dismantlement'),
        card('dismantle2', 'dismantlement'),
        card('dismantle3', 'dismantlement'),
      ],
      b: [],
      c: [card('judge', 'peach'), card('secret', 'slash')],
      d: [],
    },
    equipment: { c: [card('equipment', 'jink')] },
  });
  await game.room.run('zones', async (ctx) => {
    ctx.commit(
      'zones',
      [
        {
          kind: 'createZone',
          zone: { id: 'c:judgment', owner: 'c', kind: 'judgment', scopeId: null, cards: [] },
        },
        {
          kind: 'createZone',
          zone: { id: 'c:special', owner: 'c', kind: 'special', scopeId: null, cards: [] },
        },
      ],
      null,
    );
    await moveCards(
      ctx,
      [
        { cards: ['judge'], from: 'c:hand', to: 'c:judgment', place: 'bottom' },
        { cards: ['secret'], from: 'c:hand', to: 'c:special', place: 'bottom' },
      ],
      'setup',
    );
  });
  expect(await use(game, { ...automatic('snatch'), targets: ['c'] })).toMatchObject({
    value: { kind: 'unavailable' },
  });
  for (const [id, label] of [
    ['dismantle', '桃'],
    ['dismantle2', '闪'],
  ]) {
    const running = use(game, { ...automatic(id!), targets: ['c'] });
    const request = await nextRequest(game.room);
    const data = request.data as { preview: { cards: readonly { id: string; label: string }[] } };
    const option = data.preview.cards.find((item) => item.label.includes(label!))!;
    game.room.decisions.submit(request.id, request.token, { cards: [option.id], targets: [] });
    await running;
  }
  expect(game.room.world.position('judge')).toBe('discard');
  expect(game.room.world.position('equipment')).toBe('discard');
  expect(game.room.world.position('secret')).toBe('c:special');
  expect(await use(game, { ...automatic('dismantle3'), targets: ['c'] })).toMatchObject({
    value: { kind: 'unavailable' },
  });
});

it('目标在确认中失去全部可选牌，拆桥不再弹出空选择；来源死亡也不再要求选牌', async () => {
  for (const dead of [false, true]) {
    const game = cardGame({
      hands: { a: [card('dismantle', 'dismantlement')], b: [card('b', 'peach')] },
    });
    game.room.on(targetConfirming, {
      id: 'unavailable',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        if (dead)
          await kill(ctx, {
            player: 'a',
            killer: null,
            reason: 'rule',
            cause: { kind: 'rule', seq: null, data: null },
          });
        else
          await moveCards(
            ctx,
            [{ cards: ['b'], from: 'b:hand', to: 'c:hand', place: 'bottom' }],
            'move-away',
          );
      },
    });
    expect(await use(game, { ...automatic('dismantle'), targets: ['b'] })).toMatchObject({
      value: { use: { effects: [{ state: 'skipped' }] } },
    });
    expect(game.room.decisions.pending).toEqual([]);
  }
});

it('整牌本体不能遗漏或重复执行目标；发生作者错误时不回滚已经产生的效果', async () => {
  for (const twice of [false, true]) {
    const definition: CardDefinition = {
      type: 'trick',
      id: 'probe:body',
      label: '本体',
      use: {
        count: { min: 1, max: 1 },
        target: () => true,
        resolve(ctx, { effect }) {
          ctx.commit('probe:resolved', [{ kind: 'vitality', player: effect.target, hp: 3 }], null);
        },
        async execute(ctx, { resolveTargets }) {
          if (!twice) return;
          await resolveTargets(ctx);
          await resolveTargets(ctx);
        },
      },
    };
    const game = cardGame({
      hands: { a: [{ ...card('body', 'slash'), name: definition.id }] },
      definitions: [definition],
    });
    await expect(use(game, { ...automatic('body'), targets: ['b'] })).rejects.toThrow(
      twice ? 'once' : 'unresolved',
    );
    expect(game.room.status).toBe('faulted');
    expect(game.room.history.facts('probe:resolved')).toHaveLength(twice ? 1 : 0);
  }
});

it('全部目标被取消仍须调度一次，保留每个效果的完成事实和后效', async () => {
  for (const dispatched of [false, true]) {
    const definition: CardDefinition = {
      type: 'trick',
      id: 'probe:cancelled-body',
      label: '取消本体',
      use: {
        count: { min: 1, max: 1 },
        target: () => true,
        async execute(ctx, { use: plan, resolveTargets }) {
          for (const effect of plan.effects) plan.removeTarget(ctx, effect.effectId, 'probe');
          if (dispatched) await resolveTargets(ctx);
        },
      },
    };
    const game = cardGame({
      hands: { a: [{ ...card('body', 'slash'), name: definition.id }] },
      definitions: [definition],
    });
    game.room.on(effectFinished, {
      id: 'finished',
      owner: null,
      eligible: () => true,
      run(ctx, { effect }) {
        ctx.commit('probe:finished', [], effect);
      },
    });
    const running = use(game, { ...automatic('body'), targets: ['b'] });
    if (!dispatched) {
      await expect(running).rejects.toThrow('unresolved');
      expect(game.room.status).toBe('faulted');
      expect(game.room.history.facts('card.effect')).toHaveLength(0);
    } else {
      expect(await running).toMatchObject({
        value: { kind: 'used', use: { effects: [{ target: 'b', state: 'cancelled' }] } },
      });
      expect(game.room.history.facts('card.effect')).toHaveLength(1);
      expect(game.room.history.facts('probe:finished')).toHaveLength(1);
      expect(game.room.world.position('body')).toBe('discard');
    }
  }
});

it('公开处理区的牌可被后效取走，善后只处置实时余牌', async () => {
  const game = cardGame({ hands: { a: [] }, draw: [card('x', 'slash'), card('y', 'jink')] });
  game.room.on(cardsRevealed, {
    id: 'take',
    owner: null,
    eligible: () => true,
    async run(ctx, pool) {
      await moveCards(
        ctx,
        [{ cards: ['x'], from: pool.zone, to: 'a:hand', place: 'bottom' }],
        'take',
      );
    },
  });
  await game.room.run('reveal', (ctx) =>
    withRevealedCards(ctx, { count: 2, reason: 'probe' }, (_ctx, pool) => {
      expect(pool.remaining()).toEqual(['y']);
    }),
  );
  expect(game.room.world.position('x')).toBe('a:hand');
  expect(game.room.world.position('y')).toBe('discard');
});

it('作者转换可借用五谷公开牌池材料反制当前目标，两个处理区不会重复弃置', async () => {
  const skill = defineSkill({
    id: 'probe:pool-counter',
    name: '借牌反制',
    triggers: [],
    viewAs: [
      viewAs({
        id: 'pool',
        label: '借牌',
        names: () => ['standard:nullification'],
        count: { min: 1, max: 1 },
        materials(ctx) {
          const pools = new Set(
            ctx.history
              .facts('cards.revealed')
              .map((fact) => (fact.data.detail as { zone: string }).zone),
          );
          return ctx.world.snapshot.zones
            .filter((zone) => pools.has(zone.id))
            .flatMap((zone) => zone.cards.filter((id) => id === 'x'));
        },
        make: () => ({ name: 'standard:nullification' }),
      }),
    ],
  });
  const game = cardGame({
    hands: { a: [card('grace', 'amazing_grace')], b: [], c: [], d: [] },
    draw: ['x', 'y', 'z', 'w'].map((id) => card(id, 'slash')),
    skills: [skill],
  });
  installCounterspells(game.room, game.book);
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'b', skill: skill.id, source: { kind: 'general', id: 'b' } }),
  );
  let processingCount = 0;
  game.room.on(useDeclared, {
    id: 'processing-count',
    owner: null,
    eligible: (_ctx, use) => use.card.name === 'standard:nullification',
    run(ctx) {
      processingCount = ctx.world.snapshot.zones.filter(
        (zone) => zone.kind === 'processing',
      ).length;
    },
  });
  const running = use(game, automatic('grace'));
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, {
    kind: 'viewAs',
    instance: game.room.world.snapshot.skills[0]!.id,
    recipe: 'pool',
    materials: ['x'],
  });
  for (const player of ['b', 'c', 'd']) await choose(game, player);
  await running;
  expect(processingCount).toBe(3);
  expect(game.room.world.zone('a:hand').cards).toEqual([]);
  expect(game.room.world.zone('discard').cards).toEqual(['x', 'grace']);
  expect(game.room.world.snapshot.zones.filter((zone) => zone.kind === 'processing')).toEqual([]);
});

it('扩展选择特殊私有区时默认仍暗选，选择与移动分离', async () => {
  const game = cardGame({ hands: { a: [], b: [card('secret-special', 'peach')] } });
  await game.room.run('setup', async (ctx) => {
    ctx.commit(
      'zone',
      [
        {
          kind: 'createZone',
          zone: { id: 'b:private', kind: 'special', owner: 'b', scopeId: null, cards: [] },
        },
      ],
      null,
    );
    await moveCards(
      ctx,
      [{ cards: ['secret-special'], from: 'b:hand', to: 'b:private', place: 'bottom' }],
      'setup',
    );
  });
  const running = game.room.run('choose', (ctx) =>
    chooseOwnedCard(ctx, game.book, {
      actor: 'a',
      target: 'b',
      areas: ['special'],
      reason: 'probe',
    }),
  );
  const request = await nextRequest(game.room);
  expect(JSON.stringify(request.data)).not.toContain('secret-special');
  expect(JSON.stringify(request.data)).not.toContain('peach');
  await choose(game, 'a');
  expect(await running).toMatchObject({
    value: { kind: 'chosen', card: 'secret-special' },
  });
  expect(game.room.world.position('secret-special')).toBe('b:private');
});
