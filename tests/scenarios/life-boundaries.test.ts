import { expect, it } from 'vitest';
import { finishGame, kill, pay, loseHp, recover, Death, Hp } from '../../src/sdk';
import type { Context, DeathDraft, RecoveryDraft } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use } from '../fixtures/cards';

const cause = { kind: 'rule', seq: null, data: null } as const;
const death = { player: 'b', killer: null, reason: 'rule', cause } as const;
const heal = { from: 'a', to: 'b', amount: 1 } as const;
function create() {
  return cardGame({ hands: { a: [], c: [card('fee', 'jink')] } });
}
type Game = ReturnType<typeof create>;
async function wound(game: Game, hp = 1) {
  await game.room.run('setup', (ctx) =>
    ctx.commit('test.wound', [{ kind: 'vitality', player: 'b', hp }], null),
  );
}
function conserved(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.decisions.pending).toEqual([]);
  expect(game.room.status).toBe('ready');
}
async function lateCost(ctx: Context) {
  ctx.commit('test.late-candidate', [], null);
  await pay(ctx, { actor: 'c', cards: ['fee'], to: 'discard', reason: 'probe:too-late' });
}

it.each(['dead', 'finished'] as const)(
  '回复准备中目标 %s 后收束窗口，后续候选不执行或支付，已发生的修改保留',
  async (boundary) => {
    const game = create();
    await wound(game);
    let held: RecoveryDraft | undefined;
    game.room.on(Hp.recovering, {
      id: 'a-invalidate',
      owner: null,
      eligible: () => true,
      async run(ctx, draft) {
        held = draft;
        draft.adjust(2, 'first');
        if (boundary === 'dead') await kill(ctx, death);
        else await finishGame(ctx, { winners: ['a'], reason: 'during recovery' });
      },
    });
    game.room.on(Hp.recovering, {
      id: 'b-later',
      owner: null,
      eligible: () => true,
      run: lateCost,
    });
    await game.room.run('heal', async (ctx) => {
      expect(await recover(ctx, heal)).toMatchObject({
        kind: 'unavailable',
        amount: 0,
        attemptedAmount: 3,
        edits: [{ before: 1, after: 3, reason: 'first' }],
      });
    });
    expect(game.room.history.facts('test.late-candidate')).toEqual([]);
    expect(game.room.history.facts('cost.paid')).toEqual([]);
    expect(game.room.history.facts('hp.recovered')).toEqual([]);
    expect(game.room.world.position('fee')).toBe('c:hand');
    expect(() => held?.adjust(1, 'stale')).toThrow();
    conserved(game);
  },
);

it.each(['prevented', 'rescued', 'dead', 'finished'] as const)(
  '死亡准备中已经 %s 时不再执行后续候选或支付，不重复提交死亡',
  async (boundary) => {
    const game = create();
    await wound(game, 0);
    let held: DeathDraft | undefined;
    game.room.on(Death.before, {
      id: 'a-resolve',
      owner: null,
      eligible: (_ctx, draft) => draft.input.reason === 'dying',
      async run(ctx, draft) {
        held = draft;
        if (boundary === 'prevented') draft.prevent('already handled');
        else if (boundary === 'rescued') await recover(ctx, heal);
        else if (boundary === 'dead') await kill(ctx, death);
        else await finishGame(ctx, { winners: ['a'], reason: 'during death' });
      },
    });
    game.room.on(Death.before, {
      id: 'b-later',
      owner: null,
      eligible: (_ctx, draft) => draft.input.reason === 'dying',
      run: lateCost,
    });
    await game.room.run('death', async (ctx) => {
      expect(await kill(ctx, { ...death, reason: 'dying' })).toMatchObject({
        kind: boundary === 'dead' || boundary === 'finished' ? 'unavailable' : boundary,
        event: null,
        reason: boundary === 'prevented' ? 'already handled' : null,
      });
    });
    expect(game.room.history.facts('test.late-candidate')).toEqual([]);
    expect(game.room.history.facts('cost.paid')).toEqual([]);
    expect(game.room.world.position('fee')).toBe('c:hand');
    expect(game.room.history.facts('player.died')).toHaveLength(boundary === 'dead' ? 1 : 0);
    expect(() => held?.prevent('late')).toThrow();
    conserved(game);
  },
);

it('濒死死亡请求在入口已经恢复正体力时直接返回 rescued，不收集候选或次数', async () => {
  const game = create();
  await wound(game, 2);
  let counts = 0;
  game.room.on(Death.before, {
    id: 'cost',
    owner: null,
    eligible: () => true,
    times: () => {
      counts++;
      return 1;
    },
    run: lateCost,
  });
  await game.room.run('death', async (ctx) => {
    expect(await kill(ctx, { ...death, reason: 'dying' })).toEqual({
      kind: 'rescued',
      event: null,
      reason: null,
    });
  });
  expect(counts).toBe(0);
  expect(game.room.history.facts('test.late-candidate')).toEqual([]);
  expect(game.room.world.player('b')).toMatchObject({ hp: 2, alive: true });
  conserved(game);
});

it('规则直接死亡不套用濒死正体力豁免，窗口中回复后仍可继续处理并死亡', async () => {
  const game = create();
  await wound(game, 1);
  game.room.on(Death.before, {
    id: 'a-heal',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await recover(ctx, heal);
    },
  });
  game.room.on(Death.before, { id: 'b-cost', owner: null, eligible: () => true, run: lateCost });
  await game.room.run('death', async (ctx) => {
    expect(await kill(ctx, death)).toMatchObject({
      kind: 'dead',
      event: { before: { hp: 2, alive: true } },
    });
  });
  expect(game.room.history.facts('cost.paid')).toHaveLength(1);
  expect(game.room.world.player('b')).toMatchObject({ hp: 2, alive: false });
  conserved(game);
});

it('回复数暂时为零不等于窗口失效，后续修正仍可增加并完成回复', async () => {
  const game = create();
  await wound(game, 1);
  game.room.on(Hp.recovering, {
    id: 'a-zero',
    owner: null,
    eligible: () => true,
    run: (_ctx, draft) => draft.setAmount(0, 'zero'),
  });
  game.room.on(Hp.recovering, {
    id: 'b-increase',
    owner: null,
    eligible: () => true,
    run: (_ctx, draft) => draft.adjust(2, 'later'),
  });
  await game.room.run('heal', async (ctx) => {
    expect(await recover(ctx, heal)).toMatchObject({
      kind: 'recovered',
      amount: 2,
      beforeHp: 1,
      afterHp: 3,
    });
  });
  conserved(game);
});

it('回复来源死亡不取消对仍存活目标的已声明回复，后续修正仍可运行', async () => {
  const game = create();
  await wound(game, 1);
  game.room.on(Hp.recovering, {
    id: 'a-source-dies',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await kill(ctx, { ...death, player: 'a' });
    },
  });
  game.room.on(Hp.recovering, {
    id: 'b-bonus',
    owner: null,
    eligible: () => true,
    run: (_ctx, draft) => draft.adjust(1, 'bonus'),
  });
  await game.room.run('heal', async (ctx) => {
    expect(await recover(ctx, heal)).toMatchObject({ kind: 'recovered', amount: 2 });
  });
  expect(game.room.world.player('a').alive).toBe(false);
  expect(game.room.world.player('b').hp).toBe(3);
  conserved(game);
});

it('回复已经提交后目标死亡不改写实际回复快照，完成窗口继续处理既有事实', async () => {
  const game = create();
  await wound(game, 1);
  game.room.on(Hp.recovered, {
    id: 'a-target-dies',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await kill(ctx, death);
    },
  });
  game.room.on(Hp.recovered, {
    id: 'b-fact',
    owner: null,
    eligible: () => true,
    run(ctx, result) {
      expect(ctx.world.player('b').alive).toBe(false);
      expect(result).toMatchObject({ kind: 'recovered', amount: 1, afterHp: 2 });
      ctx.commit('test.committed-recovery', [], result);
    },
  });
  await game.room.run('heal', async (ctx) => {
    expect(await recover(ctx, heal)).toMatchObject({ kind: 'recovered', amount: 1 });
  });
  expect(game.room.history.facts('test.committed-recovery')).toHaveLength(1);
  expect(game.room.history.facts('hp.recovered')).toHaveLength(1);
  conserved(game);
});

it('死亡已提交后终局仍完成既有死亡事实与埋葬善后，不能将待决守卫套用到完成事件', async () => {
  const game = cardGame({ hands: { a: [], b: [card('legacy', 'jink')] } });
  const seen: string[] = [];
  game.room.on(Death.committed, {
    id: 'a-finish',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await finishGame(ctx, { winners: ['a'], reason: 'after death committed' });
    },
  });
  game.room.on(Death.committed, {
    id: 'b-fact',
    owner: null,
    eligible: () => true,
    run: () => {
      seen.push('death');
    },
  });
  game.room.on(Death.buried, {
    id: 'burial',
    owner: null,
    eligible: () => true,
    run: () => {
      seen.push('burial');
    },
  });
  await game.room.run('death', async (ctx) => {
    expect((await kill(ctx, death)).kind).toBe('dead');
  });
  expect(seen).toEqual(['death', 'burial']);
  expect(game.room.world.position('legacy')).toBe('discard');
  expect(game.room.history.facts('player.died')).toHaveLength(1);
  expect(game.room.history.facts('player.buried')).toHaveLength(1);
  conserved(game);
});

it.each(['dead', 'finished'] as const)(
  '真实桃的回复准备中使用者 %s 后不再支付其他费用，仍善后已经宣告的材料',
  async (boundary) => {
    const game = cardGame({
      hands: { a: [card('peach', 'peach', 'heart')], c: [card('fee', 'jink')] },
    });
    await game.room.run('wound', (ctx) =>
      ctx.commit('test.wound', [{ kind: 'vitality', player: 'a', hp: 1 }], null),
    );
    game.room.on(Hp.recovering, {
      id: 'a-stop',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        if (boundary === 'dead') await kill(ctx, { ...death, player: 'a' });
        else await finishGame(ctx, { winners: ['b'], reason: 'peach boundary' });
      },
    });
    game.room.on(Hp.recovering, { id: 'b-cost', owner: null, eligible: () => true, run: lateCost });
    expect(
      await use(game, {
        actor: 'a',
        choice: { kind: 'physical', card: 'peach' },
        targets: ['a'],
        timing: { kind: 'effect' },
      }),
    ).toMatchObject({ kind: 'resolved', value: { kind: 'used' } });
    expect(game.room.history.facts('test.late-candidate')).toEqual([]);
    expect(game.room.history.facts('hp.recovered')).toEqual([]);
    expect(game.room.history.facts('card.used')).toHaveLength(1);
    expect(game.room.world.position('peach')).toBe('discard');
    expect(game.room.world.position('fee')).toBe('c:hand');
    expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
    conserved(game);
  },
);

it('真正濒死在死亡前由已宣告桃救回，后续死亡费用不执行，濒死身份完整清理', async () => {
  const game = cardGame({
    hands: { a: [card('peach', 'peach', 'heart')], c: [card('fee', 'jink')] },
  });
  game.room.on(Death.before, {
    id: 'a-last-peach',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      expect(
        (
          await game.book.use(ctx, {
            actor: 'a',
            choice: { kind: 'physical', card: 'peach' },
            targets: ['b'],
            timing: { kind: 'rescue', dying: 'b' },
          })
        ).kind,
      ).toBe('used');
    },
  });
  game.room.on(Death.before, { id: 'b-cost', owner: null, eligible: () => true, run: lateCost });
  await game.room.run('loss', async (ctx) => {
    expect(await loseHp(ctx, { player: 'b', amount: 4, reason: 'probe' })).toMatchObject({
      kind: 'lost',
      afterHp: 0,
    });
  });
  expect(game.room.world.player('b')).toMatchObject({ hp: 1, alive: true });
  expect(game.room.history.facts('test.late-candidate')).toEqual([]);
  expect(game.room.history.facts('player.died')).toEqual([]);
  expect(game.room.history.facts('dying.finished')[0]!.data.detail).toMatchObject({
    kind: 'rescued',
  });
  expect(game.room.world.snapshot.states).toEqual([]);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(game.room.world.position('peach')).toBe('discard');
  expect(game.room.world.position('fee')).toBe('c:hand');
  conserved(game);
});

it('已支付的死亡防止费用保留，只停止本次后续候选', async () => {
  const game = create();
  game.room.on(Death.before, {
    id: 'a-pay-prevention',
    owner: null,
    eligible: () => true,
    async run(ctx, draft) {
      expect(
        (await pay(ctx, { actor: 'c', cards: ['fee'], to: 'discard', reason: 'probe:prevention' }))
          .kind,
      ).toBe('paid');
      draft.prevent('paid prevention');
    },
  });
  game.room.on(Death.before, { id: 'b-cost', owner: null, eligible: () => true, run: lateCost });
  await game.room.run('death', async (ctx) => {
    expect(await kill(ctx, death)).toMatchObject({
      kind: 'prevented',
      reason: 'paid prevention',
    });
  });
  expect(game.room.world.position('fee')).toBe('discard');
  expect(game.room.history.facts('cost.paid')).toHaveLength(1);
  expect(game.room.history.facts('test.late-candidate')).toEqual([]);
  conserved(game);
});

it('满体力不会提前关闭回复准备，扩展提高上限后仍可实际回复', async () => {
  const game = create();
  game.room.on(Hp.recovering, {
    id: 'increase-capacity',
    owner: null,
    eligible: () => true,
    run(ctx) {
      ctx.commit('test.capacity', [{ kind: 'vitality', player: 'b', hp: 4, maxHp: 5 }], null);
    },
  });
  await game.room.run('heal', async (ctx) => {
    expect(await recover(ctx, heal)).toMatchObject({
      kind: 'recovered',
      beforeHp: 4,
      afterHp: 5,
      amount: 1,
    });
  });
  conserved(game);
});

it.each(['recovery', 'death'] as const)(
  '单个 %s 触发回调局部中止不等于整个待决操作失效，仍继续合法候选',
  async (kind) => {
    const game = create();
    await wound(game);
    const stop = (ctx: Context) => ctx.abort('only this callback');
    if (kind === 'recovery') {
      game.room.on(Hp.recovering, { id: 'a-local', owner: null, eligible: () => true, run: stop });
      game.room.on(Hp.recovering, {
        id: 'b-next',
        owner: null,
        eligible: () => true,
        run: lateCost,
      });
      await game.room.run('heal', async (ctx) => {
        expect((await recover(ctx, heal)).kind).toBe('recovered');
      });
    } else {
      game.room.on(Death.before, { id: 'a-local', owner: null, eligible: () => true, run: stop });
      game.room.on(Death.before, {
        id: 'b-next',
        owner: null,
        eligible: () => true,
        run: lateCost,
      });
      await game.room.run('death', async (ctx) => {
        expect((await kill(ctx, death)).kind).toBe('dead');
      });
    }
    expect(game.room.history.facts('cost.paid')).toHaveLength(1);
    expect(game.room.world.position('fee')).toBe('discard');
    conserved(game);
  },
);
