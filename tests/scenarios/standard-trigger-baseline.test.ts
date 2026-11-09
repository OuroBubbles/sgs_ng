import { generalGame } from '../fixtures/generals';
import { setImmediate } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { ownedCards, validateUse } from '../../src/sdk';
import { runPhase } from '../../src/rules/turn/turn';
import { card, cardGame, use, settled } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Draw } from '../../src/rules/cards/draw';
import { Skill } from '../../src/sdk';

type Game = ReturnType<typeof cardGame>;
const source = { kind: 'general', id: 'trigger-baseline' } as const;

async function grant(game: Game, name: string, owner = 'a') {
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner, skill: `standard:${name}`, source }),
  );
  return game.room.world.snapshot.skills.find(
    (instance) => instance.owner === owner && instance.skill === `standard:${name}`,
  )!.id;
}

// 主动接受任何意外发动：回归时直接核对其实际影响，不靠等不到请求的超时来判断。
async function acceptInvocations(game: Game, running: Promise<unknown>) {
  let done = false;
  let failure: Error | undefined;
  const observed = running.then(
    () => {
      done = true;
    },
    (error: unknown) => {
      done = true;
      failure = error instanceof Error ? error : new Error('Scenario failed', { cause: error });
    },
  );
  let accepted = 0;
  for (let step = 0; !done && step < 200; step++) {
    await setImmediate();
    for (const request of game.room.decisions.pending) {
      expect(request.kind).toBe('invoke');
      expect(game.room.decisions.submit(request.id, request.token, true)).toEqual({
        kind: 'accepted',
      });
      accepted++;
    }
  }
  expect(done, '有限步内结算应完成').toBe(true);
  await observed;
  if (failure) throw failure;
  return accepted;
}

it('无双不会把万箭齐发的一次打出闪扩张为连续两次', async () => {
  const game = generalGame({
    hands: { a: [card('arrows', 'archery_attack')], b: [card('jink', 'jink')] },
  });
  await grant(game, 'wushuang');
  const running = use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 'arrows' },
    targets: [],
    timing: { kind: 'effect' },
  });
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('card-response');
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'jink' }),
  ).toEqual({ kind: 'accepted' });
  expect(await running).toMatchObject({ value: { kind: 'used' } });
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.player('c').hp).toBe(3);
  expect(game.room.world.player('d').hp).toBe(3);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  settled(game);
});

it.each(['qianxun', 'kongcheng'] as const)(
  '%s 只禁止本人的指定牌名目标，不扩张到其他牌、其他角色或来源用牌',
  async (skill) => {
    const game = generalGame({
      equipment: { b: [card('b-eq', 'crossbow')], c: [card('c-eq', 'crossbow')] },
    });
    await grant(game, skill, 'b');
    await game.room.run('target-boundary', (ctx) => {
      const before = ctx.world.snapshot;
      const forbidden = skill === 'qianxun' ? ['snatch', 'indulgence'] : ['slash', 'duel'];
      for (const name of ['slash', 'duel', 'snatch', 'indulgence', 'dismantlement']) {
        const intent = {
          actor: 'a',
          choice: {
            kind: 'generated',
            face: { name: `standard:${name}` },
            materials: [],
            reason: 'baseline',
          },
          targets: ['b'],
          timing: { kind: 'effect', ignoreDistance: true },
        } as const;
        expect(validateUse(ctx, intent).ok, `a→b ${name}`).toBe(!forbidden.includes(name));
        expect(validateUse(ctx, { ...intent, targets: ['c'] }).ok, `a→c ${name}`).toBe(true);
        expect(validateUse(ctx, { ...intent, actor: 'b', targets: ['c'] }).ok, `b→c ${name}`).toBe(
          true,
        );
      }
      expect(ctx.world.snapshot).toEqual(before);
    });
    expect(game.room.history.facts(CardEvent.used)).toEqual([]);
    settled(game);
  },
);

it('集智不响应他人使用的实体普通锦囊', async () => {
  const game = generalGame({
    hands: { b: [card('trick', 'ex_nihilo')] },
    draw: [card('one', 'jink'), card('two', 'slash'), card('three', 'peach')],
  });
  await grant(game, 'jizhi');
  expect(
    await acceptInvocations(
      game,
      use(game, {
        actor: 'b',
        choice: { kind: 'physical', card: 'trick' },
        targets: ['b'],
        timing: { kind: 'effect' },
      }),
    ),
  ).toBe(0);
  expect(ownedCards(game.room.world, 'a')).toEqual([]);
  expect(ownedCards(game.room.world, 'b')).toEqual(['one', 'two']);
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  settled(game);
});

it('集智不响应奇袭转换的有材料普通锦囊，实际拆牌仍完成', async () => {
  const game = generalGame({
    hands: { a: [card('material', 'slash', 'club')] },
    equipment: { b: [card('victim', 'crossbow')] },
    draw: [card('untouched', 'peach')],
  });
  await grant(game, 'jizhi');
  const instance = await grant(game, 'qixi');
  const running = use(game, {
    actor: 'a',
    choice: { kind: 'viewAs', instance, recipe: 'black-dismantlement', materials: ['material'] },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('cards-targets');
  const candidate = (request.data as { preview: { cards: { id: string }[] } }).preview.cards[0]!;
  expect(
    game.room.decisions.submit(request.id, request.token, { cards: [candidate.id], targets: [] }),
  ).toEqual({ kind: 'accepted' });
  expect(await running).toMatchObject({ value: { kind: 'used' } });
  expect(game.room.world.position('material')).toBe('discard');
  expect(game.room.world.position('victim')).toBe('discard');
  expect(game.room.world.zone('draw').cards).toEqual(['untouched']);
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  expect(game.room.history.facts(Draw.completed)).toEqual([]);
  settled(game);
});

it.each(['yingzi', 'biyue'] as const)(
  '%s 不响应他人的对应阶段，也不响应本人的其他阶段',
  async (skill) => {
    const game = generalGame({
      draw: Array.from({ length: 6 }, (_, i) => card(`draw${i}`, 'peach')),
    });
    await grant(game, skill);
    const running = game.room.run('phases', async (ctx) => {
      await runPhase(ctx, 'b', skill === 'yingzi' ? 'draw' : 'finish');
      await runPhase(ctx, 'a', skill === 'yingzi' ? 'finish' : 'draw');
    });
    expect(await acceptInvocations(game, running)).toBe(0);
    expect(ownedCards(game.room.world, 'a')).toHaveLength(skill === 'yingzi' ? 0 : 2);
    expect(ownedCards(game.room.world, 'b')).toHaveLength(skill === 'yingzi' ? 2 : 0);
    expect(game.room.history.facts(Skill.invoked)).toEqual([]);
    settled(game);
  },
);
