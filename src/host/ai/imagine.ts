import type { DecisionRequest } from '../../core/decisions/hub';
import type { WorldSeed } from '../../core/model/state';
import type { Room } from '../../core/runtime/room';
import { withLifetime } from '../../rules/scopes/lifetime';
import { runTurn } from '../../rules/turn/turn';
import type { PhaseKind } from '../../rules/turn/turn';
import type { Seat } from './seat';

export type Reply =
  | { readonly kind: 'submit'; readonly value: unknown }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'stop' };

export interface Imagined {
  readonly room: Room;
  /** stopped：回答方叫停；finished：推演的流程走完（含终局）；failed：规则故障、拒绝或空转。 */
  readonly outcome: 'stopped' | 'finished' | 'failed';
  /** 中止副本并等它收束；读完局面后必须调用。 */
  dispose(): Promise<void>;
}

/** 推演中单个副本最多回答的决策数，防止想象里的往复循环。 */
const MAX_DECISIONS = 300;
const MAX_IDLE = 10_000;

/** 在副本里按微任务推进，把每个决策交给 reply；不依赖计时器。 */
async function drive(
  room: Room,
  running: Promise<unknown>,
  reply: (room: Room, request: DecisionRequest) => Promise<Reply>,
): Promise<Imagined['outcome']> {
  let settled = false;
  void running.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let idle = 0, answered = 0; ; ) {
    if (room.status === 'faulted') return 'failed';
    if (settled) return 'finished';
    const request = room.decisions.pending[0];
    if (!request) {
      if (++idle > MAX_IDLE) return 'failed';
      await Promise.resolve();
      continue;
    }
    idle = 0;
    if (++answered > MAX_DECISIONS) return 'failed';
    const answer = await reply(room, request);
    if (answer.kind === 'stop') return 'stopped';
    const result =
      answer.kind === 'cancel'
        ? room.decisions.cancel(request.id, request.token)
        : room.decisions.submit(request.id, request.token, answer.value);
    if (result.kind === 'rejected' && result.reason !== 'stale' && result.reason !== 'closed')
      return 'failed';
  }
}

function settle(room: Room, running: Promise<unknown>, outcome: Imagined['outcome']): Imagined {
  return {
    room,
    outcome,
    async dispose() {
      room.abort('imagined');
      await running.catch(() => undefined);
    },
  };
}

/**
 * 从想象的局面接着进行当前回合：副本沿用原局的轮/回合/当前阶段作用域状态（次数、本回合标记），
 * 从当前阶段的开头重新进入，跑完给定的阶段与回合结束。
 */
export async function resumeTurn(
  seat: Seat,
  world: WorldSeed,
  seed: number,
  phases: readonly PhaseKind[],
  reply: (room: Room, request: DecisionRequest) => Promise<Reply>,
): Promise<Imagined> {
  const turn = seat.turn!;
  const room = seat.fork(world, seed);
  const running = room.run('ai:imagine', (ctx) =>
    withLifetime(
      ctx,
      'round',
      (at) =>
        runTurn(at, turn.owner, {
          phases,
          body: seat.body,
          resume: {
            turn: turn.turn,
            phase: turn.phase && phases[0] === turn.phase.kind ? turn.phase.id : null,
          },
        }),
      turn.round,
    ),
  );
  return settle(room, running, await drive(room, running, reply));
}

/** 在想象的局面里直接运行一段规则（如一张牌的效果），回答其中的决策。 */
export async function imagineFlow(
  seat: Seat,
  world: WorldSeed,
  seed: number,
  body: Parameters<Room['run']>[1],
  reply: (room: Room, request: DecisionRequest) => Promise<Reply>,
  before?: (room: Room) => void,
): Promise<Imagined> {
  const room = seat.fork(world, seed);
  before?.(room);
  const running = room.run('ai:imagine', body);
  return settle(room, running, await drive(room, running, reply));
}
