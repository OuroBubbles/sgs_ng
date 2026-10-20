import type { ActionAnchor } from '../../core/runtime/window';
import { readState } from '../state/state';
import { activeTurn, activeTarget } from './state';

/** 身份规则：当前真实回合优先。死亡不删除席位；事实快照不冒充正在运行的回合。 */
export const turnActionAnchor: ActionAnchor = (ctx) => {
  const turn = readState(ctx.world, activeTurn, activeTarget);
  return turn && ctx.cause.scopePath.includes(turn.id) ? turn.owner : null;
};
