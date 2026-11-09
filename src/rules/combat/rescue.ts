import { askUse } from '../cards/use';
import type { Room } from '../../core/runtime/room';
import { isGameOver } from '../game/end';
import { Dying } from './life-events';

/** 救援时征询的牌名：濒死结算唯一认可的“救命牌”。 */
export const rescueNames: readonly string[] = Object.freeze(['standard:peach']);

/** 标准救援装配：从当前回合角色起按座次，每人可连续使用桃直到脱离濒死或放弃。 */
export function installRescue(room: Room): () => void {
  return room.on(Dying.rescue, {
    id: 'core:rescue',
    owner: null,
    group: 'rescue',
    eligible: (ctx, event) =>
      ctx.world.player(event.player).alive &&
      ctx.world.player(event.player).hp <= 0 &&
      !isGameOver(ctx.world),
    async run(ctx, event) {
      for (const actor of ctx.actionOrder(event.player)) {
        while (
          ctx.world.player(actor).alive &&
          ctx.world.player(event.player).alive &&
          ctx.world.player(event.player).hp <= 0 &&
          !isGameOver(ctx.world)
        ) {
          const answer = await askUse(ctx, {
            actor,
            names: rescueNames,
            targets: [event.player],
            timing: { kind: 'rescue', dying: event.player },
            prompt: `${event.player} 濒死，还需要 ${1 - ctx.world.player(event.player).hp} 个桃`,
          });
          if (answer.kind !== 'used') break;
        }
      }
    },
  });
}
