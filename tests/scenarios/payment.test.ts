import { expect, it } from 'vitest';
import {
  pay,
  used,
  moveCards,
  withLifetime,
  JointSelection,
  defineSkill,
  SkillBook,
  skillEffective,
  Cards,
  Cost,
} from '../../src/sdk';
import type { UsageLimit, PaymentIntent, MoveResult } from '../../src/sdk';
import { lianying } from '../../src/content/standard/generals/luxun';
import { nextRequest, room, worldSeed } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';

it('技能支付只声明来源即可确定付款人，费用原因仍由调用者显式指定', async () => {
  const game = room();
  const skills = new SkillBook([{ id: 'test:source', name: '来源' }]);
  skills.attach(game);
  await game.run('pay', async (ctx) => {
    await skills.grant(ctx, {
      owner: 'a',
      skill: 'test:source',
      source: { kind: 'general', id: 'a' },
    });
    const self = skills.bindings(ctx.world)[0]!.self;
    const other = { ...self, owner: 'b', skill: 'test:other', id: 'other' };
    let sourceReads = 0;
    let reasonReads = 0;
    const paid = await pay(ctx, {
      get skill() {
        return ++sourceReads === 1 ? self : other;
      },
      get reason() {
        return ++reasonReads === 1 ? 'explicit-purpose' : 'changed-purpose';
      },
      cards: ['a1'],
      to: 'discard',
    });
    expect(paid).toMatchObject({
      kind: 'paid',
      receipt: {
        actor: 'a',
        skill: self.skill,
        instance: self.id,
        reason: 'explicit-purpose',
        cards: ['a1'],
      },
    });
    expect(sourceReads).toBe(1);
    expect(reasonReads).toBe(1);
  });
  expect(game.world.position('a1')).toBe('discard');
  expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
  const invalid = room('ambiguous');
  const self = skills.bindings(game.world)[0]!.self;
  await expect(
    invalid.run('pay', (ctx) => {
      // @ts-expect-error 技能拥有者与另行指定的付款人不能形成两个来源。
      return pay(ctx, { actor: 'b', skill: self, reason: 'ambiguous' });
    }),
  ).rejects.toThrow('Payment requires exactly one actor or skill source.');
  expect(invalid.history.facts('cost.paid')).toEqual([]);
  expect(rebuildWorld(worldSeed(), invalid.history.facts())).toEqual(invalid.world.snapshot);
});

it('支付移牌包含接收区的提交前后快照，同步宣告的另一次变更不改写该批次', async () => {
  const game = room();
  const batches: MoveResult[] = [];
  game.on(Cards.moved, {
    id: 'observe-gift',
    owner: 'b',
    eligible: () => true,
    run: (ctx, batch) => {
      batches.push(batch);
      expect(ctx.world.zone('b:hand').cards).toEqual(['a1']);
    },
  });
  await game.run('gift', (ctx) =>
    pay(ctx, {
      actor: 'a',
      cards: ['a1'],
      to: 'b:hand',
      reason: 'gift',
      intent: {
        available: () => true,
        committed(at) {
          at.commit(
            'separate.intent-move',
            [{ kind: 'move', cards: ['b1'], from: 'b:hand', to: 'draw', place: 'bottom' }],
            null,
          );
        },
      },
    }),
  );
  expect(batches).toHaveLength(1);
  expect(batches[0]!.before.find((zone) => zone.id === 'b:hand')?.cards).toEqual(['b1']);
  expect(batches[0]!.after.find((zone) => zone.id === 'b:hand')?.cards).toEqual(['b1', 'a1']);
  expect(game.history.facts('cost.paid')[0]!.seq).toBeLessThan(
    game.history.facts('separate.intent-move')[0]!.seq,
  );
  expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
});

it.each([{ cards: ['a1'], to: 'discard' }, {}] as const)(
  '支付配置 %j 的补充移牌同批触发真实连营，费用仍只计声明材料',
  async (materials) => {
    const cards = 'cards' in materials ? materials.cards : [];
    const game = room();
    const skills = new SkillBook([lianying]);
    skills.attach(game);
    await game.run('grant', (ctx) =>
      skills.grant(ctx, { owner: 'b', skill: lianying.id, source: { kind: 'general', id: 'b' } }),
    );
    const running = game.run('pay-and-take', (ctx) =>
      pay(ctx, {
        actor: 'a',
        ...materials,
        reason: 'pay-and-take',
        changes: [{ kind: 'move', cards: ['b1'], from: 'b:hand', to: 'a:hand', place: 'bottom' }],
      }),
    );
    const request = await nextRequest(game);
    expect(request).toMatchObject({ player: 'b', kind: 'invoke' });
    expect(request.prompt).toContain('连营');
    expect(game.world.zone('b:hand').cards).toEqual([]);
    expect(game.world.position('b1')).toBe('a:hand');
    expect(game.decisions.submit(request.id, request.token, true)).toEqual({ kind: 'accepted' });
    const result = await running;
    expect(result).toMatchObject({ kind: 'resolved', value: { kind: 'paid', receipt: { cards } } });
    expect(game.world.zone('b:hand').cards).toEqual(['d1']);
    expect(game.world.zone('discard').cards).toEqual(cards);
    expect(game.history.facts('skill.invoked')).toHaveLength(1);
    expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
  },
);

it('意图在费用提交后、所有支付后效之前同步确定；失效意图不支付', async () => {
  const game = room();
  const seen: string[] = [];
  let declared = false;
  game.on(Cards.moved, {
    id: 'moved',
    owner: 'b',
    eligible: () => true,
    run() {
      expect(declared).toBe(true);
      seen.push('moved');
    },
  });
  game.on(Cost.paid, {
    id: 'paid',
    owner: 'b',
    eligible: () => true,
    run() {
      seen.push('paid');
    },
  });
  const intent = {
    available: () => !declared,
    committed(ctx: import('../../src/sdk').Context) {
      expect(ctx.world.position('a1')).toBe('discard');
      declared = true;
      seen.push('declared');
    },
  };
  await game.run('pay', async (ctx) => {
    expect(
      (await pay(ctx, { actor: 'a', cards: ['a1'], to: 'discard', reason: 'intent', intent })).kind,
    ).toBe('paid');
    expect(
      (await pay(ctx, { actor: 'a', cards: ['a2'], to: 'discard', reason: 'intent', intent })).kind,
    ).toBe('unavailable');
  });
  expect(seen).toEqual(['declared', 'moved', 'paid']);
  expect(game.world.zone('a:hand').cards).toEqual(['a2']);
  expect(game.history.facts('cost.paid')).toHaveLength(1);
});

it.each(['throw', 'async'])(
  '支付意图 %s 故障停止运行时，已提交费用保留，后效不开窗',
  async (kind) => {
    const game = room();
    let after = false;
    const malformed: unknown = {
      available: () => true,
      committed: async (ctx: import('../../src/sdk').Context) => {
        await Promise.resolve();
        ctx.commit('late.intent', [{ kind: 'vitality', player: 'b', hp: 1 }], {});
      },
    };
    game.on(Cards.moved, {
      id: 'after',
      owner: 'b',
      eligible: () => true,
      run() {
        after = true;
      },
    });
    await expect(
      game.run('pay', (ctx) =>
        pay(ctx, {
          actor: 'a',
          cards: ['a1'],
          to: 'discard',
          reason: 'intent',
          intent:
            kind === 'async'
              ? (malformed as PaymentIntent)
              : {
                  available: () => true,
                  committed: () => {
                    throw new Error('intent fault');
                  },
                },
        }),
      ),
    ).rejects.toThrow(kind === 'async' ? 'must be synchronous' : 'intent fault');
    expect(game.status).toBe('faulted');
    expect(game.world.position('a1')).toBe('discard');
    expect(game.world.player('b').hp).toBe(4);
    expect(game.history.facts('late.intent')).toEqual([]);
    expect(after).toBe(false);
    expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
  },
);

it('费用、次数与宣告整批生效后才开放后效，没有半支付状态', async () => {
  const game = room();
  const observed: unknown[] = [];
  await game.run('turn', (ctx) =>
    withLifetime(ctx, 'phase', async (phase, lifetime) => {
      const limit: UsageLimit = { key: 'activation', source: 'test:skill', lifetime, max: 1 };
      phase.defer(
        game.on(Cards.moved, {
          id: 'observe-payment',
          owner: 'b',
          eligible: (_child, event) => event.moves.some((move) => move.cards.includes('a1')),
          run: (child) => {
            observed.push({
              hand: child.world.zone('a:hand').cards,
              discard: child.world.zone('discard').cards,
              uses: used(child.world, 'a', limit),
              declaration: child.history.facts('cost.paid')[0]?.data.detail,
            });
          },
        }),
      );
      const result = await pay(phase, {
        actor: 'a',
        cards: ['a1'],
        to: 'discard',
        reason: 'activate',
        limit,
        declaration: { target: 'b' },
      });
      expect(result).toMatchObject({ kind: 'paid' });
      expect(used(phase.world, 'a', limit)).toBe(1);
      const again = await pay(phase, {
        actor: 'a',
        cards: ['a2'],
        to: 'discard',
        reason: 'activate',
        limit,
      });
      expect(again).toMatchObject({ kind: 'unavailable', reason: 'Usage limit reached.' });
    }),
  );
  expect(observed).toEqual([
    {
      hand: ['a2'],
      discard: ['a1'],
      uses: 1,
      declaration: {
        actor: 'a',
        cards: ['a1'],
        reason: 'activate',
        skill: null,
        instance: null,
        declaration: { target: 'b' },
      },
    },
  ]);
  expect(game.world.zone('discard').cards).toEqual(['a1']);
  expect(game.history.facts('cost.paid')).toHaveLength(1);
  expect(game.world.snapshot.states).toEqual([]);
});

it('取消选择不支付、不增加次数；选择接纳后目标条件改变，支付入口仍重新检查', async () => {
  const game = room();
  const running = game.run('turn', (ctx) =>
    withLifetime(ctx, 'phase', async (phase, lifetime) => {
      const limit: UsageLimit = { key: 'activation', source: 'test:skill', lifetime, max: 1 };
      const model = new JointSelection({
        cards: () => phase.world.zone('a:hand').cards.map((id) => ({ id, label: id })),
        targets: () => [],
        cardCount: { min: 1, max: 1 },
        targetCount: { min: 0, max: 0 },
      });
      for (const prompt of ['支付一张牌', '再次支付一张牌']) {
        const choice = await phase.ask(model.decision('a', prompt, { optional: true }));
        if (choice.kind === 'chosen') {
          phase.commit('target.died', [{ kind: 'vitality', player: 'b', hp: 0, alive: false }], {});
          const result = await pay(phase, {
            actor: 'a',
            cards: choice.value.cards,
            to: 'discard',
            reason: 'activate',
            limit,
            legal: (child) => child.world.player('b').alive,
          });
          expect(result).toMatchObject({
            kind: 'unavailable',
            reason: 'Final cost conditions changed.',
          });
        }
        expect(used(phase.world, 'a', limit)).toBe(0);
        expect(game.history.facts('cost.paid')).toEqual([]);
        expect(game.world.zone('a:hand').cards).toEqual(['a1', 'a2']);
      }
    }),
  );
  const request = await nextRequest(game);
  expect(game.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
  const retry = await nextRequest(game);
  expect(game.decisions.submit(retry.id, retry.token, { cards: ['a1'], targets: [] })).toEqual({
    kind: 'accepted',
  });
  await running;
  expect(game.world.zone('discard').cards).toEqual([]);
});

it.each([
  { cards: ['a1', 'b1'] },
  { cards: ['a1', 'a1'] },
  { cards: ['unknown'] },
  { cards: new Array<string>(1) },
])('非法材料 $cards 不产生部分支付或次数', async ({ cards }) => {
  const game = room();
  await game.run('turn', (ctx) =>
    withLifetime(ctx, 'phase', async (phase, lifetime) => {
      const limit: UsageLimit = { key: 'activation', source: null, lifetime, max: 1 };
      const result = await pay(phase, {
        actor: 'a',
        cards,
        to: 'discard',
        reason: 'activate',
        limit,
      });
      expect(result).toMatchObject({ kind: 'unavailable' });
      expect(used(phase.world, 'a', limit)).toBe(0);
    }),
  );
  expect(game.world.zone('discard').cards).toEqual([]);
  expect(game.world.zone('a:hand').cards).toEqual(['a1', 'a2']);
  expect(game.history.facts('cost.paid')).toEqual([]);
  expect(game.status).toBe('ready');
});

it('支付后效令发动者死亡，已付材料与次数不会回滚', async () => {
  const game = room();
  game.on(Cards.moved, {
    id: 'after-cost',
    owner: 'b',
    eligible: (_ctx, event) => event.moves.some((move) => move.to === 'discard'),
    run: (ctx) => {
      ctx.commit('actor.died', [{ kind: 'vitality', player: 'a', hp: 0, alive: false }], {});
    },
  });
  await game.run('turn', (ctx) =>
    withLifetime(ctx, 'phase', async (phase, lifetime) => {
      const limit: UsageLimit = { key: 'activation', source: null, lifetime, max: 1 };
      const result = await pay(phase, {
        actor: 'a',
        cards: ['a1'],
        to: 'discard',
        reason: 'activate',
        limit,
      });
      expect(result).toMatchObject({ kind: 'paid' });
      expect(phase.world.player('a').alive).toBe(false);
      expect(used(phase.world, 'a', limit)).toBe(1);
    }),
  );
  expect(game.world.zone('discard').cards).toEqual(['a1']);
  expect(game.history.facts('cost.paid')).toHaveLength(1);
});

it('零材料宣告无需目的区，仍有一次支付事实与次数，不虚构实体移动', async () => {
  const game = room();
  const paid: unknown[] = [];
  game.on(Cost.paid, {
    id: 'observe',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, receipt) => {
      paid.push(receipt);
    },
  });
  await game.run('turn', (ctx) =>
    withLifetime(ctx, 'phase', async (phase, lifetime) => {
      const limit: UsageLimit = { key: 'zero', source: null, lifetime, max: 1 };
      phase.commit('remove-unused-discard', [{ kind: 'removeZone', zone: 'discard' }], null);
      const result = await pay(phase, { actor: 'a', reason: 'zero', limit });
      expect(result).toMatchObject({ kind: 'paid', receipt: { actor: 'a', cards: [] } });
      expect(used(phase.world, 'a', limit)).toBe(1);
      expect(await pay(phase, { actor: 'a', reason: 'zero', limit })).toMatchObject({
        kind: 'unavailable',
        reason: 'Usage limit reached.',
      });
    }),
  );
  expect(paid).toHaveLength(1);
  expect(game.history.facts('cost.paid')).toHaveLength(1);
  expect(game.world.zone('a:hand').cards).toEqual(['a1', 'a2']);
  expect(
    game.history.entries.filter(
      (entry) => entry.type === 'flow.open' && entry.reason === 'cards.moved',
    ),
  ).toEqual([]);
  expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
});

it('失去再获得技能不能绕过以技能定义为来源的本阶段次数', async () => {
  const game = room();
  const book = new SkillBook([defineSkill({ id: 'test:limited', name: 'limited', triggers: [] })]);
  book.attach(game);
  const source = { kind: 'general', id: 'general:a' } as const;
  await game.run('turn', (ctx) =>
    withLifetime(ctx, 'phase', async (phase, lifetime) => {
      const limit: UsageLimit = { key: 'active', source: 'test:limited', lifetime, max: 1 };
      await book.grant(phase, { owner: 'a', skill: 'test:limited', source });
      const old = phase.world.snapshot.skills[0]?.id;
      await pay(phase, { actor: 'a', cards: ['a1'], to: 'discard', reason: 'activate', limit });
      await book.revoke(phase, 'a', 'test:limited', source);
      await book.grant(phase, { owner: 'a', skill: 'test:limited', source });
      expect(phase.world.snapshot.skills[0]?.id).not.toBe(old);
      expect(
        await pay(phase, { actor: 'a', cards: ['a2'], to: 'discard', reason: 'activate', limit }),
      ).toMatchObject({ kind: 'unavailable' });
    }),
  );
  expect(game.world.zone('a:hand').cards).toEqual(['a2']);
  expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
});

it('技能已失效或材料被取走时最终支付返回 unavailable', async () => {
  const game = room();
  const book = new SkillBook([defineSkill({ id: 'test:limited', name: 'limited', triggers: [] })]);
  book.attach(game);
  const source = { kind: 'general', id: 'general:a' } as const;
  await game.run('cost', async (ctx) => {
    await book.grant(ctx, { owner: 'a', skill: 'test:limited', source });
    const id = ctx.world.snapshot.skills[0]?.id ?? '';
    const skill = {
      id,
      owner: 'a',
      skill: 'test:limited',
      name: 'limited',
      origin: null,
      effective: () => skillEffective(ctx.world, id),
    };
    await book.revoke(ctx, 'a', 'test:limited', source);
    expect(
      await pay(ctx, { cards: ['a1'], to: 'discard', reason: 'activate', skill }),
    ).toMatchObject({ kind: 'unavailable' });
    await moveCards(
      ctx,
      [{ cards: ['a1'], from: 'a:hand', to: 'b:hand', place: 'bottom' }],
      'taken',
    );
    expect(
      await pay(ctx, { actor: 'a', cards: ['a1'], to: 'discard', reason: 'activate' }),
    ).toMatchObject({ kind: 'unavailable' });
  });
  expect(game.history.facts('cost.paid')).toEqual([]);
  expect(game.status).toBe('ready');
});
