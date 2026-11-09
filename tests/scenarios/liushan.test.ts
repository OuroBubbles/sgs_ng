import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { RoleMatch } from '../../src/host/role-match';
import { standardCards } from '../fixtures/standard';
import liushan from '../../src/content/standard/generals/liushan';
import fangquan from '../../src/content/standard/skills/fangquan';
import xiangle from '../../src/content/standard/skills/xiangle';
import { finishGame, Turn } from '../../src/sdk';
import type { Card } from '../../src/core/model/state';
import type { DecisionRequest } from '../../src/core/decisions/hub';
import type { Room } from '../../src/core/runtime/room';
import { card, cardGame, grant, settled, use } from '../fixtures/cards';

/** 逐个回答待决请求直到流程结束；reply 返回 undefined 表示取消（放弃）。 */
async function drive(
  room: Room,
  running: Promise<unknown>,
  reply: (r: DecisionRequest) => unknown,
) {
  let done = false;
  const asked: DecisionRequest[] = [];
  running.then(
    () => (done = true),
    () => (done = true),
  );
  for (let step = 0; !done && step < 10_000; step++) {
    await setImmediate();
    const request = room.decisions.pending[0];
    if (!request) continue;
    asked.push(request);
    const value = reply(request);
    const result =
      value === undefined
        ? room.decisions.cancel(request.id, request.token)
        : room.decisions.submit(request.id, request.token, value);
    expect(result).toEqual({ kind: 'accepted' });
  }
  await running;
  return asked;
}

const deck: Card[] = Array.from({ length: 60 }, (_, i) => ({
  id: `c${i}`,
  name: i % 3 ? 'standard:slash' : 'standard:jink',
  suit: 'spade',
  rank: 7,
}));
/** 刘禅坐一号位；阶段体只记录，第 stopAt 个回合开始时结束本局。 */
function match(stopAt: number) {
  const turns: string[] = [];
  const phases: string[] = [];
  const game = new RoleMatch({
    id: 'liushan',
    seed: 7,
    players: [{ id: 'a', skills: liushan.skills }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    roles: ['lord', 'loyalist', 'rebel', 'renegade'],
    deck,
    content: { cards: standardCards, generals: [liushan] },
    phaseBody: async (ctx, phase) => {
      if (phase.kind === 'prepare') {
        turns.push(`${phase.owner}${phase.turn!.origin.kind === 'extra' ? '+' : ''}`);
        if (turns.length === stopAt) await finishGame(ctx, { winners: ['a'], reason: 'probe' });
      }
      if (phase.owner === 'a') phases.push(phase.kind);
    },
  });
  return { game, turns, phases };
}

it('放权：跳过出牌阶段，回合结束弃一张手牌令另一名角色获得额外回合，随后回到正常座次', async () => {
  const { game, turns, phases } = match(3);
  let picked = '';
  const asked = await drive(game.room, game.start(), (request) => {
    if (request.kind === 'seat-ready' || request.kind === 'invoke') return true;
    if (request.kind === 'cards-targets') {
      const data = request.data as { preview: { cards: { id: string }[] } };
      picked = data.preview.cards[0]!.id;
      return { cards: [picked], targets: ['c'] };
    }
    throw new Error(`unexpected ${request.kind}`);
  });
  expect(asked.map((r) => `${r.player}:${r.kind}`)).toEqual([
    'a:seat-ready',
    'a:invoke',
    'a:cards-targets',
    'c:seat-ready',
    'b:seat-ready',
  ]);
  expect(phases).toEqual(['prepare', 'judge', 'draw', 'discard', 'finish']);
  // 额外回合插在 a 与 b 之间，不占 c 的普通回合，也不开新轮。
  expect(turns).toEqual(['a', 'c+', 'b']);
  expect(game.room.world.zone('discard').cards).toContain(picked);
  expect(game.room.history.facts(Turn.extraScheduled)).toHaveLength(1);
});

it('放权：回合结束时可以不弃牌，不跳过出牌阶段则不询问', async () => {
  const declined = match(2);
  const asked = await drive(declined.game.room, declined.game.start(), (request) =>
    request.kind === 'seat-ready' || request.kind === 'invoke' ? true : undefined,
  );
  expect(asked.map((r) => r.kind)).toEqual(['seat-ready', 'invoke', 'cards-targets', 'seat-ready']);
  expect(declined.turns).toEqual(['a', 'b']);

  const kept = match(2);
  const plain = await drive(kept.game.room, kept.game.start(), (request) =>
    request.kind === 'seat-ready' ? true : request.kind === 'invoke' ? false : undefined,
  );
  expect(plain.map((r) => r.kind)).toEqual(['seat-ready', 'invoke', 'seat-ready']);
  expect(kept.phases).toContain('play');
  expect(kept.turns).toEqual(['a', 'b']);
});

async function slashAtLiushan(hand: Card[], reply: (r: DecisionRequest) => unknown) {
  const game = cardGame({
    hands: { a: [card('hit', 'slash'), ...hand], b: [] },
    skills: [xiangle],
  });
  await grant(game, xiangle.id, 'b');
  const asked = await drive(
    game.room,
    use(game, {
      actor: 'a',
      choice: { kind: 'physical', card: 'hit' },
      targets: ['b'],
      timing: { kind: 'effect' },
    }),
    reply,
  );
  settled(game);
  return { game, asked };
}

it('享乐：杀的使用者弃置一张基本牌，否则此杀对刘禅无效', async () => {
  const paid = await slashAtLiushan(
    [card('basic', 'peach', 'heart'), card('trick', 'duel')],
    (r) => {
      expect(r.player).toBe('a');
      const data = r.data as { preview: { cards: { id: string; selectable: boolean }[] } };
      expect(data.preview.cards.filter((c) => c.selectable).map((c) => c.id)).toEqual(['basic']);
      return { cards: ['basic'], targets: [] };
    },
  );
  expect(paid.asked.map((r) => r.kind)).toEqual(['cards-targets']);
  expect(paid.game.room.world.player('b').hp).toBe(3);
  expect(paid.game.room.world.zone('discard').cards).toContain('basic');

  const refused = await slashAtLiushan([card('basic', 'peach', 'heart')], () => undefined);
  expect(refused.asked).toHaveLength(1);
  expect(refused.game.room.world.player('b').hp).toBe(4);
  expect(refused.game.room.world.zone('a:hand').cards).toEqual(['basic']);

  // 没有基本牌可弃时不询问，直接无效。
  const empty = await slashAtLiushan([card('trick', 'duel')], () => {
    throw new Error('no basic card to discard');
  });
  expect(empty.asked).toHaveLength(0);
  expect(empty.game.room.world.player('b').hp).toBe(4);
});

it('刘禅是标准包武将，放权与享乐各是一个技能文件', () => {
  expect(liushan).toMatchObject({ id: 'standard:liushan', name: '刘禅', kingdom: '蜀', maxHp: 3 });
  expect(liushan.skills).toEqual([xiangle.id, fangquan.id]);
});
