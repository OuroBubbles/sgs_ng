import { playMatch } from '../fixtures/match';
import { expect, it } from 'vitest';
import { finishGame, privateCardPools, runPhase, Cards, Cost } from '../../src/sdk';
import { allotment } from '../../src/content/workshop/allotment';
import { card, cardGame, die } from '../fixtures/cards';
import { nextRequest, answer } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { practiceContent } from '../../src/app/offline/practice';
import { projectMatch } from '../../src/app/offline/projection';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { Draw } from '../../src/rules/cards/draw';
import { Skill } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

const source = { kind: 'general', id: 'test' } as const;
const top = [
  card('black-one', 'slash'),
  card('red-one', 'jink', 'heart'),
  card('black-two', 'jink', 'club'),
  card('red-two', 'peach', 'diamond'),
];
function create() {
  return cardGame({ hands: { a: [] }, draw: top, skills: [allotment] });
}
type Game = ReturnType<typeof create>;
async function grant(game: Game) {
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: 'workshop:allotment', source }),
  );
}
const prepare = (game: Game) =>
  game.room.run('prepare', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
function replay(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(game.room.world.snapshot.states.some((state) => state.key === 'core:private-pool')).toBe(
    false,
  );
  expect(game.room.decisions.pending).toEqual([]);
  expect(game.room.world.snapshot.zones.flatMap((zone) => zone.cards).sort()).toEqual(
    top.map((card) => card.id).sort(),
  );
}

it('分筹可拒绝，未看牌、未宣告发动，也不改变牌序', async () => {
  const game = create();
  await grant(game);
  const running = prepare(game);
  await answer(game, false);
  await running;
  expect(game.room.history.facts(Cards.peeked)).toHaveLength(0);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(0);
  expect(game.room.world.zone('draw').cards).toEqual(top.map((card) => card.id));
  replay(game);
});

it('红牌接收条件与每人额度共用最终校验，全部分配同次提交后再开放后效', async () => {
  const game = create();
  await grant(game);
  await game.room.run('wound', (ctx) =>
    ctx.commit(testTiming('wound'), [{ kind: 'vitality', player: 'b', hp: 2 }], {}),
  );
  let observed = 0;
  game.room.on(Cards.moved, {
    id: 'observe-all',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.to === 'b:hand'),
    run(ctx) {
      observed++;
      expect(ctx.world.position('red-one')).toBe('b:hand');
      expect(ctx.world.position('black-one')).toBe('c:hand');
      expect(ctx.world.position('black-two')).toBe('d:hand');
      expect(ctx.world.position('red-two')).toBe('a:hand');
    },
  });
  const running = prepare(game);
  await answer(game, true);
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('arrange');
  expect(request.data).toMatchObject({
    presentation: 'distribution',
    destinations: { 'red-one': ['a', 'b'], 'black-one': ['a', 'b', 'c', 'd'] },
  });
  expect(privateCardPools(game.room.world, 'c')).toEqual([]);
  const valid = {
    groups: [
      { id: 'a', items: ['red-two'] },
      { id: 'b', items: ['red-one'] },
      { id: 'c', items: ['black-one'] },
      { id: 'd', items: ['black-two'] },
    ],
  };
  const invalid = {
    groups: [
      { id: 'a', items: ['red-two'] },
      { id: 'b', items: ['black-one'] },
      { id: 'c', items: ['red-one'] },
      { id: 'd', items: ['black-two'] },
    ],
  };
  expect(game.room.decisions.submit(request.id, request.token, invalid)).toMatchObject({
    reason: 'invalid',
  });
  expect(game.room.history.facts(Cards.distributed)).toHaveLength(0);
  expect(game.room.decisions.preview(request.id, valid)?.valid).toBe(true);
  await answer(game, valid, 'arrange');
  await running;
  expect(observed).toBe(1);
  expect(game.room.history.facts(Cards.distributed)).toHaveLength(1);
  expect(game.room.history.facts(Draw.completed)).toHaveLength(0);
  replay(game);
});

it('发动支付后某接收者死亡，候选组从当前存活角色派生，余牌仍可合法留给自己', async () => {
  const game = create();
  await grant(game);
  game.room.on(Cost.paid, {
    id: 'kill-recipient',
    owner: null,
    eligible: (_ctx, receipt) => receipt.skill === 'workshop:allotment',
    async run(ctx) {
      await die(ctx, 'b');
    },
  });
  const running = prepare(game);
  await answer(game, true);
  const request = await nextRequest(game.room);
  expect((request.data as { groups: { id: string }[] }).groups.map((group) => group.id)).toEqual([
    'a',
    'c',
    'd',
  ]);
  await answer(game, (request.data as { initial: unknown }).initial, 'arrange');
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(top.map((card) => card.id));
  replay(game);
});

it.each(['dead', 'finished'] as const)(
  '发动宣告后主体 %s 不再看牌或打开分配，已付宣告保留',
  async (boundary) => {
    const game = create();
    await grant(game);
    game.room.on(Cost.paid, {
      id: 'stop-actor',
      owner: null,
      eligible: (_ctx, receipt) => receipt.skill === 'workshop:allotment',
      async run(ctx) {
        if (boundary === 'finished') await finishGame(ctx, { winners: ['b'], reason: 'stop' });
        else await die(ctx, 'a');
      },
    });
    const running = prepare(game);
    await answer(game, true);
    await running;
    expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
    expect(game.room.history.facts(Cards.peeked)).toHaveLength(0);
    expect(game.room.history.facts(Cards.distributed)).toHaveLength(0);
    replay(game);
  },
);

it('发动后失去技能不撤回已宣告的分配', async () => {
  const game = create();
  await grant(game);
  game.room.on(Cost.paid, {
    id: 'revoke',
    owner: null,
    eligible: (_ctx, receipt) => receipt.skill === 'workshop:allotment',
    async run(ctx) {
      await game.skills.revoke(ctx, 'a', 'workshop:allotment', source);
    },
  });
  const running = prepare(game);
  await answer(game, true);
  const request = await nextRequest(game.room);
  await answer(game, (request.data as { initial: unknown }).initial, 'arrange');
  await running;
  expect(game.room.world.zone('a:hand').cards).toHaveLength(4);
  replay(game);
});

it.each([4, 17])(
  '筹策客真实四席身份局由基础 AI 经同一合法分配模型至胜负，seed=%s',
  async (seed) => {
    const content = practiceContent;
    const match = createOfflineMatch({
      seed,
      preset: 'standard:identity',
      lineup: ['workshop:quartermaster', 'standard:guojia', 'standard:simayi', 'standard:guanyu'],
      content,
    });
    let assignments = 0;
    await playMatch(match, { steps: 20000, decisions: 2400 }, (request) => {
      if (
        request.kind === 'arrange' &&
        (request.data as { reason: string }).reason === 'workshop:allotment'
      ) {
        assignments++;
        const view = projectMatch(match, request.player, request);
        expect(view.decision).toMatchObject({ kind: 'arrange', presentation: 'distribution' });
        const observer = match.room.world.snapshot.players.find(
          (player) => player.id !== request.player,
        )!.id;
        expect(observeAgent(match, observer).pools).toEqual([]);
        expect(
          projectMatch(match, observer, null).pools.filter((pool) => pool.visibility === 'private'),
        ).toEqual([]);
      }
    });
    expect(assignments).toBeGreaterThan(0);
    expect(match.room.history.facts(Cards.distributed).length).toBeGreaterThan(0);
  },
  30_000,
);
