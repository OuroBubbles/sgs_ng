import { expect, it } from 'vitest';
import { RoleMatch } from '../../src/host/role-match';
import { standardCards } from '../../src/content/standard/cards';
import { rebuildWorld } from '../../src/core/history/rebuild';
import {
  assignRoles,
  roleRoster,
  roleSeats,
  roleOf,
  judgeRoles,
  installRoleMode,
  resultOf,
  finishGame,
  kill,
  damage,
  draw,
  activePhase,
  activeTurn,
  activeTarget,
  readState,
  defineSkill,
  on,
  runTurn,
  installRescue,
  Cards,
  Death,
} from '../../src/sdk';
import type { Role, GameResult } from '../../src/sdk';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Draw } from '../../src/rules/cards/draw';
import { Game } from '../../src/sdk';
import { PlayerEvent } from '../../src/rules/combat/life';
import { testTiming } from '../fixtures/timing';

const roles = ['lord', 'loyalist', 'rebel', 'renegade'] as const;
const cause = { kind: 'rule', seq: null, data: null } as const;
async function prepareMode(game: ReturnType<typeof cardGame>) {
  installRoleMode(game.room);
  await game.room.run('roles', (ctx) =>
    assignRoles(
      ctx,
      ['a', 'b', 'c', 'd'].map((player, i) => ({ player, role: roles[i]! })),
    ),
  );
}

it.each([
  { dead: ['a'], winners: ['c'], reason: 'role:lord-dead' },
  { dead: ['a', 'b', 'c'], winners: ['d'], reason: 'role:renegade-survives' },
  { dead: ['a', 'b', 'd'], winners: ['c'], reason: 'role:lord-dead' },
  { dead: ['b', 'c', 'd'], winners: ['a', 'b'], reason: 'role:opponents-eliminated' },
  { dead: ['c', 'd'], winners: ['a', 'b'], reason: 'role:opponents-eliminated' },
  { dead: ['b', 'c'], winners: null, reason: null },
])('身份胜负独立于客户端，死亡席位 $dead', async ({ dead, winners, reason }) => {
  const game = cardGame();
  await prepareMode(game);
  await game.room.run('seed-deaths', (ctx) => {
    ctx.commit(
      testTiming('seed-deaths'),
      dead.map((player) => ({ kind: 'vitality', player, hp: 0, alive: false })),
      null,
    );
  });
  expect(judgeRoles(game.room.world)).toEqual(winners === null ? null : { winners, reason });
});

it('击杀反贼的三张奖励在埋葬后结算；无来源或已死来源不获得奖励', async () => {
  for (const killer of ['a', null, 'b']) {
    const game = cardGame({
      hands: { a: [] },
      draw: [card('r1', 'slash'), card('r2', 'slash'), card('r3', 'slash')],
    });
    await prepareMode(game);
    if (killer === 'b')
      await game.room.run('dead-source', (ctx) => {
        ctx.commit(
          testTiming('dead-source'),
          [{ kind: 'vitality', player: 'b', hp: 0, alive: false }],
          null,
        );
      });
    await game.room.run('death', (ctx) =>
      kill(ctx, { player: 'c', killer, cause, reason: 'rule' }),
    );
    expect(game.room.world.zone('a:hand').cards).toHaveLength(killer === 'a' ? 3 : 0);
    expect(game.room.world.zone('b:hand').cards).toEqual([]);
    expect(resultOf(game.room.world)).toBeNull();
    if (killer === 'a')
      expect(game.room.history.facts(PlayerEvent.buried)[0]!.seq).toBeLessThan(
        game.room.history.facts(Draw.completed)[0]!.seq,
      );
  }
});

it('主公杀忠臣只弃置手牌和装备，正在结算的杀由独立处理区善后', async () => {
  const game = cardGame({
    hands: { a: [card('s', 'slash'), card('hand', 'jink')], b: [] },
    equipment: { a: [card('e', 'slash')] },
  });
  await prepareMode(game);
  await game.room.run('wounded', (ctx) => {
    ctx.commit(testTiming('wounded'), [{ kind: 'vitality', player: 'b', hp: 1 }], null);
  });
  await use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 's' },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  expect(game.room.world.player('b').alive).toBe(false);
  expect(game.room.world.zone('a:hand').cards).toEqual([]);
  expect(game.room.world.zone('a:equipment').cards).toEqual([]);
  expect(game.room.world.zone('discard').cards).toEqual(['hand', 'e', 's']);
  expect(resultOf(game.room.world)).toBeNull();
});

it('死亡效果可以嵌套死亡；判胜只写一次，已完成的死亡区域不遗留', async () => {
  const game = cardGame({
    hands: { a: [card('a', 'slash')], b: [], c: [card('c', 'jink')], d: [] },
  });
  await prepareMode(game);
  game.room.on(Death.committed, {
    id: 'rebel-legacy',
    owner: null,
    eligible: (_ctx, event) => event.player === 'c',
    async run(ctx) {
      await kill(ctx, { player: 'a', killer: 'c', cause, reason: 'rule' });
    },
  });
  await game.room.run('death', (ctx) =>
    kill(ctx, { player: 'c', killer: 'a', cause, reason: 'rule' }),
  );
  expect(resultOf(game.room.world)).toEqual({ winners: ['c'], reason: 'role:lord-dead' });
  expect(game.room.history.facts(Game.finished)).toHaveLength(1);
  expect(game.room.world.zone('a:hand').cards).toEqual([]);
  expect(game.room.world.zone('c:hand').cards).toEqual([]);
  expect(game.room.status).toBe('ended');
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('救援从当前回合角色起按座次，未轮到的人不先救', async () => {
  const game = cardGame({
    hands: { a: [card('a', 'peach')], b: [card('b', 'peach')], d: [card('d', 'peach')] },
  });
  installRescue(game.room, game.book);
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'd', {
      body: async (at, phase) => {
        if (phase.kind === 'prepare') {
          await damage(at, { from: null, to: 'b', amount: 4, nature: 'normal' });
          phase.turn?.end(at, 'probe finished');
        }
      },
    }),
  );
  const request = await nextRequest(game.room);
  expect(request.player).toBe('d');
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'd' });
  await running;
  expect(game.room.world.position('a')).toBe('a:hand');
  expect(game.room.world.position('b')).toBe('b:hand');
});

function match(
  options: { count?: number; fixed?: readonly Role[]; empty?: boolean; oneHp?: boolean } = {},
) {
  const count = options.count ?? 4;
  return new RoleMatch({
    id: 'role-match',
    seed: 12345,
    players: Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      maxHp: options.oneHp ? 1 : 4,
    })),
    deck: options.empty ? [] : Array.from({ length: 40 }, (_, i) => card(`s${i}`, 'slash')),
    content: {
      cards: standardCards,
    },
    ...(options.fixed ? { roles: options.fixed } : {}),
  });
}

it('准备局使用确定性随机源分配身份和牌序、从主公开局，五人以上主公加体力', async () => {
  const a = match({ count: 5 });
  const b = match({ count: 5 });
  await a.prepare();
  await b.prepare();
  expect(a.room.world.snapshot).toEqual(b.room.world.snapshot);
  expect(a.room.history.entries).toEqual(b.room.history.entries);
  const lord = roleSeats(a.room.world).find((seat) => seat.role === 'lord')!.player;
  expect(a.progress).toEqual({ stage: 'ready', turns: 0, next: lord });
  expect(a.room.world.player(lord)).toMatchObject({ hp: 5, maxHp: 5 });
  for (const player of a.room.world.snapshot.players)
    expect(a.room.world.zone(`${player.id}:hand`).cards).toHaveLength(4);
  expect(rebuildWorld(a.initial, a.room.history.facts())).toEqual(a.room.world.snapshot);
  expect(() => a.prepare()).toThrow('already');
});

it('空牌堆、无动作的多角色回合仍有强制热座暂停点，自动跳过死亡座位', async () => {
  const game = match({ fixed: roles, empty: true });
  await game.prepare();
  await game.room.run('dead-seat', (ctx) => {
    ctx.commit(
      testTiming('dead-seat'),
      [{ kind: 'vitality', player: 'p1', hp: 0, alive: false }],
      null,
    );
  });
  const running = game.play();
  for (const owner of ['p0', 'p2', 'p3', 'p0']) {
    const request = await nextRequest(game.room);
    expect(request).toMatchObject({ player: owner, kind: 'seat-ready', optional: false });
    expect(game.room.decisions.cancel(request.id, request.token).kind).toBe('rejected');
    game.room.decisions.submit(request.id, request.token, true);
  }
  const pending = await nextRequest(game.room);
  expect(pending.player).toBe('p2');
  expect(game.progress?.turns).toBe(4);
  game.room.abort('stop test');
  expect(await running).toMatchObject({ kind: 'aborted' });
  expect(game.room.decisions.pending).toEqual([]);
});

it('真实主动用牌驱动从准备到身份终局；回合/阶段状态和处理区收束后运行时才结束', async () => {
  const game = match({ count: 2, fixed: ['lord', 'rebel'], oneHp: true });
  const running = game.start();
  const ready = await nextRequest(game.room);
  game.room.decisions.submit(ready.id, ready.token, true);
  const play = await nextRequest(game.room);
  expect(play).toMatchObject({ player: 'p0', kind: 'play-action' });
  const slash = game.room.world.zone('p0:hand').cards[0]!;
  expect(
    game.room.decisions.submit(play.id, play.token, {
      choice: { kind: 'physical', card: slash },
      targets: ['p1'],
    }).kind,
  ).toBe('accepted');
  expect(await running).toEqual({
    kind: 'resolved',
    value: { winners: ['p0'], reason: 'role:opponents-eliminated' },
  });
  expect(game.room.status).toBe('ended');
  expect(game.room.decisions.pending).toEqual([]);
  expect(game.room.world.position(slash)).toBe('discard');
  expect(game.room.world.snapshot.zones.filter((zone) => zone.kind === 'processing')).toEqual([]);
  expect(readState(game.room.world, activeTurn, activeTarget)).toBeNull();
  expect(readState(game.room.world, activePhase, activeTarget)).toBeNull();
  expect(game.room.history.facts(Game.finished)[0]!.seq).toBeLessThan(
    game.room.history.facts(CardEvent.finished)[0]!.seq,
  );
  expect(game.room.history.facts(Draw.completed)).toHaveLength(3); // 起手两次、摸牌阶段一次；终局无击杀奖励。
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(await game.play()).toEqual({ kind: 'resolved', value: game.result });
});

it('角色预设技能在起手前授予，可由普通代码改写摸牌', async () => {
  const setup = defineSkill({
    id: 'probe:setup',
    name: '准备',
    triggers: [
      on(Cards.drawing, {
        locked: true,
        id: 'initial-hand',
        when: (_ctx, draft, self) =>
          draft.input.player === self.owner && draft.input.reason === 'match:initial-hand',
        effect: (_ctx, draft) => draft.setCount(1, 'probe:setup'),
      }),
    ],
  });
  const game = new RoleMatch({
    id: 'preset',
    seed: 42,
    players: [{ id: 'a', skills: [setup.id] }, { id: 'b' }],
    roles: ['rebel', 'lord'],
    deck: Array.from({ length: 8 }, (_, i) => card(`p${i}`, 'slash')),
    content: {
      cards: standardCards,
      skills: [setup],
    },
  });
  await game.prepare();
  expect(roleOf(game.room.world, 'b')).toBe('lord');
  expect(game.progress?.next).toBe('b');
  expect(game.room.world.snapshot.skills).toMatchObject([{ owner: 'a', skill: setup.id }]);
  expect(game.room.world.zone('a:hand').cards).toHaveLength(1);
  expect(game.room.world.zone('b:hand').cards).toHaveLength(4);
});

it('配置与身份分配拒绝缺主公、重复座位或未知牌；结果不可被第二次覆盖', async () => {
  expect(() => roleRoster(9)).toThrow();
  expect(roleRoster(8).filter((role) => role === 'rebel')).toHaveLength(4);
  expect(() => match({ fixed: ['rebel', 'rebel', 'rebel', 'renegade'] })).toThrow('roles');
  expect(
    () =>
      new RoleMatch({
        id: 'bad',
        seed: 1,
        players: [{ id: 'a' }, { id: 'a' }],
        deck: [],
        content: {
          cards: standardCards,
        },
      }),
  ).toThrow('player IDs');
  expect(
    () =>
      new RoleMatch({
        id: 'bad',
        seed: 1,
        players: [{ id: 'a' }, { id: 'b' }],
        deck: [{ ...card('x', 'slash'), name: 'unknown' }],
        content: {
          cards: standardCards,
        },
      }),
  ).toThrow('Unknown card');
  const game = cardGame();
  await prepareMode(game);
  let first: GameResult | null = null;
  await game.room.run('finish', async (ctx) => {
    first = await finishGame(ctx, { winners: ['a'], reason: 'first' });
    expect(await finishGame(ctx, { winners: ['c'], reason: 'second' })).toEqual(first);
    expect(await draw(ctx, { player: 'a', count: 2, reason: 'after-end' })).toMatchObject({
      kind: 'unavailable',
    });
  });
  expect(game.room.history.facts(Game.finished)).toHaveLength(1);
});
