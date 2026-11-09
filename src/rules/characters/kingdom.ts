import type { WorldReader } from '../../core/model/state';
import type { Context } from '../../core/runtime/room';
import { defineMark } from '../state/mark';
import { defineEvent } from '../../core/runtime/event';
import { timing } from '../../core/runtime/event';

export const Character = defineEvent('character', {
  kingdomChanged: timing<unknown>(),
  genderChanged: timing<unknown>(),
});

/** 势力允许内容自定义；null 表示尚未指定/无势力，不从武将 ID 隐式猜测。 */
const kingdom = defineMark<string | null>('character:kingdom', null);

export function kingdomOf(world: WorldReader, owner: string): string | null {
  world.player(owner);
  return kingdom.of(world, owner);
}
export function kingdomChange(ctx: Context, owner: string, value: string | null) {
  return kingdom.change(ctx, owner, value);
}
export function setKingdom(ctx: Context, owner: string, value: string | null): void {
  const before = kingdomOf(ctx.world, owner);
  ctx.commit(Character.kingdomChanged, [kingdomChange(ctx, owner, value)], {
    player: owner,
    before,
    after: value,
  });
}
