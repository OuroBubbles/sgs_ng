import type { WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { isGameOver } from '../game/end';
import { defineMark } from '../state/mark';
import { phaseKinds, Turn } from './turn';
import type { PhaseKind } from './turn';

/**
 * 额外回合（内核回合原语，对应 FreeKill 的 gainAnExtraTurn）：请求排入整局队列，
 * 由回合序列（order.ts 的 playRounds）在当前回合结束后、正常轮转之前取出执行。
 * 来源失去技能、死亡或当前回合到期都不撤销已授予的请求；立即插入一个回合直接调用 runTurn。
 */
export interface ExtraTurn {
  readonly id: string;
  readonly owner: string;
  readonly reason: string;
  readonly phases: readonly PhaseKind[];
}
export interface ExtraTurnRequest {
  readonly owner: string;
  readonly reason: string;
  readonly phases?: readonly PhaseKind[];
  /** next 插在现有请求之前，last 排在之后；默认 next。 */
  readonly position?: 'next' | 'last';
}
const queue = defineMark('turn:extra-queue', { serial: 0, pending: [] as readonly ExtraTurn[] });
const save = (ctx: Context, serial: number, pending: readonly ExtraTurn[]) =>
  queue.change(ctx, null, { serial, pending });

export function pendingExtraTurns(world: WorldReader): readonly ExtraTurn[] {
  return queue.of(world).pending;
}

export function scheduleExtraTurn(ctx: Context, request: ExtraTurnRequest): ExtraTurn | null {
  ctx.assertActive();
  const phases = request.phases ?? phaseKinds;
  const position = request.position ?? 'next';
  if (
    !request.reason ||
    !phases.every((phase) => phaseKinds.includes(phase)) ||
    (position !== 'next' && position !== 'last')
  )
    throw new Error('Invalid extra turn request.');
  if (!ctx.world.player(request.owner).alive || isGameOver(ctx.world)) return null;
  const { serial, pending } = queue.of(ctx.world);
  const turn = immutable({
    id: `${ctx.cause.flowId}:extra:${serial + 1}`,
    owner: request.owner,
    reason: request.reason,
    phases,
  });
  const next = position === 'next' ? [turn, ...pending] : [...pending, turn];
  ctx.commit(Turn.extraScheduled, [save(ctx, serial + 1, next)], turn);
  return turn;
}

export function cancelExtraTurn(ctx: Context, id: string, reason: string): boolean {
  ctx.assertActive();
  if (!reason) throw new Error('Cancelling an extra turn requires a reason.');
  const { serial, pending } = queue.of(ctx.world);
  const turn = pending.find((item) => item.id === id);
  if (!turn) return false;
  const rest = pending.filter((item) => item.id !== id);
  ctx.commit(Turn.extraCancelled, [save(ctx, serial, rest)], { turn, reason });
  return true;
}

/** 回合序列在回合边界取出请求；消费在执行前提交，接收者已死亡的请求明确记录跳过。 */
export function takeExtraTurn(ctx: Context): ExtraTurn | null {
  ctx.assertActive();
  if (isGameOver(ctx.world)) return null;
  for (;;) {
    const { serial, pending } = queue.of(ctx.world);
    const [turn, ...rest] = pending;
    if (!turn) return null;
    const alive = ctx.world.player(turn.owner).alive;
    ctx.commit(alive ? Turn.extraTaken : Turn.extraSkipped, [save(ctx, serial, rest)], {
      turn,
      reason: alive ? null : 'owner-dead',
    });
    if (alive) return turn;
  }
}
