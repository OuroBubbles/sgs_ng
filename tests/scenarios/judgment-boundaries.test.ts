import { expect, it, vi } from 'vitest';
import { judge, draw, Judgment } from '../../src/sdk';
import { finishGame } from '../../src/rules/game/end';
import type { Context } from '../../src/sdk';
import type { JudgmentResult } from '../../src/rules/cards/judge';
import { card, cardGame, use, conserved, die } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';

type Boundary = 'dead' | 'finished';
const stages = [Judgment.revealed, Judgment.retrial] as const;
const boundaries = ['dead', 'finished'] as const;

function create() {
  return cardGame({
    hands: { a: [], b: [card('replacement', 'jink', 'heart')] },
    draw: [card('outer', 'slash'), card('inner', 'jink'), card('spare', 'peach')],
  });
}
async function invalidate(ctx: Context, boundary: Boundary, player = 'a') {
  if (boundary === 'finished')
    await finishGame(ctx, { winners: ['c'], reason: 'judgment boundary' });
  else await die(ctx, player);
}

for (const stage of stages) {
  it.each(boundaries)(
    `${stage.id} 首个后效使判定者 %s，不再执行本窗剩余效果或发放新牌`,
    async (boundary) => {
      const game = create();
      game.room.on(stage, {
        id: 'a-invalidate',
        owner: null,
        eligible: () => true,
        run: (ctx) => invalidate(ctx, boundary),
      });
      const later = vi.fn(async (ctx: Context) => {
        await draw(ctx, { player: 'c', count: 1, reason: 'stale judgment trigger' });
      });
      game.room.on(stage, { id: 'z-later', owner: null, eligible: () => true, run: later });
      const match = vi.fn(() => true);
      await game.room.run('judge', async (ctx) => {
        expect(await judge(ctx, { player: 'a', reason: 'probe', match })).toMatchObject({
          kind: 'unavailable',
          matched: null,
        });
      });
      expect(later.mock.calls.length).toBe(0);
      expect(match).not.toHaveBeenCalled();
      expect(game.room.world.zone('c:hand').cards).toEqual([]);
      expect(game.room.history.facts(Judgment.revealed)).toHaveLength(1);
      expect(game.room.history.facts(Judgment.finished)).toHaveLength(1);
      expect(game.room.world.position('outer')).toBe('discard');
      conserved(game);
    },
  );

  it(`${stage.id} 其他角色死亡不取消存活判定者的窗口`, async () => {
    const game = create();
    game.room.on(stage, {
      id: 'a-other-dies',
      owner: null,
      eligible: () => true,
      run: (ctx) => invalidate(ctx, 'dead', 'b'),
    });
    const later = vi.fn();
    game.room.on(stage, { id: 'z-later', owner: null, eligible: () => true, run: later });
    await game.room.run('judge', async (ctx) => {
      expect(await judge(ctx, { player: 'a', reason: 'probe', match: () => true })).toMatchObject({
        kind: 'judged',
        matched: true,
        card: { id: 'outer' },
      });
    });
    expect(later).toHaveBeenCalledTimes(1);
    conserved(game);
  });

  it.each(boundaries)(
    `${stage.id} 已提交改判后判定者 %s，停止后续候选但不回滚交换`,
    async (boundary) => {
      const game = create();
      game.room.on(stage, {
        id: 'a-replace-and-stop',
        owner: null,
        eligible: () => true,
        async run(ctx, judgment) {
          expect(
            await judgment.replace(ctx, {
              card: 'replacement',
              from: 'b:hand',
              previousTo: 'b:hand',
              reason: 'committed retrial',
            }),
          ).toBe('replaced');
          await invalidate(ctx, boundary);
        },
      });
      const later = vi.fn();
      game.room.on(stage, { id: 'z-later', owner: null, eligible: () => true, run: later });
      await game.room.run('judge', async (ctx) => {
        expect(await judge(ctx, { player: 'a', reason: 'probe', match: () => true })).toMatchObject(
          { kind: 'unavailable', matched: null },
        );
      });
      expect(later.mock.calls.length).toBe(0);
      expect(game.room.history.facts(Judgment.replaced)).toHaveLength(1);
      expect(game.room.world.position('outer')).toBe('b:hand');
      expect(game.room.world.position('replacement')).toBe('discard');
      conserved(game);
    },
  );

  it(`${stage.id} 内层判定杀死外层判定者，只收束外层窗口`, async () => {
    const game = create();
    let inner: JudgmentResult | undefined;
    const later: string[] = [];
    game.room.on(stage, {
      id: 'a-nest',
      owner: null,
      eligible: (_ctx, judgment) => judgment.player === 'a',
      async run(ctx) {
        inner = await judge(ctx, { player: 'b', reason: 'inner', match: () => true });
      },
    });
    game.room.on(stage, {
      id: 'b-stop-outer',
      owner: null,
      eligible: (_ctx, judgment) => judgment.player === 'b',
      run: (ctx) => invalidate(ctx, 'dead'),
    });
    game.room.on(stage, {
      id: 'z-later',
      owner: null,
      eligible: () => true,
      run: (_ctx, judgment) => {
        later.push(judgment.player);
      },
    });
    await game.room.run('judge', async (ctx) => {
      expect(await judge(ctx, { player: 'a', reason: 'outer', match: () => true })).toMatchObject({
        kind: 'unavailable',
        matched: null,
      });
    });
    expect(inner).toMatchObject({ kind: 'judged', matched: true, card: { id: 'inner' } });
    expect(later).toEqual(['b']);
    expect(game.room.world.position('outer')).toBe('discard');
    expect(game.room.world.position('inner')).toBe('discard');
    conserved(game);
  });

  it(`${stage.id} 单个候选局部中止不取消整个判定，其他候选仍可运行`, async () => {
    const game = create();
    game.room.on(stage, {
      id: 'abort',
      owner: null,
      eligible: () => true,
      run: (ctx) => ctx.abort('stop judgment'),
    });
    const later = vi.fn();
    game.room.on(stage, { id: 'z-later', owner: null, eligible: () => true, run: later });
    expect(
      await game.room.run(
        'judge',
        async (ctx) => await judge(ctx, { player: 'a', reason: 'probe', match: () => true }),
      ),
    ).toMatchObject({ kind: 'resolved', value: { kind: 'judged', matched: true } });
    expect(later).toHaveBeenCalledTimes(1);
    expect(game.room.history.facts(Judgment.finished)).toHaveLength(1);
    expect(game.room.world.position('outer')).toBe('discard');
    conserved(game);
  });
}

it.each(boundaries)('结果已封口后 %s，保留真实判定及公共完成后效', async (boundary) => {
  const game = create();
  game.room.on(Judgment.finished, {
    id: 'a-invalidate',
    owner: null,
    eligible: () => true,
    run: (ctx) => invalidate(ctx, boundary),
  });
  let seen: JudgmentResult | undefined;
  let continuation: JudgmentResult | undefined;
  game.room.on(Judgment.finished, {
    id: 'z-observe-committed',
    owner: null,
    eligible: () => true,
    run: (_ctx, result) => {
      seen = result;
    },
  });
  await game.room.run('judge', async (ctx) => {
    expect(
      await judge(ctx, {
        player: 'a',
        reason: 'probe',
        match: () => true,
        onResult: (_ctx, result) => {
          continuation = result;
        },
      }),
    ).toMatchObject({ kind: 'judged', matched: true, card: { id: 'outer' } });
  });
  expect(seen).toMatchObject({ kind: 'judged', matched: true, card: { id: 'outer' } });
  expect(continuation).toEqual(seen);
  conserved(game);
});

it.each(boundaries)('真实八卦阵翻牌后 %s，不执行旧判定后效或伪造成功闪', async (boundary) => {
  const game = cardGame({
    hands: { a: [card('slash', 'slash')], b: [] },
    equipment: { b: [card('armor', 'eight_diagram')] },
    draw: [card('red', 'jink', 'heart')],
  });
  game.room.on(Judgment.revealed, {
    id: 'a-invalidate',
    owner: null,
    eligible: () => true,
    run: (ctx) => invalidate(ctx, boundary, 'b'),
  });
  const later = vi.fn();
  game.room.on(Judgment.revealed, { id: 'z-later', owner: null, eligible: () => true, run: later });
  const running = use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 'slash' },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('invoke');
  expect(game.room.decisions.submit(request.id, request.token, true).kind).toBe('accepted');
  await running;
  expect(later.mock.calls.length).toBe(0);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  expect(game.room.history.facts(Judgment.finished)[0]?.data.detail).toMatchObject({
    kind: 'unavailable',
    matched: null,
  });
  expect(game.room.world.position('slash')).toBe('discard');
  expect(game.room.world.position('red')).toBe('discard');
  conserved(game);
});
