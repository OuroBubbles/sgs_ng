import { expect, it } from 'vitest';
import { defineMark, scheduleExtraTurn } from '../../src/sdk';
import { defineSkill } from '../../src/rules/skills/skills';
import { finishGame } from '../../src/rules/game/end';
import { kill } from '../../src/rules/combat/life';
import { pay } from '../../src/rules/costs/pay';
import { playRounds, rotationOf } from '../../src/rules/turn/order';
import type { Context } from '../../src/sdk';
import { cardGame, grant } from '../fixtures/cards';

const probe = defineSkill({ id: 'probe:limits', name: '限' });
const perTurn = { per: 'turn', times: 1 } as const;
const perRound = { per: 'round', times: 2 } as const;
const roundSeen = defineMark('probe:round-seen', 0, { scope: 'round' });
const turnSeen = defineMark('probe:turn-seen', false, { scope: 'turn' });

it('轮由回合序列给出：轮标记、每回合/每轮次数随轮结束；额外回合属当前轮，首席阵亡仍按首席分轮', async () => {
  const game = cardGame({ skills: [probe] });
  const self = await grant(game, probe.id, 'b');
  const log: string[] = [];
  const spend = async (ctx: Context, limit: typeof perTurn | typeof perRound) =>
    (
      await pay(ctx, {
        skill: self,
        reason: probe.id,
        limit: { key: `probe:${limit.per}`, ...limit },
      })
    ).kind;
  await game.room.run('rounds', (ctx) =>
    playRounds(ctx, {
      seats: ['a', 'b', 'c', 'd'],
      first: 'a',
      async body(at, phase) {
        if (phase.kind !== 'prepare') return;
        const owner = phase.owner;
        const rotation = rotationOf(at.world)!;
        expect(turnSeen.of(at, owner)).toBe(false);
        turnSeen.set(at, owner, true);
        roundSeen.add(at, 'a');
        const extra = phase.turn!.origin.kind === 'extra' ? '+' : '';
        log.push(
          `${rotation.round}:${owner}${extra}#${roundSeen.of(at, 'a')} ${await spend(at, perTurn)}/${await spend(at, perTurn)} ${await spend(at, perRound)}`,
        );
        if (rotation.turns === 2) scheduleExtraTurn(at, { owner: 'b', reason: 'probe' });
        if (rotation.turns === 4)
          await kill(at, {
            player: 'a',
            killer: null,
            reason: 'rule',
            cause: { kind: 'rule', seq: null, data: null },
          });
        if (rotation.turns === 9) await finishGame(at, { winners: ['b'], reason: 'probe' });
      },
    }),
  );
  expect(() => roundSeen.of(game.room.world, 'a')).toThrow('Scoped mark needs a context');
  expect(log).toEqual([
    // 第一轮：b 的回合后插入 b 的额外回合，仍属第一轮；每轮两次在第三个回合用尽。
    '1:a#1 paid/unavailable paid',
    '1:b#2 paid/unavailable paid',
    '1:b+#3 paid/unavailable unavailable',
    '1:c#4 paid/unavailable unavailable',
    '1:d#5 paid/unavailable unavailable',
    // 首席 a 已阵亡：轮转越过 a 即开始新一轮，轮标记与每轮次数重新计。
    '2:b#1 paid/unavailable paid',
    '2:c#2 paid/unavailable paid',
    '2:d#3 paid/unavailable unavailable',
    '3:b#1 paid/unavailable paid',
  ]);
});
