import {
  buildCard,
  cardDef,
  cardOffers,
  face,
  hasCardOffers,
  useCard,
  validateUse,
  cardQueries,
  modify,
} from '../../src/sdk';
import { expect, it } from 'vitest';
import { defineSkill, viewAs, ownedCards, Use, Resolve, Damage } from '../../src/sdk';
import wusheng from '../../src/content/standard/skills/wusheng';
import type {
  CardChoice,
  Context,
  SkillDefinition,
  ViewAsInput,
  ViewAsMakeInput,
  ViewAsUseInput,
  UseResult,
} from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

const slash = { actor: 'a', targets: ['b'], timing: { kind: 'effect' } } as const;

it('动态转换数量在菜单、存在性与构牌入口读取时校验，错误不产生规则变更', async () => {
  for (const entry of ['offers', 'has-offers', 'build'] as const) {
    let count = { min: 1, max: 1 };
    const skill = defineSkill({
      id: 'probe:dynamic-count',
      name: '动态数量',
      viewAs: [
        {
          id: 'convert',
          materials: () => ['fee'],
          count: () => count,
          make: { name: 'standard:slash' },
        },
      ],
    });
    const game = cardGame({ skills: [skill], hands: { a: [card('fee', 'jink')] } });
    await game.room.run('grant', (ctx) =>
      game.skills.grant(ctx, { owner: 'a', skill: skill.id, source }),
    );
    await game.room.run('valid', (ctx) => {
      const reads = { min: 0, max: 0 };
      count = {
        get min() {
          return ++reads.min === 1 ? 1 : -1;
        },
        get max() {
          return ++reads.max === 1 ? 1 : 0;
        },
      };
      if (entry === 'offers')
        expect(cardOffers(ctx, 'a', 'use', ['standard:slash'])).toMatchObject([
          { label: '动态数量', count: { min: 1, max: 1 } },
        ]);
      else if (entry === 'has-offers')
        expect(hasCardOffers(ctx, 'a', 'use', ['standard:slash'])).toBe(true);
      else
        expect(
          buildCard(
            ctx,
            'a',
            {
              kind: 'viewAs',
              instance: game.room.world.snapshot.skills[0]!.id,
              recipe: 'convert',
              materials: ['fee'],
            },
            'use',
          ).ok,
        ).toBe(true);
      expect(reads).toEqual({ min: 1, max: 1 });
    });
    const instance = game.room.world.snapshot.skills[0]!.id;
    const before = game.room.world.snapshot;
    const facts = game.room.history.facts();
    count = { min: 1, max: 0 };
    await expect(
      game.room.run(entry, (ctx) => {
        if (entry === 'offers') cardOffers(ctx, 'a', 'use');
        else if (entry === 'has-offers') hasCardOffers(ctx, 'a', 'use', ['standard:slash']);
        else
          buildCard(
            ctx,
            'a',
            { kind: 'viewAs', instance, recipe: 'convert', materials: ['fee'] },
            'use',
          );
      }),
    ).rejects.toThrow('Invalid probe:dynamic-count/convert material count.');
    expect(game.room.status).toBe('faulted');
    expect(game.room.world.snapshot).toBe(before);
    expect(game.room.history.facts()).toEqual(facts);
    expect(game.room.decisions.pending).toEqual([]);
    expect(rebuildWorld(game.initial, facts)).toEqual(before);
  }
});
const source = { kind: 'general', id: 'a' } as const;

it('存在性与菜单共用候选，过滤可提前停止，仍须独立验证实际目标', async () => {
  const game = cardGame({
    hands: { a: [card('black', 'jink', 'spade'), card('red', 'jink', 'heart')] },
    skills: [wusheng],
  });
  await game.room.run('check', async (ctx) => {
    await game.skills.grant(ctx, { owner: 'a', skill: wusheng.id, source });
    for (const purpose of ['use', 'response', { kind: 'effect' }] as const) {
      for (const names of [undefined, ['standard:slash'], ['standard:jink'], ['standard:peach']])
        expect(hasCardOffers(ctx, 'a', purpose, names)).toBe(
          cardOffers(ctx, 'a', purpose, names).length > 0,
        );
    }
    let visited = 0;
    expect(
      hasCardOffers(ctx, 'a', 'response', ['standard:jink'], () => {
        visited++;
        return true;
      }),
    ).toBe(true);
    expect(visited).toBe(1);
    expect(hasCardOffers(ctx, 'a', 'response', ['standard:jink'], () => false)).toBe(false);
    const instance = game.room.world.snapshot.skills[0]!.id;
    expect(hasCardOffers(ctx, 'a', 'use', ['standard:slash'])).toBe(true);
    expect(
      validateUse(ctx, {
        actor: 'a',
        choice: { kind: 'viewAs', instance, recipe: 'red-slash', materials: ['red'] },
        targets: ['c'],
        timing: { kind: 'effect' },
      }).ok,
    ).toBe(false);
    await game.skills.revoke(ctx, 'a', wusheng.id, source);
    expect(hasCardOffers(ctx, 'a', 'use', ['standard:slash'])).toBe(false);
    expect(hasCardOffers(ctx, 'a', 'response', ['standard:jink'])).toBe(true);
  });
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

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

it('零材料固定配方直接使用声明，空手仍能完成用牌且不创建虚假实体牌', async () => {
  class Face {
    #name = 'standard:slash';

    get name() {
      return this.#name;
    }

    set name(value: string) {
      this.#name = value;
    }
  }
  const face = new Face();
  const raw = Object.freeze({
    id: 'slash',
    label: 'zero slash',
    make: face,
  });
  const recipe = viewAs(raw);
  expect(viewAs(recipe)).toBe(recipe);
  expect(() => {
    // @ts-expect-error 材料候选和数量必须整组声明，不能把遗漏误当作零材料。
    return viewAs({ ...raw, materials: () => [] });
  }).toThrow('materials and count must be provided together');
  expect(() => {
    // @ts-expect-error 单独的数量不能替代材料候选。
    return viewAs({ ...raw, count: { min: 0, max: 0 } });
  }).toThrow('materials and count must be provided together');
  const zero = {
    id: 'test:zero',
    name: 'zero',
    viewAs: [raw],
  } satisfies SkillDefinition;
  const game = cardGame({ hands: { a: [] }, skills: [zero] });
  expect(game.skills.definition(zero.id).viewAs![0]).toBe(raw);
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: zero.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]?.id ?? '';
  await game.room.run('offers', (ctx) => {
    expect(hasCardOffers(ctx, 'a', 'use')).toBe(true);
    expect(cardOffers(ctx, 'a', 'use')).toMatchObject([
      {
        kind: 'viewAs',
        label: 'zero slash',
        names: ['standard:slash'],
        materials: [],
        count: { min: 0, max: 0 },
      },
    ]);
    expect(
      validateUse(ctx, {
        ...slash,
        choice: { kind: 'viewAs', instance, recipe: 'slash', materials: ['invented'] },
      }).ok,
    ).toBe(false);
  });
  expect(
    await use(game, {
      ...slash,
      choice: { kind: 'viewAs', instance, recipe: 'slash', materials: [] },
    }),
  ).toMatchObject({
    value: { use: { card: { name: 'standard:slash', suit: 'none', rank: 0, materials: [] } } },
  });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.snapshot.cards).toHaveLength(0);
});

it('自定义转换可同步拒绝或直接返回用牌 Promise，原方法与完整结算仍保留', async () => {
  let ready = false;
  class Recipe {
    id = 'conditional-slash';
    label = 'conditional slash';
    make = { name: 'standard:slash' };
    #reason = 'probe:conditional-use';

    use(ctx: Context, { self, intent }: ViewAsUseInput): UseResult | Promise<UseResult> {
      if (!ready) return { kind: 'unavailable', reason: this.#reason };
      return useCard(ctx, {
        ...intent,
        actor: self.owner,
        choice: { kind: 'generated', face: this.make, materials: [], reason: this.#reason },
      });
    }
  }
  const raw = new Recipe();
  const recipe = viewAs(raw);
  const skill = { id: 'probe:conditional', name: 'conditional', viewAs: [recipe] };
  const game = cardGame({ hands: { a: [] }, skills: [skill] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: skill.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]!.id;
  const intent = {
    ...slash,
    choice: { kind: 'viewAs', instance, recipe: recipe.id, materials: [] } as const,
  };
  const before = game.room.history.facts();
  expect(await use(game, intent)).toMatchObject({
    kind: 'resolved',
    value: { kind: 'unavailable', reason: 'probe:conditional-use' },
  });
  expect(game.room.history.facts()).toEqual(before);
  expect(game.room.world.player('b').hp).toBe(4);

  ready = true;
  expect(await use(game, intent)).toMatchObject({
    kind: 'resolved',
    value: {
      kind: 'used',
      use: { actor: 'a', card: { source: { kind: 'generated', reason: 'probe:conditional-use' } } },
    },
  });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  expect(game.room.world.snapshot.cards).toHaveLength(0);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('多材料与动态牌名按实际参数构造，同一配方无需固定牌名或一张材料', async () => {
  class Recipe {
    id = 'choose-name';
    label = 'flexible';
    #names = ['standard:slash', 'standard:duel'];
    #max = 2;

    available() {
      return this.#max > 0;
    }

    names() {
      return this.#names;
    }

    materials(ctx: Context, { self }: ViewAsInput) {
      expect(this.#max).toBe(2);
      return ownedCards(ctx.world, self.owner);
    }

    count(ctx: Context, { self }: ViewAsInput) {
      return { min: ctx.world.player(self.owner).hp === 4 ? this.#max : 1, max: this.#max };
    }

    make(_ctx: Context, { parameters }: ViewAsMakeInput) {
      return typeof parameters === 'string' && this.#names.includes(parameters)
        ? { name: parameters }
        : null;
    }
  }
  const recipe = new Recipe();
  const flexible = defineSkill({
    id: 'test:flexible',
    name: 'flexible',
    triggers: [],
    viewAs: [viewAs(recipe)],
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

it('同一配方按使用与打出切换牌名、材料和数量，最终校验沿用实际用途', async () => {
  const adaptive = defineSkill({
    id: 'test:adaptive',
    name: '变式',
    viewAs: [
      viewAs({
        id: 'duel-slash',
        label: '变式',
        names: (ctx, { purpose }) => [
          cardDef(ctx, purpose === 'use' ? 'standard:duel' : 'standard:slash').id,
        ],
        materials: (ctx, { self, purpose }) =>
          ownedCards(ctx.world, self.owner).filter(
            (id) => face(ctx, id).color === (purpose === 'use' ? 'red' : 'black'),
          ),
        count: (_ctx, { purpose }) => ({ min: purpose === 'use' ? 1 : 2, max: 2 }),
        make: (_ctx, { purpose }) => ({
          name: purpose === 'use' ? 'standard:duel' : 'standard:slash',
        }),
      }),
    ],
  });
  const game = cardGame({
    skills: [adaptive],
    hands: {
      a: [card('red', 'jink', 'heart'), card('black1', 'jink'), card('black2', 'jink')],
      b: [card('duel', 'duel')],
    },
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: adaptive.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]!.id;
  const choice = { kind: 'viewAs', instance, recipe: 'duel-slash' } as const;
  await game.room.run('preview', (ctx) => {
    const offers = (purpose: 'use' | 'response') =>
      cardOffers(ctx, 'a', purpose).filter((offer) => offer.skill === adaptive.id);
    expect(offers('use')).toMatchObject([
      { names: ['standard:duel'], materials: ['red'], count: { min: 1, max: 2 } },
    ]);
    expect(offers('response')).toMatchObject([
      { names: ['standard:slash'], materials: ['black1', 'black2'], count: { min: 2, max: 2 } },
    ]);
    expect(buildCard(ctx, 'a', { ...choice, materials: ['black1'] }, 'response').ok).toBe(false);
    expect(buildCard(ctx, 'a', { ...choice, materials: ['red'] }, 'response').ok).toBe(false);
    expect(buildCard(ctx, 'a', { ...choice, materials: ['black1', 'black2'] }, 'use').ok).toBe(
      false,
    );
  });
  expect(
    await use(game, { ...slash, targets: ['c'], choice: { ...choice, materials: ['red'] } }),
  ).toMatchObject({ value: { kind: 'used', use: { card: { name: 'standard:duel' } } } });
  expect(game.room.world.player('c').hp).toBe(3);

  const running = use(game, {
    ...slash,
    actor: 'b',
    targets: ['a'],
    choice: { kind: 'physical', card: 'duel' },
  });
  const request = await nextRequest(game.room);
  expect(request).toMatchObject({ player: 'a', kind: 'card-response' });
  expect(
    game.room.decisions.submit(request.id, request.token, {
      ...choice,
      materials: ['black1', 'black2'],
    }),
  ).toEqual({ kind: 'accepted' });
  await running;
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.zone('discard').cards).toEqual(['red', 'black1', 'black2', 'duel']);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
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
  expect(game.room.history.facts(CardEvent.used)).toEqual([]);
  expect(game.room.world.zone('a:hand').cards).toContain('peach');
});

it('统一禁止规则也约束转换牌，失效后不能使用旧配方候选', async () => {
  const game = cardGame({
    skills: [wusheng],
    rules: [
      modify(
        cardQueries.prohibitUse,
        (_ctx, { input: { card } }) => card.name === 'standard:slash',
      ),
    ],
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
  game.room.on(Use.declared, {
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
    triggers: [],
    viewAs: [
      viewAs({
        id: 'jink',
        label: 'zero jink',
        names: () => ['standard:jink'],
        available: (_ctx, { purpose }) => purpose === 'use',
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
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
});

it('处理区材料可被子用牌借走，子结算结束后父善后不会重复处理', async () => {
  const game = cardGame();
  game.room.on(Damage.received, {
    id: 'reuse-material',
    owner: 'b',
    eligible: (_ctx, hit) => hit.input.to === 'b',
    run: async (ctx, hit) => {
      const material = hit.input.card?.card.materials[0];
      if (!material) throw new Error('Missing material.');
      await useCard(ctx, {
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
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
});

it('具名查询和计划修改均受纯查询守卫约束', async () => {
  const game = cardGame();
  game.room.on(Use.declared, {
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
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
});

it('目标在轮到前死亡则跳过，不再启动其效果', async () => {
  const game = cardGame({ rules: [modify(cardQueries.attackRange, () => 3)] });
  const started: string[] = [];
  game.room.on(Use.declared, {
    id: 'extra',
    owner: 'a',
    eligible: () => true,
    run: (ctx, plan) => {
      plan.addTarget(ctx, 'c', 'extra');
    },
  });
  game.room.on(Resolve.finished, {
    id: 'kill-next',
    owner: 'a',
    eligible: (_ctx, event) => event.effect.target === 'b',
    run: (ctx) => {
      ctx.commit(
        testTiming('c.died'),
        [{ kind: 'vitality', player: 'c', hp: 0, alive: false }],
        {},
      );
    },
  });
  game.room.on(Resolve.starting, {
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
