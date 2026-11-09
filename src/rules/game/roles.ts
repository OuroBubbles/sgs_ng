import type { WorldReader, WorldSeed } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context, Room } from '../../core/runtime/room';
import { draw } from '../cards/draw';
import { moveCards } from '../cards/move';
import { defineMark } from '../state/mark';
import { finishGame, isGameOver, Game } from './end';
import type { GameResult } from './end';
import { Death } from '../combat/life-events';
import { defineEvent } from '../../core/runtime/event';
import { timing } from '../../core/runtime/event';

export const RoleEvent = defineEvent('role', {
  assigned: timing<unknown>(),
});

export type Role = 'lord' | 'loyalist' | 'rebel' | 'renegade';
export interface RoleSeat {
  readonly player: string;
  readonly role: Role;
}
const roles: readonly Role[] = ['lord', 'loyalist', 'rebel', 'renegade'];
const roleState = defineMark<readonly RoleSeat[]>('role:seats', []);

/** 采用基础身份模式的 2 至 8 人配置；版本变体另写模式，不塞进内核开关。 */
export function roleRoster(count: number): readonly Role[] {
  const rosters: Readonly<Record<number, readonly Role[]>> = {
    2: ['lord', 'rebel'],
    3: ['lord', 'rebel', 'renegade'],
    4: ['lord', 'loyalist', 'rebel', 'renegade'],
    5: ['lord', 'loyalist', 'rebel', 'rebel', 'renegade'],
    6: ['lord', 'loyalist', 'rebel', 'rebel', 'rebel', 'renegade'],
    7: ['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'renegade'],
    8: ['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'rebel', 'renegade'],
  };
  const roster = rosters[count];
  if (!roster) throw new Error('Role mode requires 2 to 8 players.');
  return immutable(roster);
}

export function roleSeats(world: WorldReader): readonly RoleSeat[] {
  return roleState.of(world);
}
export function roleOf(world: WorldReader, player: string): Role {
  const seat = roleSeats(world).find((seat) => seat.player === player);
  if (!seat) throw new Error(`Role not assigned: ${player}`);
  return seat.role;
}

/** 想象的局面（AI 推演）：把种子里的身份表换成另一种与观察者所知一致的排列，不提交事实。 */
export function withRoleSeats(world: WorldSeed, seats: readonly RoleSeat[]): WorldSeed {
  const value = immutable(seats);
  return {
    ...world,
    states: world.states.map((state) =>
      state.key === roleState.id && state.owner === null ? { ...state, value } : state,
    ),
  };
}

export function assignRoles(ctx: Context, input: readonly RoleSeat[]): void {
  const seats = immutable(input);
  const players = ctx.world.snapshot.players;
  if (
    roleSeats(ctx.world).length ||
    seats.length !== players.length ||
    new Set(seats.map((seat) => seat.player)).size !== seats.length ||
    seats.filter((seat) => seat.role === 'lord').length !== 1 ||
    seats.some((seat) => !roles.includes(seat.role))
  )
    throw new Error('Invalid or repeated role assignment.');
  for (const seat of seats) ctx.world.player(seat.player);
  ctx.commit(RoleEvent.assigned, [roleState.change(ctx, null, seats)], seats);
}

/** 获胜成员包含已死亡的同阵营角色；内奸仅在成为唯一存活者时获胜。 */
export function judgeRoles(world: WorldReader): GameResult | null {
  const seats = roleSeats(world);
  const lord = seats.find((seat) => seat.role === 'lord');
  if (!lord) return null;
  const living = seats.filter((seat) => world.player(seat.player).alive);
  if (!world.player(lord.player).alive) {
    const survivor = living.length === 1 ? living[0] : undefined;
    return immutable({
      winners:
        survivor?.role === 'renegade'
          ? [survivor.player]
          : seats.filter((seat) => seat.role === 'rebel').map((seat) => seat.player),
      reason: survivor?.role === 'renegade' ? 'role:renegade-survives' : 'role:lord-dead',
    });
  }
  if (!living.some((seat) => seat.role === 'rebel' || seat.role === 'renegade'))
    return immutable({
      winners: seats
        .filter((seat) => seat.role === 'lord' || seat.role === 'loyalist')
        .map((seat) => seat.player),
      reason: 'role:opponents-eliminated',
    });
  return null;
}

/** 本项目基线：死亡效果、埋葬完成后判胜；仍继续的对局才结算击杀奖惩。 */
export function installRoleMode(room: Room): () => void {
  const offDeath = room.on(Death.finished, {
    id: 'role:death',
    owner: null,
    group: 'mode',
    eligible: (ctx) => roleSeats(ctx.world).length > 0 && !isGameOver(ctx.world),
    async run(ctx, event) {
      const result = judgeRoles(ctx.world);
      if (result) {
        await finishGame(ctx, result);
        return;
      }
      if (event.killer === null || !ctx.world.player(event.killer).alive) return;
      const role = roleOf(ctx.world, event.player);
      if (role === 'rebel')
        await draw(ctx, { player: event.killer, count: 3, reason: 'role:rebel-reward' });
      else if (role === 'loyalist' && roleOf(ctx.world, event.killer) === 'lord') {
        await moveCards(
          ctx,
          ctx.world.snapshot.zones
            .filter(
              (zone) =>
                zone.owner === event.killer && (zone.kind === 'hand' || zone.kind === 'equipment'),
            )
            .map((zone) => ({
              cards: zone.cards,
              from: zone.id,
              to: 'discard',
              place: 'bottom' as const,
            })),
          'role:loyalist-penalty',
        );
      }
    },
  });
  const offFinish = room.on(Game.finished, {
    id: 'role:finish',
    owner: null,
    eligible: () => true,
    run: (_ctx, result) => room.finish(result.reason),
  });
  return () => {
    offDeath();
    offFinish();
  };
}
