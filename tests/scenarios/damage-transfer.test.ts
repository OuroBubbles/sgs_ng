import { expect, it } from 'vitest';
import {
  damage,
  changeShield,
  shieldOf,
  setChained,
  isChained,
  isChainDamage,
  isDirectDamage,
  pay,
  finishGame,
  Cards,
  Damage,
  Cost,
} from '../../src/sdk';
import type { DamageDraft, DamageResult, DamageTransferIntent, Context } from '../../src/sdk';
import { cardGame, card } from '../fixtures/cards';
import { rebuildWorld } from '../../src/core/history/rebuild';

type Game = ReturnType<typeof cardGame>;
const hit = { from: 'a', to: 'b', amount: 2, nature: 'normal' } as const;
const facts = (game: Game, kind = 'damage.dealt') =>
  game.room.history.facts(kind).map((fact) => fact.data.detail as DamageResult);
function rebuilt(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.decisions.pending).toEqual([]);
}
function redirect(game: Game, to = 'c') {
  game.room.on(Damage.inflicting, {
    id: 'redirect',
    owner: 'b',
    eligible: (ctx, draft) => draft.input.to === 'b' && draft.canTransfer(ctx, to),
    async run(ctx, draft) {
      await draft.transfer(ctx, to, 'redirect');
    },
  });
}
async function link(game: Game, players: readonly string[]) {
  await game.room.run('link', async (ctx) => {
    for (const player of players) await setChained(ctx, player, true, 'setup');
  });
}

it('转移保留来源快照和当前量，只重开新接收方防御，原接收方后续候选停止', async () => {
  const game = cardGame();
  const steps: string[] = [];
  await game.room.run('shield', async (ctx) => {
    await changeShield(ctx, { player: 'b', amount: 3, reason: 'setup' });
    await changeShield(ctx, { player: 'c', amount: 1, reason: 'setup' });
  });
  game.room.on(Damage.causing, {
    id: 'source-plus',
    owner: 'a',
    eligible: () => true,
    run(_ctx, draft) {
      steps.push('source');
      draft.adjust(1, 'source');
    },
  });
  game.room.on(Damage.replacing, {
    id: 'replace',
    owner: 'a',
    eligible: () => true,
    run() {
      steps.push('replace');
    },
  });
  game.room.on(Damage.inflicting, {
    id: 'redirect',
    owner: 'b',
    eligible: (_ctx, draft) => draft.input.to === 'b',
    async run(ctx, draft) {
      steps.push('b');
      draft.setAmount(2, 'cap');
      const result = await draft.transfer(ctx, 'c', 'redirect');
      expect(result).toMatchObject({ kind: 'transferred', damage: { amount: 3, hpLoss: 2 } });
      expect(draft.pending).toBe(false);
      steps.push('after');
    },
  });
  game.room.on(Damage.inflicting, {
    id: 'stale-original',
    owner: 'd',
    eligible: (_ctx, draft) => draft.input.to === 'b',
    run() {
      throw new Error('Original target window must stop.');
    },
  });
  game.room.on(Damage.inflicting, {
    id: 'target-plus',
    owner: 'c',
    eligible: (_ctx, draft) => draft.input.to === 'c',
    run(_ctx, draft) {
      steps.push('c');
      draft.adjust(1, 'defense');
    },
  });
  game.room.on(Damage.received, {
    id: 'received',
    owner: null,
    eligible: () => true,
    run(_ctx, result) {
      steps.push(`received:${result.input.to}`);
    },
  });
  let parent!: DamageResult;
  await game.room.run('hit', async (ctx) => {
    parent = await damage(ctx, hit);
  });
  expect(steps).toEqual(['source', 'replace', 'b', 'c', 'received:c', 'after']);
  expect(parent).toMatchObject({ kind: 'transferred', hpLoss: 0, shieldLost: 0, afterHp: 4 });
  const child = facts(game)[0]!;
  expect(child).toMatchObject({
    input: { to: 'c', amount: 2, origin: { kind: 'transfer', damage: parent.id } },
    sourceSnapshot: { to: 'b', amount: 3 },
    amount: 3,
    shieldLost: 1,
    hpLoss: 2,
  });
  expect(parent.transfer).toEqual({ to: 'c', reason: 'redirect', damage: child.id });
  expect(shieldOf(game.room.world, 'b')).toBe(3);
  expect(game.room.world.player('c').hp).toBe(2);
  expect(facts(game, 'damage.transferred')).toEqual([parent]);
  rebuilt(game);
});

it('普通代码可有限次转回旧角色，不由内核禁止 B→C→B', async () => {
  const game = cardGame();
  let count = 0;
  let sourceCalls = 0;
  game.room.on(Damage.causing, {
    id: 'source',
    owner: 'a',
    eligible: () => true,
    run() {
      sourceCalls++;
    },
  });
  game.room.on(Damage.inflicting, {
    id: 'bounce',
    owner: null,
    eligible: () => count < 2,
    async run(ctx, draft) {
      count++;
      await draft.transfer(ctx, draft.input.to === 'b' ? 'c' : 'b', 'bounce');
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(count).toBe(2);
  expect(sourceCalls).toBe(1);
  expect(facts(game)).toHaveLength(1);
  expect(facts(game)[0]!.input.to).toBe('b');
  expect(facts(game, 'damage.transferred')).toHaveLength(2);
  rebuilt(game);
});

it.each(['same', 'dead', 'missing'])('%s 接收方不宣告，原伤害照常结算', async (kind) => {
  const game = cardGame();
  if (kind === 'dead')
    await game.room.run('setup', (ctx) => {
      ctx.commit('death', [{ kind: 'vitality', player: 'c', hp: 0, alive: false }], {});
    });
  game.room.on(Damage.inflicting, {
    id: 'invalid',
    owner: 'b',
    eligible: () => true,
    async run(ctx, draft) {
      const to = kind === 'same' ? 'b' : kind === 'dead' ? 'c' : 'missing';
      expect(draft.canTransfer(ctx, to)).toBe(false);
      expect(await draft.transfer(ctx, to, 'invalid')).toEqual({
        kind: 'unavailable',
        damage: null,
      });
      expect(draft.pending).toBe(true);
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(facts(game)[0]!.input.to).toBe('b');
  expect(game.room.history.facts('damage.transferring')).toHaveLength(0);
  rebuilt(game);
});

it.each(['prevent', 'zero', 'die'])('新目标 %s 不恢复原目标伤害或消耗原护盾', async (kind) => {
  const game = cardGame();
  redirect(game);
  game.room.on(Damage.inflicting, {
    id: 'new-defense',
    owner: 'c',
    eligible: (_ctx, draft) => draft.input.to === 'c',
    run(ctx, draft) {
      if (kind === 'prevent') draft.prevent('defense');
      else if (kind === 'zero') draft.setAmount(0, 'defense');
      else ctx.commit('death', [{ kind: 'vitality', player: 'c', hp: 0, alive: false }], {});
    },
  });
  let result!: DamageResult;
  await game.room.run('hit', async (ctx) => {
    result = await damage(ctx, hit);
  });
  expect(result.kind).toBe('transferred');
  expect(game.room.world.player('b').hp).toBe(4);
  expect(facts(game)).toEqual([]);
  expect(
    facts(
      game,
      `damage.${kind === 'prevent' ? 'prevented' : kind === 'die' ? 'unavailable' : 'zero'}`,
    ),
  ).toHaveLength(1);
  rebuilt(game);
});

it('伤害替代窗口可转移，原目标不再开防御窗口；来源在防御中死亡不删除归属', async () => {
  const game = cardGame();
  game.room.on(Damage.replacing, {
    id: 'replacement',
    owner: 'a',
    eligible: () => true,
    async run(ctx, draft) {
      await draft.transfer(ctx, 'c', 'replacement');
    },
  });
  game.room.on(Damage.inflicting, {
    id: 'defense',
    owner: 'c',
    eligible: () => true,
    run(ctx, draft) {
      expect(draft.input.to).toBe('c');
      ctx.commit('source.dies', [{ kind: 'vitality', player: 'a', hp: 0, alive: false }], {});
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(facts(game)[0]!.input.from).toBe('a');
  expect(game.room.world.player('b').hp).toBe(4);
  rebuilt(game);
});

it.each(['receiver', 'owner'])('支付时先宣告，弃牌后效令 %s 死亡不恢复原伤害', async (kind) => {
  const game = cardGame({ hands: { b: [card('fee', 'slash')] } });
  let plan!: DamageTransferIntent;
  let draft!: DamageDraft;
  game.room.on(Cards.moved, {
    id: 'cost-aftermath',
    owner: 'd',
    eligible: (_ctx, event) => event.moves.some((move) => move.cards.includes('fee')),
    run(ctx) {
      expect(draft.pending).toBe(false);
      expect(ctx.history.facts('damage.transferring')).toHaveLength(1);
      expect(ctx.world.position('fee')).toBe('discard');
      ctx.commit(
        'cost.death',
        [{ kind: 'vitality', player: kind === 'receiver' ? 'c' : 'b', hp: 0, alive: false }],
        {},
      );
    },
  });
  game.room.on(Damage.inflicting, {
    id: 'pay-transfer',
    owner: 'b',
    eligible: (_ctx, event) => event.input.to === 'b',
    async run(ctx, event) {
      draft = event;
      plan = event.prepareTransfer(ctx, 'c', 'relay');
      const paid = await pay(ctx, {
        actor: 'b',
        cards: ['fee'],
        to: 'discard',
        reason: 'relay',
        intent: plan,
        declaration: plan.data,
      });
      expect(paid.kind).toBe('paid');
      const next = await plan.resolve(ctx);
      expect(next).toMatchObject({
        kind: 'transferred',
        damage: { kind: kind === 'receiver' ? 'unavailable' : 'dealt' },
      });
      expect(await plan.resolve(ctx)).toEqual({ kind: 'unavailable', damage: null });
      expect((await event.transfer(ctx, 'd', 'again')).kind).toBe('unavailable');
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(game.room.world.position('fee')).toBe('discard');
  expect(game.room.world.player('c').hp).toBe(kind === 'receiver' ? 0 : 2);
  expect(facts(game, 'damage.transferred')[0]!.hpLoss).toBe(0);
  expect(JSON.stringify(game.room.history.facts('cost.paid'))).toContain('"target":"c"');
  rebuilt(game);
});

it('费用同批状态令接收方死亡，仍完成已承诺转移；没有支付后存活重查恢复伤害', async () => {
  const game = cardGame({ hands: { b: [card('fee', 'slash')] } });
  game.room.on(Damage.inflicting, {
    id: 'cost-kills',
    owner: 'b',
    eligible: (_ctx, draft) => draft.input.to === 'b',
    async run(ctx, draft) {
      const intent = draft.prepareTransfer(ctx, 'c', 'relay');
      const paid = await pay(ctx, {
        actor: 'b',
        cards: ['fee'],
        to: 'discard',
        reason: 'relay',
        intent,
        changes: [{ kind: 'vitality', player: 'c', hp: 0, alive: false }],
      });
      expect(paid.kind).toBe('paid');
      expect(await intent.resolve(ctx)).toMatchObject({
        kind: 'transferred',
        damage: { kind: 'unavailable' },
      });
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(game.room.world.player('b').hp).toBe(4);
  expect(facts(game)).toEqual([]);
  rebuilt(game);
});

it.each(['invalid-fee', 'recipient-dies', 'prevented'])(
  '未支付 %s 不确定转移意图',
  async (kind) => {
    const game = cardGame({ hands: { b: [card('fee', 'slash')] } });
    game.room.on(Damage.inflicting, {
      id: 'failed-payment',
      owner: 'b',
      eligible: () => true,
      async run(ctx, draft) {
        const intent = draft.prepareTransfer(ctx, 'c', 'relay');
        if (kind === 'recipient-dies')
          ctx.commit('death', [{ kind: 'vitality', player: 'c', hp: 0, alive: false }], {});
        if (kind === 'prevented') draft.prevent('other');
        const paid = await pay(ctx, {
          actor: 'b',
          cards: kind === 'invalid-fee' ? ['missing'] : ['fee'],
          to: 'discard',
          reason: 'relay',
          intent,
        });
        expect(paid.kind).toBe('unavailable');
        expect(await intent.resolve(ctx)).toEqual({
          kind: 'unavailable',
          damage: null,
        });
      },
    });
    await game.room.run('hit', (ctx) => damage(ctx, hit));
    expect(game.room.world.position('fee')).toBe('b:hand');
    expect(game.room.world.player('b').hp).toBe(kind === 'prevented' ? 4 : 2);
    expect(game.room.history.facts('damage.transferring')).toEqual([]);
    rebuilt(game);
  },
);

it('意图在提交时取当前量；费用窗口仅见冻结数据，不把闭包存入世界或事实', async () => {
  const game = cardGame({ hands: { b: [card('fee', 'slash')] } });
  game.room.on(Cost.paid, {
    id: 'paid',
    owner: 'b',
    eligible: () => true,
    run(_ctx, receipt) {
      expect(receipt.declaration).toMatchObject({ target: 'c' });
    },
  });
  game.room.on(Damage.inflicting, {
    id: 'prepare',
    owner: 'b',
    eligible: (_ctx, draft) => draft.input.to === 'b',
    async run(ctx, draft) {
      const intent = draft.prepareTransfer(ctx, 'c', 'relay');
      draft.adjust(-1, 'defense');
      expect(
        (
          await pay(ctx, {
            actor: 'b',
            cards: ['fee'],
            to: 'discard',
            reason: 'relay',
            intent,
            declaration: intent.data,
          })
        ).kind,
      ).toBe('paid');
      await intent.resolve(ctx);
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(facts(game)[0]).toMatchObject({ amount: 1, sourceSnapshot: { amount: 2 } });
  expect(game.room.history.facts('damage.transferring')[0]!.data.detail).toMatchObject({
    amount: 1,
  });
  rebuilt(game);
});

it.each(['source', 'query', 'foreign', 'stale'])(
  '%s 不能越过转移草案的阶段/纯查询/上下文权限',
  async (kind) => {
    const game = cardGame();
    let saved!: DamageDraft;
    let context!: Context;
    const type = kind === 'source' ? Damage.causing : Damage.inflicting;
    game.room.on(type, {
      id: 'guard',
      owner: 'b',
      eligible: () => true,
      async run(ctx, draft) {
        saved = draft;
        context = ctx;
        if (kind === 'source')
          expect(() => draft.prepareTransfer(ctx, 'c', 'bad')).toThrow('source stage');
        if (kind === 'query')
          expect(() => ctx.query(() => draft.prepareTransfer(ctx, 'c', 'bad'))).toThrow();
        if (kind === 'foreign') {
          const other = cardGame();
          await other.room.run('foreign', (at) => {
            expect(draft.canTransfer(at, 'c')).toBe(false);
            expect(() => draft.prepareTransfer(at, 'c', 'bad')).toThrow('descendant');
          });
        }
      },
    });
    await game.room.run('hit', (ctx) => damage(ctx, hit));
    if (kind === 'stale') {
      expect(() => saved.prepareTransfer(context, 'c', 'late')).toThrow();
      await game.room.run('later', (ctx) => {
        expect(saved.canTransfer(ctx, 'c')).toBe(false);
        expect(() => saved.prepareTransfer(ctx, 'c', 'late')).toThrow('descendant');
      });
    }
    expect(facts(game)[0]!.input.to).toBe('b');
    rebuilt(game);
  },
);

it('转移到未连环角色：原角色保留连环，其余角色不传播', async () => {
  const game = cardGame();
  await link(game, ['b', 'd']);
  redirect(game);
  await game.room.run('hit', (ctx) => damage(ctx, { ...hit, nature: 'fire' }));
  expect(facts(game).map((result) => result.input.to)).toEqual(['c']);
  expect(isChained(game.room.world, 'b')).toBe(true);
  expect(isChained(game.room.world, 'd')).toBe(true);
  rebuilt(game);
});

it('直接伤害转移到连环角色，在实际接收方冻结新计划；原目标可在计划中再次受伤', async () => {
  const game = cardGame();
  await link(game, ['b', 'c', 'd']);
  game.room.on(Damage.inflicting, {
    id: 'direct-only',
    owner: 'b',
    eligible: (_ctx, draft) => draft.input.to === 'b' && isDirectDamage(draft.input),
    async run(ctx, draft) {
      await draft.transfer(ctx, 'c', 'relay');
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, { ...hit, nature: 'fire' }));
  const results = facts(game);
  expect(results.map((result) => result.input.to)).toEqual(['c', 'd', 'b']);
  expect(results[0]!.chainPlan).toEqual(['d', 'b']);
  expect(results.slice(1).every((result) => isChainDamage(result.input))).toBe(true);
  expect(isChainDamage(results[0]!.input)).toBe(false);
  rebuilt(game);
});

it('传播包被转移仍属于原连环，不重新扩张；已解链的新目标不再重复传播', async () => {
  const game = cardGame();
  await link(game, ['b', 'c', 'd']);
  game.room.on(Damage.inflicting, {
    id: 'chain-transfer',
    owner: 'c',
    eligible: (_ctx, draft) => draft.input.to === 'c',
    async run(ctx, draft) {
      await draft.transfer(ctx, 'd', 'relay');
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, { ...hit, nature: 'fire' }));
  const results = facts(game);
  expect(results.map((result) => result.input.to)).toEqual(['b', 'd']);
  expect(results[1]).toMatchObject({
    chainPlan: [],
    input: { origin: { kind: 'transfer', chain: results[0]!.id } },
  });
  expect(isChainDamage(results[1]!.input)).toBe(true);
  expect(isChained(game.room.world, 'c')).toBe(true);
  rebuilt(game);
});

it('忽略护盾随本次伤害转移，来源归属保持，后续连环各自仍使用护盾', async () => {
  const game = cardGame();
  await link(game, ['c', 'd']);
  await game.room.run('shield', async (ctx) => {
    for (const player of ['c', 'd'])
      await changeShield(ctx, { player, amount: 3, reason: 'setup' });
  });
  redirect(game);
  await game.room.run('hit', (ctx) => damage(ctx, { ...hit, nature: 'fire', bypassShield: true }));
  expect(facts(game)).toMatchObject([
    { input: { to: 'c' }, hpLoss: 2, shieldLost: 0, shieldBypass: 'request' },
    { input: { to: 'd' }, hpLoss: 0, shieldLost: 2, shieldBypass: null },
  ]);
  rebuilt(game);
});

it('新目标后效结束整局，原结果仍为已转移并停止原防御候选', async () => {
  const game = cardGame();
  redirect(game);
  game.room.on(Damage.settled, {
    id: 'finish',
    owner: 'c',
    eligible: (_ctx, result) => result.input.to === 'c',
    async run(ctx) {
      await finishGame(ctx, { winners: ['c'], reason: 'test' });
    },
  });
  let result!: DamageResult;
  await game.room.run('hit', async (ctx) => {
    result = await damage(ctx, hit);
  });
  expect(result.kind).toBe('transferred');
  expect(game.room.world.player('b').hp).toBe(4);
  expect(facts(game)).toHaveLength(1);
  rebuilt(game);
});
