import { expect, it } from 'vitest';
import {
  pay,
  used,
  costPaid,
  cardsMoved,
  moveCards,
  withLifetime,
  JointSelection,
  defineSkill,
  SkillBook,
  skillEffective,
} from '../../src/sdk';
import type { UsageLimit, PaymentIntent } from '../../src/sdk';
import { nextRequest, room, worldSeed } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';

it('意图在费用提交后、所有支付后效之前同步确定；失效意图不支付', async () => {
  const game = room();
  const seen: string[] = [];
  let declared = false;
  game.on(cardsMoved, {
    id: 'moved',
    owner: 'b',
    eligible: () => true,
    run() {
      expect(declared).toBe(true);
      seen.push('moved');
    },
  });
  game.on(costPaid, {
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
      ctx.unwrap(
        await pay(ctx, { actor: 'a', cards: ['a1'], to: 'discard', reason: 'intent', intent }),
      ).kind,
    ).toBe('paid');
    expect(
      ctx.unwrap(
        await pay(ctx, { actor: 'a', cards: ['a2'], to: 'discard', reason: 'intent', intent }),
      ).kind,
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
      committed: () => Promise.reject(new Error('async intent')),
    };
    game.on(cardsMoved, {
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
      phase.listen(cardsMoved, {
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
      });
      const result = await pay(phase, {
        actor: 'a',
        cards: ['a1'],
        to: 'discard',
        reason: 'activate',
        limit,
        declaration: { target: 'b' },
      });
      expect(result).toMatchObject({ kind: 'resolved', value: { kind: 'paid' } });
      expect(used(phase.world, 'a', limit)).toBe(1);
      const again = await pay(phase, {
        actor: 'a',
        cards: ['a2'],
        to: 'discard',
        reason: 'activate',
        limit,
      });
      expect(again).toMatchObject({
        value: { kind: 'unavailable', reason: 'Usage limit reached.' },
      });
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

it('取消选择不支付、不增加次数', async () => {
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
      const choice = await phase.ask(model.decision('a', '支付一张牌', true));
      if (choice.kind === 'chosen')
        await pay(phase, {
          actor: 'a',
          cards: choice.value.cards,
          to: 'discard',
          reason: 'activate',
          limit,
        });
      expect(used(phase.world, 'a', limit)).toBe(0);
    }),
  );
  const request = await nextRequest(game);
  game.decisions.cancel(request.id, request.token);
  await running;
  expect(game.history.facts('cost.paid')).toEqual([]);
  expect(game.world.zone('a:hand').cards).toEqual(['a1', 'a2']);
});

it.each([{ cards: ['a1', 'b1'] }, { cards: ['a1', 'a1'] }, { cards: ['unknown'] }])(
  '非法材料 $cards 不产生部分支付或次数',
  async ({ cards }) => {
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
        expect(result).toMatchObject({ value: { kind: 'unavailable' } });
        expect(used(phase.world, 'a', limit)).toBe(0);
      }),
    );
    expect(game.world.zone('discard').cards).toEqual([]);
    expect(game.world.zone('a:hand').cards).toEqual(['a1', 'a2']);
    expect(game.history.facts('cost.paid')).toEqual([]);
    expect(game.status).toBe('ready');
  },
);

it('选择接纳后目标条件改变，支付入口仍重新检查', async () => {
  const game = room();
  await game.run('turn', (ctx) =>
    withLifetime(ctx, 'phase', async (phase, lifetime) => {
      const limit: UsageLimit = { key: 'activation', source: null, lifetime, max: 1 };
      phase.commit('target.died', [{ kind: 'vitality', player: 'b', hp: 0, alive: false }], {});
      const result = await pay(phase, {
        actor: 'a',
        cards: ['a1'],
        to: 'discard',
        reason: 'activate',
        limit,
        legal: (child) => child.world.player('b').alive,
      });
      expect(result).toMatchObject({
        value: { kind: 'unavailable', reason: 'Final cost conditions changed.' },
      });
      expect(used(phase.world, 'a', limit)).toBe(0);
    }),
  );
  expect(game.world.zone('discard').cards).toEqual([]);
});

it('支付后效令发动者死亡，已付材料与次数不会回滚', async () => {
  const game = room();
  game.on(cardsMoved, {
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
      expect(result).toMatchObject({ value: { kind: 'paid' } });
      expect(phase.world.player('a').alive).toBe(false);
      expect(used(phase.world, 'a', limit)).toBe(1);
    }),
  );
  expect(game.world.zone('discard').cards).toEqual(['a1']);
  expect(game.history.facts('cost.paid')).toHaveLength(1);
});

it('零材料宣告也有一次支付事实与次数，不虚构实体移动', async () => {
  const game = room();
  const paid: unknown[] = [];
  game.on(costPaid, {
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
      await pay(phase, { actor: 'a', cards: [], to: 'discard', reason: 'zero', limit });
      expect(used(phase.world, 'a', limit)).toBe(1);
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
});

it('失去再获得技能不能绕过以技能定义为来源的本阶段次数', async () => {
  const game = room();
  const book = new SkillBook([defineSkill({ id: 'test:limited', name: 'limited', effects: [] })]);
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
      ).toMatchObject({ value: { kind: 'unavailable' } });
    }),
  );
  expect(game.world.zone('a:hand').cards).toEqual(['a2']);
  expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
});

it('技能已失效或材料被取走时最终支付返回 unavailable', async () => {
  const game = room();
  const book = new SkillBook([defineSkill({ id: 'test:limited', name: 'limited', effects: [] })]);
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
      await pay(ctx, { actor: 'a', cards: ['a1'], to: 'discard', reason: 'activate', skill }),
    ).toMatchObject({ value: { kind: 'unavailable' } });
    await moveCards(
      ctx,
      [{ cards: ['a1'], from: 'a:hand', to: 'b:hand', place: 'bottom' }],
      'taken',
    );
    expect(
      await pay(ctx, { actor: 'a', cards: ['a1'], to: 'discard', reason: 'activate' }),
    ).toMatchObject({ value: { kind: 'unavailable' } });
  });
  expect(game.history.facts('cost.paid')).toEqual([]);
  expect(game.status).toBe('ready');
});
