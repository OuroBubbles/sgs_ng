import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import {
  changeShield,
  damage,
  isChained,
  setChained,
  loseHp,
  recover,
  Damage,
} from '../../src/sdk';
import { shieldOf, Shield } from '../../src/rules/combat/shield';
import { finishGame } from '../../src/rules/game/end';
import { Dying } from '../../src/rules/combat/life-events';
import type { Context, DamageDraft } from '../../src/sdk';
import { card, cardGame, settled } from '../fixtures/cards';
import { standardGeneralSkills } from '../fixtures/standard';
import { testTiming } from '../fixtures/timing';

type Game = ReturnType<typeof cardGame>;
const hit = { from: 'a', to: 'b', amount: 2, nature: 'normal' } as const;
async function ward(game: Game, player: string, amount: number) {
  await game.room.run('shield', (ctx) => changeShield(ctx, { player, amount, reason: 'setup' }));
}
function dealt(game: Game) {
  return game.room.history.facts(Damage.dealt).map((fact) => fact.data.detail);
}

it('护盾增减有实际量与尝试量，减少至零，无变化不发事实/窗口', async () => {
  const game = cardGame();
  const changes: number[] = [];
  game.room.on(Shield.changed, {
    id: 'changed',
    owner: 'a',
    eligible: () => true,
    run(ctx, event) {
      expect(shieldOf(ctx.world, event.player)).toBe(event.after);
      expect(Object.isFrozen(event)).toBe(true);
      changes.push(event.amount);
    },
  });
  await game.room.run('change', async (ctx) => {
    expect(shieldOf(ctx.world, 'b')).toBe(0);
    expect(await changeShield(ctx, { player: 'b', amount: 3, reason: 'gain' })).toMatchObject({
      before: 0,
      after: 3,
      amount: 3,
    });
    expect(await changeShield(ctx, { player: 'b', amount: -8, reason: 'lose' })).toMatchObject({
      before: 3,
      after: 0,
      amount: -3,
      attemptedAmount: -8,
    });
    expect((await changeShield(ctx, { player: 'b', amount: 0, reason: 'same' })).kind).toBe(
      'unchanged',
    );
    expect((await changeShield(ctx, { player: 'b', amount: -1, reason: 'empty' })).kind).toBe(
      'unchanged',
    );
  });
  expect(changes).toEqual([3, -3]);
  expect(game.room.history.facts(Shield.changed)).toHaveLength(2);
  settled(game);
});

it.each([0, 1, 2, 3])(
  '伤害 2 遇护盾 %s：伤害、护盾消耗和扣血独立，仍触发一次受伤后',
  async (shield) => {
    const game = cardGame();
    await ward(game, 'b', shield);
    let received = 0;
    game.room.on(Damage.received, {
      id: 'received',
      owner: 'b',
      eligible: () => true,
      run() {
        received++;
      },
    });
    await game.room.run('hit', (ctx) => damage(ctx, hit));
    const lost = Math.min(2, shield);
    expect(dealt(game)[0]).toMatchObject({
      amount: 2,
      shieldLost: lost,
      hpLoss: 2 - lost,
      beforeShield: shield,
      afterShield: shield - lost,
      beforeHp: 4,
      afterHp: 2 + lost,
    });
    expect(received).toBe(1);
    expect(shieldOf(game.room.world, 'b')).toBe(shield - lost);
    settled(game);
  },
);

it('扣血、护盾消耗与解链同次提交，状态窗口看见同一个完整结果', async () => {
  const game = cardGame();
  await ward(game, 'b', 1);
  await game.room.run('link', (ctx) => setChained(ctx, 'b', true, 'setup'));
  let observed = false;
  game.room.on(Shield.changed, {
    id: 'atomic',
    owner: 'b',
    eligible: (_ctx, event) => event.damage !== undefined,
    run(ctx, event) {
      observed = true;
      expect(ctx.world.player('b').hp).toBe(3);
      expect(shieldOf(ctx.world, 'b')).toBe(0);
      expect(isChained(ctx.world, 'b')).toBe(false);
      const fact = ctx.history
        .facts(Damage.dealt)
        .find((fact) => fact.data.detail.id === event.damage)!;
      expect(fact.data.changes.map((change) => change.kind)).toEqual([
        'vitality',
        'setState',
        'setState',
      ]);
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, { ...hit, nature: 'fire' }));
  expect(observed).toBe(true);
  settled(game);
});

it.each(['prevent', 'zero'])('%s 不消耗护盾，也不发护盾消耗窗口', async (kind) => {
  const game = cardGame();
  await ward(game, 'b', 3);
  game.room.on(Damage.inflicting, {
    id: 'stop',
    owner: 'b',
    eligible: () => true,
    run(_ctx, draft) {
      if (kind === 'prevent') draft.prevent('immune');
      else draft.setAmount(0, 'reduced');
    },
  });
  await game.room.run('hit', async (ctx) => {
    const result = await damage(ctx, hit);
    expect(result).toMatchObject({ shieldLost: 0, hpLoss: 0, beforeShield: 3, afterShield: 3 });
  });
  expect(shieldOf(game.room.world, 'b')).toBe(3);
  expect(dealt(game)).toEqual([]);
  settled(game);
});

it('护盾读取窗口结算后的当前状态，来源快照与最终伤害不因吸收而改写', async () => {
  const game = cardGame();
  game.room.on(Damage.causing, {
    id: 'plus',
    owner: 'a',
    eligible: () => true,
    run(_ctx, draft) {
      draft.adjust(1, 'plus');
    },
  });
  game.room.on(Damage.inflicting, {
    id: 'defense',
    owner: 'b',
    eligible: () => true,
    async run(ctx, draft) {
      draft.setAmount(2, 'cap');
      await changeShield(ctx, { player: 'b', amount: 1, reason: 'fresh' });
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(dealt(game)[0]).toMatchObject({
    input: { amount: 2 },
    sourceSnapshot: { amount: 3 },
    amount: 2,
    shieldLost: 1,
    hpLoss: 1,
  });
  settled(game);
});

it('全部抵消的属性伤害仍解链并按伤害量传播，每个目标独立吸收', async () => {
  const game = cardGame();
  await ward(game, 'b', 3);
  await ward(game, 'c', 1);
  await game.room.run('link', async (ctx) => {
    for (const player of ['b', 'c', 'd']) await setChained(ctx, player, true, 'setup');
  });
  await game.room.run('hit', (ctx) => damage(ctx, { ...hit, nature: 'fire' }));
  expect(dealt(game).map((result) => result.amount)).toEqual([2, 2, 2]);
  expect(dealt(game).map((result) => result.hpLoss)).toEqual([0, 1, 2]);
  expect(dealt(game).map((result) => result.shieldLost)).toEqual([2, 1, 0]);
  expect(['b', 'c', 'd'].some((player) => isChained(game.room.world, player))).toBe(false);
  settled(game);
});

it('忽略护盾只属于当前伤害，连环下一名角色正常吸收', async () => {
  const game = cardGame();
  await ward(game, 'b', 3);
  await ward(game, 'c', 3);
  await game.room.run('link', async (ctx) => {
    for (const player of ['b', 'c']) await setChained(ctx, player, true, 'setup');
  });
  await game.room.run('hit', (ctx) => damage(ctx, { ...hit, nature: 'fire', bypassShield: true }));
  expect(dealt(game).map((result) => result.hpLoss)).toEqual([2, 0]);
  expect(dealt(game).map((result) => result.shieldLost)).toEqual([0, 2]);
  expect(dealt(game).map((result) => result.shieldBypass)).toEqual(['request', null]);
  settled(game);
});

it('技能可通过普通伤害草案忽略护盾，纯查询与关闭后的草案不能修改', async () => {
  const game = cardGame();
  await ward(game, 'b', 3);
  let captured: DamageDraft;
  game.room.on(Damage.inflicting, {
    id: 'pierce',
    owner: 'a',
    eligible: (ctx, draft) => {
      expect(() => ctx.query(() => draft.ignoreShield('invalid'))).toThrow('Pure queries');
      return true;
    },
    run(_ctx, draft) {
      captured = draft;
      draft.ignoreShield('probe:pierce');
      expect(draft.shieldBypass).toBe('probe:pierce');
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(dealt(game)[0]).toMatchObject({ hpLoss: 2, shieldLost: 0, shieldBypass: 'probe:pierce' });
  expect(() => captured!.ignoreShield('late')).toThrow();
  settled(game);
});

it('消耗后新获得护盾不回写已提交伤害，实际 World 与事实快照分别准确', async () => {
  const game = cardGame();
  await ward(game, 'b', 1);
  game.room.on(Shield.changed, {
    id: 'refresh',
    owner: 'b',
    eligible: (_ctx, event) => event.damage !== undefined,
    async run(ctx) {
      await changeShield(ctx, { player: 'b', amount: 3, reason: 'refresh' });
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(dealt(game)[0]).toMatchObject({ afterShield: 0, shieldLost: 1, hpLoss: 1 });
  expect(shieldOf(game.room.world, 'b')).toBe(3);
  settled(game);
});

it('失去体力与回复不消耗或恢复护盾', async () => {
  const game = cardGame();
  await ward(game, 'b', 2);
  await game.room.run('health', async (ctx) => {
    await loseHp(ctx, { player: 'b', amount: 1, reason: 'cost' });
    await recover(ctx, { from: 'b', to: 'b', amount: 1 });
  });
  expect(shieldOf(game.room.world, 'b')).toBe(2);
  expect(game.room.world.player('b').hp).toBe(4);
  settled(game);
});

it('护盾全抵消时不新开濒死，即使角色已由外层规则处于零体力', async () => {
  const game = cardGame();
  await ward(game, 'b', 3);
  let dying = 0;
  game.room.on(Dying.started, {
    id: 'dying',
    owner: 'b',
    eligible: () => true,
    run() {
      dying++;
    },
  });
  await game.room.run('hit', async (ctx) => {
    ctx.commit(testTiming('setup.hp'), [{ kind: 'vitality', player: 'b', hp: 0 }], null);
    await damage(ctx, hit);
  });
  expect(dying).toBe(0);
  expect(game.room.world.player('b')).toMatchObject({ alive: true, hp: 0 });
  settled(game);
});

it('被护盾全抵消的两点伤害仍提供两次遗计，费用/池与伤害次数不借扣血量计数', async () => {
  const game = cardGame({
    skills: standardGeneralSkills,
    draw: Array.from({ length: 4 }, (_, i) => card(`reward-${i}`, 'jink')),
  });
  await ward(game, 'b', 3);
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, {
      owner: 'b',
      skill: 'standard:yiji',
      source: { kind: 'general', id: 'probe' },
    }),
  );
  const running = game.room.run('hit', (ctx) => damage(ctx, hit));
  let done = false;
  running.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  const prompts: string[] = [];
  for (let step = 0; step < 400 && !done; step++) {
    await setImmediate();
    const request = game.room.decisions.pending[0];
    if (!request) continue;
    if (request.kind === 'invoke') {
      prompts.push(request.prompt);
      expect(game.room.decisions.submit(request.id, request.token, true).kind).toBe('accepted');
    } else {
      expect(request.optional).toBe(true);
      expect(game.room.decisions.cancel(request.id, request.token).kind).toBe('accepted');
    }
  }
  expect(done).toBe(true);
  await running;
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toContain('1/2');
  expect(prompts[1]).toContain('2/2');
  expect(game.room.world.zone('b:hand').cards).toHaveLength(4);
  expect(game.room.world.player('b').hp).toBe(4);
  expect(dealt(game)[0]!.hpLoss).toBe(0);
  settled(game);
});

it('纯查询、已关闭 Context 与终局均不能改变护盾', async () => {
  const game = cardGame();
  let closed: Context;
  await game.room.run('query', async (ctx) => {
    closed = ctx;
    expect(() =>
      ctx.query(() => changeShield(ctx, { player: 'b', amount: 1, reason: 'bad' })),
    ).toThrow('Pure queries');
    await finishGame(ctx, { winners: ['a'], reason: 'done' });
    expect((await changeShield(ctx, { player: 'b', amount: 1, reason: 'ended' })).kind).toBe(
      'unavailable',
    );
  });
  expect(() => changeShield(closed!, { player: 'b', amount: 1, reason: 'closed' })).toThrow();
  expect(shieldOf(game.room.world, 'b')).toBe(0);
  settled(game);
});

it.each([NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  '非法护盾变化 %s 不提交',
  async (amount) => {
    const game = cardGame();
    await expect(
      game.room.run('invalid', (ctx) =>
        changeShield(ctx, { player: 'b', amount, reason: 'invalid' }),
      ),
    ).rejects.toThrow();
    expect(game.room.history.facts()).toEqual([]);
    settled(game);
  },
);

it('无隐藏护盾上限；安全整数溢出在同次提交前拒绝', async () => {
  const game = cardGame();
  await ward(game, 'b', Number.MAX_SAFE_INTEGER);
  await expect(
    game.room.run('overflow', (ctx) =>
      changeShield(ctx, { player: 'b', amount: 1, reason: 'overflow' }),
    ),
  ).rejects.toThrow('safe integer');
  expect(shieldOf(game.room.world, 'b')).toBe(Number.MAX_SAFE_INTEGER);
  settled(game);
});
