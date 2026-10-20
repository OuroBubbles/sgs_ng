import type { WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { isGameOver } from '../game/end';
import { defineState, readState, stateChange } from '../state/state';
import { phaseKinds } from './turn';
import type { PhaseKind } from './turn';

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
interface ExtraTurns {
  readonly serial: number;
  readonly pending: readonly ExtraTurn[];
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const queue = defineState<ExtraTurns>(
  'turn:extra-queue',
  { serial: 0, pending: [] },
  (value): value is ExtraTurns =>
    isRecord(value) &&
    Number.isSafeInteger(value.serial) &&
    Number(value.serial) >= 0 &&
    Array.isArray(value.pending) &&
    value.pending.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        item.id.length > 0 &&
        typeof item.owner === 'string' &&
        typeof item.reason === 'string' &&
        item.reason.length > 0 &&
        Array.isArray(item.phases) &&
        item.phases.every((kind: unknown) => phaseKinds.some((phase) => phase === kind)),
    ),
);
const target = Object.freeze({ owner: null, source: 'mode', lifetime: null });

/** 队列属于 World，来源技能失去、当前回合到期都不会撤销已授予的额外回合。 */
export function pendingExtraTurns(world: WorldReader): readonly ExtraTurn[] {
  return readState(world, queue, target).pending;
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
  const current = readState(ctx.world, queue, target);
  const serial = current.serial + 1;
  const turn = immutable({
    id: `${ctx.cause.flowId}:extra:${serial}`,
    owner: request.owner,
    reason: request.reason,
    phases,
  });
  const pending = position === 'next' ? [turn, ...current.pending] : [...current.pending, turn];
  ctx.commit('turn.extra-scheduled', [stateChange(ctx, queue, target, { serial, pending })], turn);
  return turn;
}

export function cancelExtraTurn(ctx: Context, id: string, reason: string): boolean {
  ctx.assertActive();
  if (!reason) throw new Error('Cancelling an extra turn requires a reason.');
  const current = readState(ctx.world, queue, target);
  const turn = current.pending.find((item) => item.id === id);
  if (!turn) return false;
  ctx.commit(
    'turn.extra-cancelled',
    [
      stateChange(ctx, queue, target, {
        serial: current.serial,
        pending: current.pending.filter((item) => item.id !== id),
      }),
    ],
    { turn, reason },
  );
  return true;
}

/** 主持侧在回合边界取出请求；消费在执行前提交，死亡请求明确记录跳过。 */
export function takeExtraTurn(ctx: Context): ExtraTurn | null {
  ctx.assertActive();
  if (isGameOver(ctx.world)) return null;
  while (true) {
    const current = readState(ctx.world, queue, target);
    const turn = current.pending[0];
    if (!turn) return null;
    const alive = ctx.world.player(turn.owner).alive;
    ctx.commit(
      alive ? 'turn.extra-taken' : 'turn.extra-skipped',
      [
        stateChange(ctx, queue, target, {
          serial: current.serial,
          pending: current.pending.slice(1),
        }),
      ],
      { turn, reason: alive ? null : 'owner-dead' },
    );
    if (alive) return turn;
  }
}
