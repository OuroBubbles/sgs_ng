import { expect, it } from 'vitest';
import {
  defineSkill,
  viewAs,
  ownedCards,
  useDeclared,
  effectStarting,
  effectFinished,
  damageReceived,
} from '../../src/sdk';
import { wusheng } from '../../src/content/standard/wusheng';
import type { CardChoice } from '../../src/sdk';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';

const slash = { actor: 'a', targets: ['b'], timing: { kind: 'effect' } } as const;
const source = { kind: 'general', id: 'a' } as const;

it('武圣仅转换红色材料，牌名/距离/目标/响应复用普通杀管线', async () => {
  const game = cardGame({ skills: [wusheng], hands: { b: [card('jink', 'jink')] } });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: wusheng.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]?.id ?? '';
  const choice: CardChoice = {
    kind: 'viewAs',
    instance,
    recipe: 'red-slash',
    materials: ['peach'],
  };
  expect(await use(game, { ...slash, choice, targets: ['c'] })).toMatchObject({
    value: { kind: 'unavailable' },
  });
  expect(await use(game, { ...slash, choice: { ...choice, materials: ['slash1'] } })).toMatchObject(
    { value: { kind: 'unavailable' } },
  );
  const running = use(game, { ...slash, choice });
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'jink' });
  const result = await running;
  expect(result).toMatchObject({
    value: {
      use: {
        card: {
          name: 'standard:slash',
          suit: 'heart',
          rank: 3,
          materials: ['peach'],
          source: { kind: 'viewAs', skill: wusheng.id },
        },
      },
    },
  });
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.zone('discard').cards).toEqual(['jink', 'peach']);
});

it('装备区红色材料也能转换，不受固定手牌入口限制', async () => {
  const game = cardGame({
    hands: { a: [] },
    equipment: { a: [card('red-equipment-material', 'jink', 'diamond', 9)] },
    skills: [wusheng],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: wusheng.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]?.id ?? '';
  expect(
    await use(game, {
      ...slash,
      choice: {
        kind: 'viewAs',
        instance,
        recipe: 'red-slash',
        materials: ['red-equipment-material'],
      },
    }),
  ).toMatchObject({ value: { kind: 'used' } });
  expect(game.room.world.zone('a:equipment').cards).toEqual([]);
  expect(game.room.world.player('b').hp).toBe(3);
});

it('零材料配方在空手时仍出现并完成用牌，不创建虚假实体牌', async () => {
  const zero = defineSkill({
    id: 'test:zero',
    name: 'zero',
    effects: [],
    viewAs: [
      viewAs({
        id: 'slash',
        label: 'zero slash',
        names: () => ['standard:slash'],
        materials: () => [],
        count: { min: 0, max: 0 },
        make: () => ({ name: 'standard:slash' }),
      }),
    ],
  });
  const game = cardGame({ hands: { a: [] }, skills: [zero] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: zero.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]?.id ?? '';
  await game.room.run('offers', (ctx) => {
    expect(game.book.offers(ctx, 'a', 'use')).toMatchObject([
      { kind: 'viewAs', materials: [], count: { min: 0, max: 0 } },
    ]);
  });
  expect(
    await use(game, {
      ...slash,
      choice: { kind: 'viewAs', instance, recipe: 'slash', materials: [] },
    }),
  ).toMatchObject({ value: { use: { card: { suit: 'none', rank: 0, materials: [] } } } });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.snapshot.cards).toHaveLength(0);
});

it('多材料与动态牌名按实际参数构造，同一配方无需固定牌名或一张材料', async () => {
  const flexible = defineSkill({
    id: 'test:flexible',
    name: 'flexible',
    effects: [],
    viewAs: [
      viewAs({
        id: 'choose-name',
        label: 'flexible',
        names: () => ['standard:slash', 'standard:duel'],
        materials: (ctx, self) => ownedCards(ctx.world, self.owner),
        count: (ctx, self) => ({ min: ctx.world.player(self.owner).hp === 4 ? 2 : 1, max: 2 }),
        make: (_ctx, _self, _materials, parameters) =>
          parameters === 'standard:duel' || parameters === 'standard:slash'
            ? { name: parameters }
            : null,
      }),
    ],
  });
  const game = cardGame({ skills: [flexible] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: flexible.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]?.id ?? '';
  const choice: CardChoice = {
    kind: 'viewAs',
    instance,
    recipe: 'choose-name',
    materials: ['slash1', 'slash2'],
    parameters: 'standard:duel',
  };
  expect(await use(game, { ...slash, choice })).toMatchObject({
    value: { use: { card: { name: 'standard:duel', rank: 0, materials: ['slash1', 'slash2'] } } },
  });
  expect(game.room.world.zone('discard').cards).toEqual(['slash1', 'slash2']);
});

it('重复材料、错误参数、未知配方与错误拥有者均不支付', async () => {
  const game = cardGame({ skills: [wusheng] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: wusheng.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]?.id ?? '';
  for (const choice of [
    { kind: 'viewAs', instance, recipe: 'red-slash', materials: ['peach', 'peach'] },
    { kind: 'viewAs', instance: 'missing', recipe: 'red-slash', materials: ['peach'] },
    { kind: 'viewAs', instance, recipe: 'missing', materials: ['peach'] },
  ] as const)
    expect(await use(game, { ...slash, choice })).toMatchObject({ value: { kind: 'unavailable' } });
  expect(game.room.history.facts('card.used')).toEqual([]);
  expect(game.room.world.zone('a:hand').cards).toContain('peach');
});

it('统一禁止规则也约束转换牌，失效后不能使用旧配方候选', async () => {
  const game = cardGame({
    skills: [wusheng],
    policy: { prohibitUse: (_ctx, _actor, card) => card.name === 'standard:slash' },
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: wusheng.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]?.id ?? '';
  const choice: CardChoice = {
    kind: 'viewAs',
    instance,
    recipe: 'red-slash',
    materials: ['peach'],
  };
  expect(await use(game, { ...slash, choice })).toMatchObject({ value: { kind: 'unavailable' } });
  await game.room.run('lose', (ctx) => game.skills.revoke(ctx, 'a', wusheng.id, source));
  expect(await use(game, { ...slash, choice })).toMatchObject({ value: { kind: 'unavailable' } });
  expect(game.room.world.zone('discard').cards).toEqual([]);
});

it('宣告后失去转换技能不会改变本次冻结牌面或吞掉已经产生的效果', async () => {
  const game = cardGame({ skills: [wusheng] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: wusheng.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]?.id ?? '';
  game.room.on(useDeclared, {
    id: 'lose',
    owner: 'b',
    eligible: () => true,
    run: async (ctx) => {
      await game.skills.revoke(ctx, 'a', wusheng.id, source);
    },
  });
  const result = await use(game, {
    ...slash,
    choice: { kind: 'viewAs', instance, recipe: 'red-slash', materials: ['peach'] },
  });
  expect(result).toMatchObject({
    value: { kind: 'used', use: { card: { source: { instance } } } },
  });
  expect(game.room.world.snapshot.skills).toEqual([]);
  expect(game.room.world.player('b').hp).toBe(3);
});

it('零材料配方也可响应，同一个目标效果保存完整关联', async () => {
  const zero = defineSkill({
    id: 'test:zero-jink',
    name: 'zero jink',
    effects: [],
    viewAs: [
      viewAs({
        id: 'jink',
        label: 'zero jink',
        names: () => ['standard:jink'],
        materials: () => [],
        count: { min: 0, max: 0 },
        available: (_ctx, _self, purpose) => purpose === 'use',
        make: () => ({ name: 'standard:jink' }),
      }),
    ],
  });
  const game = cardGame({ skills: [zero] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'b', skill: zero.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]?.id ?? '';
  const running = use(game, { ...slash, choice: { kind: 'physical', card: 'slash1' } });
  const request = await nextRequest(game.room);
  expect(request.data).toMatchObject({ offers: [{ kind: 'viewAs', materials: [] }] });
  game.room.decisions.submit(request.id, request.token, {
    kind: 'viewAs',
    instance,
    recipe: 'jink',
    materials: [],
  });
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts('card.responded')).toHaveLength(0);
  expect(game.room.history.facts('card.used')).toHaveLength(2);
});

it('处理区材料可被子用牌借走，子结算结束后父善后不会重复处理', async () => {
  const game = cardGame();
  game.room.on(damageReceived, {
    id: 'reuse-material',
    owner: 'b',
    eligible: (_ctx, hit) => hit.input.to === 'b',
    run: async (ctx, hit) => {
      const material = hit.input.card?.card.materials[0];
      if (!material) throw new Error('Missing material.');
      await game.book.use(ctx, {
        actor: 'b',
        choice: {
          kind: 'generated',
          face: { name: 'standard:slash' },
          materials: [material],
          reason: 'explicit processing material',
        },
        targets: ['c'],
        timing: { kind: 'effect' },
      });
    },
  });
  await use(game, { ...slash, choice: { kind: 'physical', card: 'slash1' } });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.player('c').hp).toBe(3);
  expect(game.room.world.zone('discard').cards).toEqual(['slash1']);
  expect(game.room.history.facts('card.used')).toHaveLength(2);
});

it('具名查询和计划修改均受纯查询守卫约束', async () => {
  const game = cardGame();
  game.room.on(useDeclared, {
    id: 'bad-query',
    owner: 'a',
    eligible: (ctx, plan) => {
      plan.addTarget(ctx, 'd', 'bad');
      return true;
    },
    run: () => undefined,
  });
  await expect(
    use(game, { ...slash, choice: { kind: 'physical', card: 'slash1' } }),
  ).rejects.toThrow('Pure queries');
  expect(game.room.status).toBe('faulted');
  expect(game.room.history.facts('card.used')).toHaveLength(1);
});

it('目标在轮到前死亡则跳过，不再启动其效果', async () => {
  const game = cardGame({ policy: { attackRange: () => 3 } });
  const started: string[] = [];
  game.room.on(useDeclared, {
    id: 'extra',
    owner: 'a',
    eligible: () => true,
    run: (ctx, plan) => {
      plan.addTarget(ctx, 'c', 'extra');
    },
  });
  game.room.on(effectFinished, {
    id: 'kill-next',
    owner: 'a',
    eligible: (_ctx, event) => event.effect.target === 'b',
    run: (ctx) => {
      ctx.commit('c.died', [{ kind: 'vitality', player: 'c', hp: 0, alive: false }], {});
    },
  });
  game.room.on(effectStarting, {
    id: 'observe',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, event) => {
      started.push(event.effect.target);
    },
  });
  const result = await use(game, { ...slash, choice: { kind: 'physical', card: 'slash1' } });
  expect(started).toEqual(['b']);
  expect(result).toMatchObject({
    value: { use: { effects: [{ state: 'resolved' }, { target: 'c', state: 'skipped' }] } },
  });
});
