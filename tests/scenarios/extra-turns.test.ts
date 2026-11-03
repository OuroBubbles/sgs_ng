import { expect, it, vi } from 'vitest';
import { Match, RoleMatch } from '../../src/app/offline/role-match';
import { LocalSession } from '../../src/app/offline/session';
import { standardCards } from '../../src/content/standard/cards';
import {
  activePhase,
  activeTarget,
  activeTurn,
  cancelExtraTurn,
  defineState,
  finishGame,
  kill,
  pendingExtraTurns,
  phaseKinds,
  readState,
  runTurn,
  scheduleExtraTurn,
  setState,
  takeExtraTurn,
  Turn,
} from '../../src/sdk';
import type { Context, PhaseBody, PhaseKind, TurnOrigin, TurnView } from '../../src/sdk';
import { cardGame, settled } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Game } from '../../src/sdk';

const cause = { kind: 'rule', seq: null, data: null } as const;
const stop = (ctx: Context) => finishGame(ctx, { winners: ['a'], reason: 'probe-completed' });

it('额外回合具有独立身份，next/last 明确排序并冻结输入，取出事实可重建', async () => {
  const game = cardGame();
  await game.room.run('plan', (ctx) => {
    const phases: PhaseKind[] = ['play'];
    const a = scheduleExtraTurn(ctx, { owner: 'a', reason: 'first', phases })!;
    const b = scheduleExtraTurn(ctx, { owner: 'b', reason: 'second' })!;
    const c = scheduleExtraTurn(ctx, { owner: 'a', reason: 'last', position: 'last' })!;
    phases.push('finish');
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(pendingExtraTurns(ctx.world)).toEqual([b, a, c]);
    expect(a.phases).toEqual(['play']);
    expect(b.phases).toEqual(phaseKinds);
    expect(Object.isFrozen(pendingExtraTurns(ctx.world))).toBe(true);
    expect(Object.isFrozen(a.phases)).toBe(true);
    expect(takeExtraTurn(ctx)).toEqual(b);
    expect(takeExtraTurn(ctx)).toEqual(a);
    expect(takeExtraTurn(ctx)).toEqual(c);
    expect(takeExtraTurn(ctx)).toBeNull();
    const later = scheduleExtraTurn(ctx, { owner: 'a', reason: 'later' })!;
    expect([a.id, b.id, c.id]).not.toContain(later.id);
  });
  expect(game.room.history.facts(Turn.extraTaken)).toHaveLength(3);
  settled(game);
});

it('取消只按请求身份移除一次，不误取消同角色的另一额外回合', async () => {
  const game = cardGame();
  await game.room.run('cancel', (ctx) => {
    const a = scheduleExtraTurn(ctx, { owner: 'a', reason: 'first' })!;
    const b = scheduleExtraTurn(ctx, { owner: 'a', reason: 'second' })!;
    expect(cancelExtraTurn(ctx, a.id, 'rule-cancelled')).toBe(true);
    expect(cancelExtraTurn(ctx, a.id, 'repeated')).toBe(false);
    expect(pendingExtraTurns(ctx.world)).toEqual([b]);
    expect(takeExtraTurn(ctx)).toEqual(b);
    expect(cancelExtraTurn(ctx, b.id, 'already-taken')).toBe(false);
    expect(() => cancelExtraTurn(ctx, 'unknown', '')).toThrow('reason');
  });
  expect(game.room.history.facts(Turn.extraCancelled)).toHaveLength(1);
  settled(game);
});

it('死亡请求显式跳过，空队列读取不写无意义事实', async () => {
  const game = cardGame();
  await game.room.run('death', async (ctx) => {
    const living = scheduleExtraTurn(ctx, { owner: 'b', reason: 'living' });
    scheduleExtraTurn(ctx, { owner: 'c', reason: 'dead' });
    await kill(ctx, { player: 'c', killer: null, cause, reason: 'rule' });
    expect(takeExtraTurn(ctx)).toEqual(living);
    expect(game.room.history.facts(Turn.extraSkipped)[0]?.data.detail).toMatchObject({
      turn: { owner: 'c' },
      reason: 'owner-dead',
    });
    const revision = ctx.world.snapshot.revision;
    expect(takeExtraTurn(ctx)).toBeNull();
    expect(ctx.world.snapshot.revision).toBe(revision);
    expect(scheduleExtraTurn(ctx, { owner: 'c', reason: 'cannot-revive' })).toBeNull();
  });
  settled(game);
});

it('队列写入遵守纯查询与上下文守卫，错误阶段/位置在提交前拒绝', async () => {
  const game = cardGame();
  let closed: Context | null = null;
  await game.room.run('guards', (ctx) => {
    closed = ctx;
    expect(() => ctx.query(() => scheduleExtraTurn(ctx, { owner: 'a', reason: 'pure' }))).toThrow();
    expect(() => ctx.query(() => takeExtraTurn(ctx))).toThrow();
    expect(() => ctx.query(() => cancelExtraTurn(ctx, 'unknown', 'pure'))).toThrow();
    expect(() => scheduleExtraTurn(ctx, { owner: 'a', reason: '' })).toThrow('Invalid');
    expect(() =>
      scheduleExtraTurn(ctx, { owner: 'a', reason: 'bad', phases: ['bad' as PhaseKind] }),
    ).toThrow('Invalid');
    expect(() =>
      scheduleExtraTurn(ctx, { owner: 'a', reason: 'bad', position: 'bad' as 'next' }),
    ).toThrow('Invalid');
    expect(() => scheduleExtraTurn(ctx, { owner: 'missing', reason: 'unknown' })).toThrow();
    expect(pendingExtraTurns(ctx.world)).toEqual([]);
  });
  expect(() => scheduleExtraTurn(closed!, { owner: 'a', reason: 'closed' })).toThrow();
  expect(game.room.status).toBe('ready');
});

it('终局不新增或消费额外回合，已授予但未执行的请求保留为终止现场', async () => {
  const game = cardGame();
  await game.room.run('end', async (ctx) => {
    const granted = scheduleExtraTurn(ctx, { owner: 'b', reason: 'pending' });
    await stop(ctx);
    expect(scheduleExtraTurn(ctx, { owner: 'a', reason: 'too-late' })).toBeNull();
    expect(takeExtraTurn(ctx)).toBeNull();
    expect(pendingExtraTurns(ctx.world)).toEqual([granted]);
  });
  expect(game.room.history.facts(Game.finished)).toHaveLength(1);
  settled(game);
});

it('普通回合和额外回合共用执行器，自定义阶段可重复，skipNext 只消费一次', async () => {
  const game = cardGame({ hands: { a: [] } });
  const ran: string[] = [];
  const ids: string[] = [];
  const plan: PhaseKind[] = ['play', 'draw', 'play'];
  game.room.on(Turn.started, {
    id: 'skip-once',
    owner: null,
    eligible: () => true,
    run(ctx, turn) {
      expect(turn.origin).toEqual({ kind: 'extra', id: 'explicit-extra', reason: 'probe' });
      expect(turn.phases).toEqual(plan);
      turn.skipNext(ctx, 'play', 'one-skip');
    },
  });
  const result = await game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: plan,
      origin: { kind: 'extra', id: 'explicit-extra', reason: 'probe' },
      body(at, phase) {
        ran.push(phase.kind);
        ids.push(phase.id);
        expect(readState(at.world, activeTurn, activeTarget)?.origin.kind).toBe('extra');
      },
    }),
  );
  expect(ran).toEqual(['draw', 'play']);
  expect(new Set(ids).size).toBe(2);
  expect(result).toMatchObject({
    value: {
      origin: { kind: 'extra' },
      phases: [{ exit: 'skipped' }, { exit: 'completed' }, { exit: 'completed' }],
    },
  });
  expect(readState(game.room.world, activeTurn, activeTarget)).toBeNull();
  settled(game);
});

it('嵌套回合恢复外层活动阶段与回合，内层生存期不清掉外层状态', async () => {
  const game = cardGame({ hands: { a: [] } });
  const mark = defineState('probe:mark', 0, (v): v is number => typeof v === 'number');
  let outer: TurnView | null = null;
  await game.room.run('nested', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['play'],
      async body(at, phase) {
        outer = phase.turn!;
        const target = { owner: 'a', source: 'probe', lifetime: outer.lifetime };
        setState(at, mark, target, 1);
        const before = readState(at.world, activePhase, activeTarget);
        const extra = await runTurn(at, game.book, 'b', {
          origin: { kind: 'extra', id: 'nested', reason: 'ordinary-code' },
          phases: ['finish'],
          body(inner, current) {
            setState(
              inner,
              mark,
              { owner: 'b', source: 'probe', lifetime: current.turn!.lifetime },
              2,
            );
            expect(readState(inner.world, activeTurn, activeTarget)?.owner).toBe('b');
          },
        });
        expect(extra.owner).toBe('b');
        expect(readState(at.world, activeTurn, activeTarget)).toMatchObject({
          owner: 'a',
          origin: { kind: 'normal' },
        });
        expect(readState(at.world, activePhase, activeTarget)).toEqual(before);
        expect(readState(at.world, mark, target)).toBe(1);
        expect(at.world.snapshot.states.filter((state) => state.key === mark.id)).toHaveLength(1);
      },
    }),
  );
  expect(outer!.lifetime.active).toBe(false);
  expect(game.room.world.snapshot.states.filter((state) => state.key === mark.id)).toEqual([]);
  settled(game);
});

it('重复的真实出牌阶段各自计算杀次数，第一阶段已用杀不限制第二阶段', async () => {
  const game = cardGame();
  const running = game.room.run('two-play-phases', (ctx) =>
    runTurn(ctx, game.book, 'a', { phases: ['play', 'play'] }),
  );
  const first = await nextRequest(game.room);
  expect(
    game.room.decisions.submit(first.id, first.token, {
      choice: { kind: 'physical', card: 'slash1' },
      targets: ['b'],
    }).kind,
  ).toBe('accepted');
  const stillFirst = await nextRequest(game.room);
  expect(
    game.room.decisions.submit(stillFirst.id, stillFirst.token, {
      choice: { kind: 'physical', card: 'slash2' },
      targets: ['b'],
    }).kind,
  ).toBe('rejected');
  game.room.decisions.cancel(stillFirst.id, stillFirst.token);
  const second = await nextRequest(game.room);
  expect(
    game.room.decisions.submit(second.id, second.token, {
      choice: { kind: 'physical', card: 'slash2' },
      targets: ['b'],
    }).kind,
  ).toBe('accepted');
  const end = await nextRequest(game.room);
  game.room.decisions.cancel(end.id, end.token);
  await running;
  expect(game.room.world.player('b').hp).toBe(2);
  const uses = game.room.history
    .facts(CardEvent.used)
    .map((fact) => fact.data.detail.declaration.context);
  expect(uses).toHaveLength(2);
  expect(uses[0]).not.toEqual(uses[1]);
  settled(game);
});

it('阶段计划在进入等待前复制，空回合仍有开始/结束与独立身份，非法计划拒绝', async () => {
  const game = cardGame();
  const plan: PhaseKind[] = ['prepare'];
  const origin: { kind: 'extra'; id: string; reason: string } = {
    kind: 'extra',
    id: 'extra',
    reason: 'original',
  };
  const body: PhaseBody = async (ctx, phase) => {
    const result = await ctx.ask<true>({
      player: phase.owner,
      kind: 'probe',
      prompt: 'wait',
      data: null,
      optional: false,
      validate: (input) =>
        input === true ? { ok: true, value: true } : { ok: false, reason: 'confirm' },
    });
    expect(result.kind).toBe('chosen');
  };
  const running = game.room.run('snapshot', (ctx) =>
    runTurn(ctx, game.book, 'a', { phases: plan, origin, body }),
  );
  const request = await nextRequest(game.room);
  plan.push('draw');
  origin.reason = 'changed';
  game.room.decisions.submit(request.id, request.token, true);
  expect(await running).toMatchObject({
    value: { origin: { reason: 'original' }, phases: [{ phase: { kind: 'prepare' } }] },
  });
  await game.room.run('empty', async (ctx) => {
    const result = await runTurn(ctx, game.book, 'a', { phases: [] });
    expect(result).toMatchObject({ phases: [], origin: { kind: 'normal' } });
    expect(() => runTurn(ctx, game.book, 'a', { phases: ['invalid' as PhaseKind] })).toThrow(
      'Invalid',
    );
    expect(() =>
      runTurn(ctx, game.book, 'a', { origin: { kind: 'extra', id: '', reason: 'bad' } }),
    ).toThrow('Invalid');
  });
  expect(game.room.history.facts(Turn.started)).toHaveLength(2);
  expect(game.room.history.facts(Turn.finished)).toHaveLength(2);
  settled(game);
});

function match(body: PhaseBody) {
  return new RoleMatch({
    id: 'extra-match',
    seed: 42,
    players: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
    roles: ['lord', 'loyalist', 'rebel', 'renegade'],
    deck: [],
    content: {
      cards: standardCards,
    },
    phaseBody: body,
  });
}
async function handoffs(game: RoleMatch, expected: readonly (readonly [string, boolean])[]) {
  for (const [owner, extra] of expected) {
    const request = await nextRequest(game.room);
    expect(request).toMatchObject({ player: owner, kind: 'seat-ready', data: { extra } });
    expect(game.room.decisions.submit(request.id, request.token, true).kind).toBe('accepted');
  }
}

it('额外回合链执行后回到正常下一席，自身连续回合不占用别人的普通回合', async () => {
  const seen: { owner: string; kind: TurnOrigin['kind'] }[] = [];
  const game = match(async (ctx, phase) => {
    if (phase.kind !== 'prepare') return;
    const turn = phase.turn!;
    seen.push({ owner: turn.owner, kind: turn.origin.kind });
    if (seen.length === 1) {
      scheduleExtraTurn(ctx, { owner: 'c', reason: 'first' });
      scheduleExtraTurn(ctx, { owner: 'd', reason: 'last', position: 'last' });
    } else if (seen.length === 2) scheduleExtraTurn(ctx, { owner: 'a', reason: 'nested' });
    turn.end(ctx, 'remaining phases omitted by probe');
    if (seen.length === 6) await stop(ctx);
  });
  const running = game.start();
  await handoffs(game, [
    ['a', false],
    ['c', true],
    ['a', true],
    ['d', true],
    ['b', false],
    ['c', false],
  ]);
  await running;
  expect(seen.map((turn) => turn.owner)).toEqual(['a', 'c', 'a', 'd', 'b', 'c']);
  expect(game.progress).toMatchObject({ turns: 6, next: 'd' });
  expect(pendingExtraTurns(game.room.world)).toEqual([]);
  settled(game);
});

it('开局技能可在主公前插入回合，之后仍从主公开始正常轮转', async () => {
  let count = 0;
  const game = match(async (ctx, phase) => {
    if (phase.kind !== 'prepare') return;
    phase.turn!.end(ctx, 'probe');
    if (++count === 2) await stop(ctx);
  });
  game.room.on(Match.prepared, {
    id: 'opening',
    owner: null,
    eligible: () => true,
    run: (ctx) => {
      scheduleExtraTurn(ctx, { owner: 'c', reason: 'opening' });
    },
  });
  const running = game.start();
  await handoffs(game, [
    ['c', true],
    ['a', false],
  ]);
  await running;
  expect(game.progress?.next).toBe('b');
  settled(game);
});

it('结束窗口排入额外回合，旧回合状态到期后才进入新回合', async () => {
  const marker = defineState(
    'probe:turn-marker',
    false,
    (v): v is boolean => typeof v === 'boolean',
  );
  let previous: TurnView | null = null;
  const game = match(async (ctx, phase) => {
    if (phase.kind !== 'prepare') return;
    if (previous) {
      expect(previous.lifetime.active).toBe(false);
      expect(ctx.world.snapshot.states.some((state) => state.key === marker.id)).toBe(false);
      await stop(ctx);
    } else {
      previous = phase.turn!;
      setState(ctx, marker, { owner: 'a', source: null, lifetime: previous.lifetime }, true);
    }
    phase.turn!.end(ctx, 'probe');
  });
  game.room.on(Turn.ending, {
    id: 'queue-after-turn',
    owner: null,
    eligible: (_ctx, turn) => turn.owner === 'a' && turn.origin.kind === 'normal',
    run(ctx) {
      scheduleExtraTurn(ctx, { owner: 'b', reason: 'ending' });
    },
  });
  const running = game.start();
  await handoffs(game, [
    ['a', false],
    ['b', true],
  ]);
  await running;
  const finished = game.room.history.facts(Turn.finished)[0]!;
  const starts = game.room.history.facts(Turn.started);
  expect(finished.seq).toBeLessThan(starts[1]!.seq);
  settled(game);
});

it('队列接收者死亡则跳过，仍执行下一项存活请求', async () => {
  let count = 0;
  const game = match(async (ctx, phase) => {
    if (phase.kind !== 'prepare') return;
    if (++count === 1) {
      scheduleExtraTurn(ctx, { owner: 'b', reason: 'from-a' });
      scheduleExtraTurn(ctx, { owner: 'c', reason: 'dead-recipient' });
      await kill(ctx, { player: 'c', killer: null, cause, reason: 'rule' });
    }
    phase.turn!.end(ctx, 'probe');
    if (count === 2) await stop(ctx);
  });
  const running = game.start();
  await handoffs(game, [
    ['a', false],
    ['b', true],
  ]);
  await running;
  expect(game.room.history.facts(Turn.extraSkipped)).toHaveLength(1);
  expect(game.room.history.facts(Turn.extraTaken)[0]?.data.detail).toMatchObject({
    turn: { owner: 'b' },
  });
  settled(game);
});

it('授予来源在本回合死亡，不抹掉其他角色已获得的额外回合', async () => {
  let count = 0;
  const game = match(async (ctx, phase) => {
    if (phase.kind !== 'prepare') return;
    ++count;
    if (phase.owner === 'c') {
      scheduleExtraTurn(ctx, { owner: 'b', reason: 'from-c' });
      await kill(ctx, { player: 'c', killer: null, cause, reason: 'rule' });
    }
    phase.turn!.end(ctx, 'probe');
    if (count === 5) await stop(ctx);
  });
  const running = game.start();
  await handoffs(game, [
    ['a', false],
    ['b', false],
    ['c', false],
    ['b', true],
    ['d', false],
  ]);
  await running;
  expect(game.room.world.player('c').alive).toBe(false);
  expect(game.room.history.facts(Turn.extraTaken)).toHaveLength(1);
  settled(game);
});

it('额外回合只执行请求的阶段，期间插入的新请求先于旧队列', async () => {
  const seen: string[] = [];
  const game = match(async (ctx, phase) => {
    seen.push(`${phase.owner}:${phase.kind}`);
    if (phase.owner === 'a') {
      scheduleExtraTurn(ctx, { owner: 'b', reason: 'finish-only', phases: ['finish'] });
      scheduleExtraTurn(ctx, { owner: 'd', reason: 'waiting', phases: [], position: 'last' });
      phase.turn!.end(ctx, 'probe');
    } else if (phase.owner === 'b') {
      scheduleExtraTurn(ctx, { owner: 'c', reason: 'draw-twice', phases: ['draw', 'draw'] });
    } else if (phase.owner === 'c' && seen.at(-2) === 'c:draw') await stop(ctx);
  });
  const running = game.start();
  await handoffs(game, [
    ['a', false],
    ['b', true],
    ['c', true],
  ]);
  await running;
  expect(seen).toEqual(['a:prepare', 'b:finish', 'c:draw', 'c:draw']);
  expect(pendingExtraTurns(game.room.world).map((turn) => turn.owner)).toEqual(['d']);
  settled(game);
});

it('同一玩家的额外回合也强制热座确认，投影和日志明确标识且不暴露请求原因 ID', async () => {
  let count = 0;
  const game = match(async (ctx, phase) => {
    if (phase.kind !== 'prepare') return;
    if (++count === 1) scheduleExtraTurn(ctx, { owner: 'a', reason: 'private:implementation-id' });
    phase.turn!.end(ctx, 'probe');
    if (count === 2) await stop(ctx);
  });
  const session = new LocalSession(game);
  session.start();
  try {
    const ready = await nextRequest(game.room);
    session.confirmSeat(`${ready.id}:${ready.token}`);
    const extra = await nextRequest(game.room);
    expect(extra.id).not.toBe(ready.id);
    await vi.waitFor(() =>
      expect(session.view.handoff).toMatchObject({ name: 'a', turn: true, extra: true }),
    );
    expect(session.view.hand).toEqual([]);
    expect(JSON.stringify(session.view)).not.toContain('private:implementation-id');
    session.confirmSeat(`${extra.id}:${extra.token}`);
    await vi.waitFor(() => expect(session.view.status).toBe('ended'));
    expect(session.view.log.some((entry) => entry.text === 'a的额外回合')).toBe(true);
    settled(game);
  } finally {
    session.dispose();
  }
});
