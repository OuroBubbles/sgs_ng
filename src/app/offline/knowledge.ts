import type { WorldReader } from '../../core/model/state';
import { roleOf } from '../../rules/game/roles';
import type { Role } from '../../rules/game/roles';
import { isGameOver } from '../../rules/game/end';

/** 身份知识的共同边界：本人、明置主公、阵亡或终局；不把主持侧身份表交给决策者。 */
export function knownRole(world: WorldReader, viewer: string | null, player: string): Role | null {
  const role = roleOf(world, player);
  return viewer === player || role === 'lord' || !world.player(player).alive || isGameOver(world)
    ? role
    : null;
}
