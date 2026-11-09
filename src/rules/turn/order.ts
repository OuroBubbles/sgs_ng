import type { WorldReader } from '../../core/model/state';
import type { ActionAnchor } from '../../core/runtime/event';
import type { Context } from '../../core/runtime/room';
import { isGameOver } from '../game/end';
import { withLifetime } from '../scopes/lifetime';
import { defineMark } from '../state/mark';
import { takeExtraTurn } from './extra';
import type { ExtraTurn } from './extra';
import { activeTurn } from './state';
import { runTurn, Turn } from './turn';
import type { PhaseBody } from './turn';

/** 身份规则：当前真实回合优先。死亡不删除席位；事实快照不冒充正在运行的回合。 */
export const turnActionAnchor: ActionAnchor = (ctx) => {
  const turn = activeTurn.of(ctx.world);
  return turn && ctx.cause.scopePath.includes(turn.id) ? turn.owner : null;
};

/** 回合游标：下一个正常回合从哪一席找起、已进行的回合数与轮数。 */
export interface Rotation {
  readonly next: string;
  readonly turns: number;
  readonly round: number;
}
const rotation = defineMark<Rotation | null>('turn:rotation', null);
export const rotationOf = (world: WorldReader): Rotation | null => rotation.of(world);

export interface NextTurn {
  readonly owner: string;
  readonly turn: number;
  readonly round: number;
  readonly extra: ExtraTurn | null;
}
export interface RoundsOptions {
  /** 物理座次；死亡不删除席位，轮转跳过已死亡的角色。 */
  readonly seats: readonly string[];
  /** 首席（身份局为主公）：每当正常轮转回到或越过它，开始新的一轮。 */
  readonly first: string;
  /** 每个回合开始前的模式钩子（如热座交接确认）；可 ctx.abort 中止整个序列。 */
  readonly ready?: (ctx: Context, next: NextTurn) => unknown;
  readonly body?: PhaseBody;
}

/**
 * 回合序列：谁进行下一个回合只由这里决定，直到终局。
 * 每个回合结束后先执行排队的额外回合（属于当前轮），再按座次进行下一个正常回合；
 * 额外回合不移动正常轮转游标。每一轮是一个 'round' 生存期，轮标记与“每轮”次数随之到期。
 */
export async function playRounds(ctx: Context, options: RoundsOptions): Promise<void> {
  const { seats, first, ready, body } = options;
  while (!isGameOver(ctx.world)) {
    const round = (rotation.of(ctx.world)?.round ?? 0) + 1;
    await withLifetime(ctx, 'round', async (at) => {
      for (let normal = 0; !isGameOver(at.world); ) {
        const extra = takeExtraTurn(at);
        const cursor = rotation.of(at.world) ?? { next: first, turns: 0, round };
        let owner = extra?.owner ?? null;
        if (!owner) {
          const start = seats.indexOf(cursor.next);
          let crossed = false;
          for (let i = 0; i < seats.length && !owner; i++) {
            const id = seats[(start + i) % seats.length]!;
            crossed ||= id === first;
            if (at.world.player(id).alive) owner = id;
          }
          if (!owner) throw new Error('No living seat and no game result.');
          if (crossed && normal > 0) return;
          normal++;
        }
        const next: NextTurn = { owner, turn: cursor.turns + 1, round, extra };
        await ready?.(at, next);
        if (isGameOver(at.world)) return;
        const after = extra ? cursor.next : seats[(seats.indexOf(owner) + 1) % seats.length]!;
        at.commit(
          Turn.advanced,
          [rotation.change(at, null, { next: after, turns: next.turn, round })],
          next,
        );
        await runTurn(at, owner, {
          ...(body ? { body } : {}),
          ...(extra
            ? {
                origin: { kind: 'extra', id: extra.id, reason: extra.reason },
                phases: extra.phases,
              }
            : {}),
        });
      }
    });
  }
}
