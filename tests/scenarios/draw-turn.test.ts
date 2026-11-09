import { expect, it } from 'vitest';
import {
  draw,
  withProcessing,
  moveCards,
  runTurn,
  runPhase,
  defaultPhaseBody,
  activePhase,
  activeTurn,
  activeTarget,
  readState,
  pay,
  used,
  runPhase as phase,
  Cards,
  Cost,
  Phase,
  Turn,
  cardQueries,
  modify,
  useCard,
} from '../../src/sdk';
import type { TurnView } from '../../src/sdk';
import { card, cardGame } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { testTiming } from '../fixtures/timing';

it('摸牌数可在提交前修改，洗牌只补牌堆并保持已有牌堆顶顺序', async () => {
  const game = cardGame({
    hands: { a: [] },
    draw: [card('top', 'slash')],
    discard: [card('x', 'jink'), card('y', 'peach'), card('z', 'duel')],
  });
  game.room.on(Cards.drawing, {
    id: 'draw-more',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, draft) => {
      draft.setCount(3, 'test modifier');
    },
  });
  await game.room.run('draw', async (ctx) => {
    const result = await draw(ctx, { player: 'a', count: 2, reason: 'draw-phase' });
    expect(result).toMatchObject({ kind: 'drawn', count: 3 });
  });
  expect(game.room.world.zone('a:hand').cards).toHaveLength(3);
  expect(game.room.world.zone('a:hand').cards[0]).toBe('top');
  expect(game.room.world.zone('draw').cards).toHaveLength(1);
  expect(game.room.world.zone('discard').cards).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('相同种子洗牌结果一致，不从其他处理区取牌', async () => {
  const options = {
    hands: { a: [] },
    discard: [card('x', 'jink'), card('y', 'peach'), card('z', 'duel')],
  };
  const a = cardGame(options);
  const b = cardGame(options);
  for (const game of [a, b])
    await game.room.run('draw', (ctx) => draw(ctx, { player: 'a', count: 3, reason: 'test' }));
  expect(a.room.world.snapshot).toEqual(b.room.world.snapshot);
  expect(a.room.history.entries).toEqual(b.room.history.entries);
  const c = cardGame();
  await c.room.run('processing', (ctx) =>
    withProcessing(ctx, [{ cards: ['slash1'], from: 'a:hand' }], async (body, processing) => {
      await draw(body, { player: 'b', count: 2, reason: 'empty deck' });
      expect(processing.remaining()).toEqual(['slash1']);
      expect(body.world.zone('b:hand').cards).toEqual([]);
    }),
  );
});

it('摸牌后效完整结束后返回，牌被后效取走也保留真实摸牌事实', async () => {
  const game = cardGame({ hands: { a: [] }, draw: [card('top', 'slash')] });
  game.room.on(Cards.drawn, {
    id: 'give-away',
    owner: 'b',
    eligible: () => true,
    run: async (ctx, result) => {
      await moveCards(
        ctx,
        [{ cards: result.cards, from: 'a:hand', to: 'b:hand', place: 'bottom' }],
        'after draw',
      );
    },
  });
  await game.room.run('draw', async (ctx) => {
    expect(await draw(ctx, { player: 'a', count: 2, reason: 'test' })).toMatchObject({
      cards: ['top'],
      count: 2,
    });
    expect(ctx.world.zone('a:hand').cards).toEqual([]);
    expect(ctx.world.zone('b:hand').cards).toEqual(['top']);
  });
});

it('一次回合以真实决策走过摸牌、出牌、响应、弃牌和结束', async () => {
  const game = cardGame({
    hands: { b: [card('b-jink', 'jink')] },
    draw: [card('d1', 'jink'), card('d2', 'slash')],
  });
  const started: string[] = [];
  game.room.on(Phase.started, {
    id: 'record',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, current) => {
      started.push(current.kind);
    },
  });
  const running = game.room.run('offline turn', (ctx) => runTurn(ctx, 'a'));
  const play = await nextRequest(game.room);
  expect(play.kind).toBe('play-action');
  game.room.decisions.submit(play.id, play.token, {
    choice: { kind: 'physical', card: 'slash1' },
    targets: ['b'],
  });
  const response = await nextRequest(game.room);
  expect(response.kind).toBe('card-response');
  game.room.decisions.submit(response.id, response.token, { kind: 'physical', card: 'b-jink' });
  const pass = await nextRequest(game.room);
  expect(pass.kind).toBe('play-action');
  game.room.decisions.cancel(pass.id, pass.token);
  const discard = await nextRequest(game.room);
  expect(discard.kind).toBe('cards-targets');
  expect(game.room.decisions.cancel(discard.id, discard.token)).toMatchObject({
    reason: 'required',
  });
  game.room.decisions.submit(discard.id, discard.token, { cards: ['slash2'], targets: [] });
  const result = await running;
  expect(started).toEqual(['prepare', 'judge', 'draw', 'play', 'discard', 'finish']);
  expect(result).toMatchObject({
    value: {
      phases: [
        { exit: 'completed' },
        { exit: 'completed' },
        { exit: 'completed' },
        { exit: 'completed' },
        { exit: 'completed' },
        { exit: 'completed' },
      ],
    },
  });
  expect(game.room.world.zone('a:hand').cards).toHaveLength(4);
  expect(game.room.world.player('b').hp).toBe(4);
  expect(readState(game.room.world, activePhase, activeTarget)).toBe(null);
  expect(readState(game.room.world, activeTurn, activeTarget)).toBe(null);
  expect(game.room.decisions.pending).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('跳过阶段不执行阶段本体或开始/结束窗口，其他阶段继续', async () => {
  const game = cardGame({ hands: { a: [] }, draw: [card('d1', 'jink'), card('d2', 'slash')] });
  const stages: string[] = [];
  game.room.on(Phase.before, {
    id: 'skip-draw',
    owner: 'a',
    eligible: (_ctx, current) => current.kind === 'draw',
    run: (ctx, current) => {
      current.skip(ctx, 'skip draw');
    },
  });
  game.room.on(Phase.started, {
    id: 'started',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, current) => {
      stages.push(`start:${current.kind}`);
    },
  });
  game.room.on(Phase.ending, {
    id: 'ended',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, current) => {
      stages.push(`end:${current.kind}`);
    },
  });
  await game.room.run('turn', (ctx) => runTurn(ctx, 'a'));
  expect(stages).not.toContain('start:draw');
  expect(stages).not.toContain('end:draw');
  expect(stages).toContain('end:finish');
  expect(game.room.world.zone('draw').cards).toEqual(['d1', 'd2']);
  expect(game.room.history.facts(Phase.skipped)[0]?.data.detail).toMatchObject({
    kind: 'draw',
    skipped: true,
    reason: 'skip draw',
  });
});

it('弃牌阶段结束时按显式阶段身份查询本阶段弃牌', async () => {
  const game = cardGame();
  const counts: number[] = [];
  await game.room.run('wound', (ctx) =>
    ctx.commit(testTiming('hp'), [{ kind: 'vitality', player: 'a', hp: 2 }], {}),
  );
  game.room.on(Phase.ending, {
    id: 'query',
    owner: 'b',
    eligible: (_ctx, current) => current.kind === 'discard',
    run: (ctx, current) => {
      counts.push(ctx.history.facts(Cards.discarded, current.id).length);
    },
  });
  const running = game.room.run('discard', (ctx) => runPhase(ctx, 'a', 'discard'));
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, {
    cards: ['slash1', 'slash2'],
    targets: [],
  });
  await running;
  expect(counts).toEqual([1]);
  expect(game.room.world.zone('a:hand').cards).toEqual(['peach', 'duel']);
});

it('模式可以用普通函数扩展阶段本体，不依赖一个技能模板表', async () => {
  const game = cardGame({ hands: { a: [] } });
  const order: string[] = [];
  await game.room.run('turn', (ctx) =>
    runTurn(ctx, 'a', {
      body: async (body, current) => {
        order.push(`before:${current.kind}`);
        await defaultPhaseBody(body, current);
        if (current.kind === 'finish')
          await body.flow('custom finish', () => {
            order.push('custom');
          });
      },
    }),
  );
  expect(order).toContain('before:draw');
  expect(order.at(-1)).toBe('custom');
});

it('阶段开始时结束回合可停止本体与后续阶段', async () => {
  const game = cardGame();
  const phases: string[] = [];
  game.room.on(Phase.started, {
    id: 'record',
    owner: 'b',
    eligible: () => true,
    run: (_ctx, current) => {
      phases.push(current.kind);
    },
  });
  game.room.on(Phase.started, {
    id: 'end-turn',
    owner: 'a',
    eligible: (_ctx, current) => current.kind === 'play',
    run: (ctx, current) => {
      current.turn?.end(ctx, 'test end');
    },
  });
  const result = await game.room.run('turn', (ctx) => runTurn(ctx, 'a'));
  expect(phases).toEqual(['prepare', 'judge', 'draw', 'play']);
  expect(game.room.decisions.pending).toEqual([]);
  expect(result).toMatchObject({ value: { ended: true } });
});

it('支付后死亡会停止后续阶段，正常结束会恢复对局阶段状态', async () => {
  const game = cardGame();
  game.room.on(Cost.paid, {
    id: 'die',
    owner: 'b',
    eligible: (_ctx, receipt) => receipt.cards.includes('slash1'),
    run: (ctx) => {
      ctx.commit(testTiming('death'), [{ kind: 'vitality', player: 'a', hp: 0, alive: false }], {});
    },
  });
  const running = game.room.run('turn', (ctx) => runTurn(ctx, 'a'));
  const play = await nextRequest(game.room);
  game.room.decisions.submit(play.id, play.token, {
    choice: { kind: 'physical', card: 'slash1' },
    targets: ['b'],
  });
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(Phase.started)).toHaveLength(4);
  expect(readState(game.room.world, activePhase, activeTarget)).toBe(null);
  expect(readState(game.room.world, activeTurn, activeTarget)).toBe(null);
});

it('独立额外出牌阶段拥有新身份，可重新使用杀', async () => {
  const game = cardGame();
  const ids: string[] = [];
  await game.room.run('extra phases', async (ctx) => {
    for (const id of ['slash1', 'slash2'])
      await phase(ctx, 'a', 'play', async (body, current) => {
        ids.push(current.id);
        await useCard(body, {
          actor: 'a',
          choice: { kind: 'physical', card: id },
          targets: ['b'],
          timing: current.playTiming(),
        });
      });
  });
  expect(new Set(ids).size).toBe(2);
  expect(game.room.world.player('b').hp).toBe(2);
});

it('用牌费用后效结束回合，已宣告牌仍完整结算，再停止后续阶段', async () => {
  const game = cardGame();
  const captured: { turn?: TurnView } = {};
  game.room.on(Turn.started, {
    id: 'capture',
    owner: 'a',
    eligible: () => true,
    run: (_ctx, current) => {
      captured.turn = current;
    },
  });
  game.room.on(Cost.paid, {
    id: 'end-turn',
    owner: 'b',
    eligible: (_ctx, receipt) => receipt.cards.includes('slash1'),
    run: (ctx) => {
      captured.turn?.end(ctx, 'stop after current use');
    },
  });
  const running = game.room.run('turn', (ctx) => runTurn(ctx, 'a'));
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, {
    choice: { kind: 'physical', card: 'slash1' },
    targets: ['b'],
  });
  expect(await running).toMatchObject({
    value: { ended: true, reason: 'stop after current use' },
  });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(Phase.started)).toHaveLength(4);
  expect(game.room.decisions.pending).toEqual([]);
});

it('阶段 body 中止仍清理并恢复阶段状态，记录明确原因', async () => {
  const game = cardGame();
  expect(
    await game.room.run('phase', (ctx) =>
      runPhase(ctx, 'a', 'draw', (body) => body.abort('explicit phase abort')),
    ),
  ).toMatchObject({ value: { exit: 'aborted', reason: 'explicit phase abort' } });
  expect(readState(game.room.world, activePhase, activeTarget)).toBe(null);
  expect(
    game.room.history.entries.some(
      (entry) =>
        entry.type === 'flow.close' &&
        typeof entry.data === 'object' &&
        entry.data !== null &&
        'reason' in entry.data &&
        entry.data.reason === 'explicit phase abort',
    ),
  ).toBe(true);
});

it('手牌上限通过具名纯查询修正，不必复制弃牌阶段实现', async () => {
  const game = cardGame({ rules: [modify(cardQueries.handLimitCorrection, () => 2)] });
  await game.room.run('wound', (ctx) =>
    ctx.commit(testTiming('hp'), [{ kind: 'vitality', player: 'a', hp: 2 }], {}),
  );
  await game.room.run('discard', (ctx) => runPhase(ctx, 'a', 'discard'));
  expect(game.room.world.zone('a:hand').cards).toHaveLength(4);
  expect(game.room.history.facts(Cards.discarded)).toEqual([]);
  expect(game.room.decisions.pending).toEqual([]);
});

it('弃牌费用、次数、跳过意图原子宣告，后效不会读到半完成状态', async () => {
  const game = cardGame({ draw: [card('d1', 'jink')] });
  const observations: boolean[] = [];
  game.room.on(Phase.before, {
    id: 'paid-skip',
    owner: 'a',
    eligible: (_ctx, current) => current.kind === 'draw',
    run: async (ctx, current) => {
      const limit = { key: 'skip-draw', source: 'test:skip', lifetime: current.lifetime, max: 1 };
      ctx.defer(
        game.room.on(Cost.paid, {
          id: 'observe-skip',
          owner: 'b',
          eligible: () => true,
          run: (atPay) => {
            observations.push(
              current.skipped &&
                used(atPay.world, 'a', limit) === 1 &&
                atPay.world.zone('discard').cards.includes('slash1'),
            );
          },
        }),
      );
      const result = await pay(ctx, {
        actor: 'a',
        cards: ['slash1'],
        to: 'discard',
        reason: 'skip-draw',
        limit,
        changes: [current.skipChange(ctx, 'paid skip')],
        declaration: { phaseId: current.id },
      });
      expect(result).toMatchObject({ kind: 'paid' });
    },
  });
  await game.room.run('phase', (ctx) => runPhase(ctx, 'a', 'draw'));
  expect(observations).toEqual([true]);
  expect(game.room.world.zone('draw').cards).toEqual(['d1']);
  expect(game.room.history.facts(Phase.skipped)).toHaveLength(1);
});

it('费用失效时不提交跳过意图，阶段照常执行', async () => {
  const game = cardGame({ hands: { b: [card('other', 'jink')] }, draw: [card('d1', 'jink')] });
  game.room.on(Phase.before, {
    id: 'bad-cost',
    owner: 'a',
    eligible: (_ctx, current) => current.kind === 'draw',
    run: async (ctx, current) => {
      expect(
        await pay(ctx, {
          actor: 'a',
          cards: ['other'],
          to: 'discard',
          reason: 'invalid skip',
          changes: [current.skipChange(ctx, 'should not commit')],
        }),
      ).toMatchObject({ kind: 'unavailable' });
      expect(current.skipped).toBe(false);
    },
  });
  await game.room.run('phase', (ctx) => runPhase(ctx, 'a', 'draw'));
  expect(game.room.history.facts(Phase.skipped)).toEqual([]);
  expect(game.room.world.zone('a:hand').cards).toContain('d1');
  expect(game.room.world.zone('b:hand').cards).toEqual(['other']);
});
