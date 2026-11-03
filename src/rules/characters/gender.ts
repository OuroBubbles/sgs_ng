import type { WorldReader } from '../../core/model/state';
import type { Context } from '../../core/runtime/room';
import { defineState, readState, stateChange } from '../state/state';
import { Character } from './kingdom';

export type Gender = 'male' | 'female' | 'dual' | 'none';
const gender = defineState<Gender>(
  'character:gender',
  'none',
  (value): value is Gender =>
    value === 'male' || value === 'female' || value === 'dual' || value === 'none',
);
const target = (player: string) => ({ owner: player, source: 'profile', lifetime: null });

export function genderOf(world: WorldReader, player: string): Gender {
  world.player(player);
  return readState(world, gender, target(player));
}
export function genderChange(ctx: Context, player: string, value: Gender) {
  return stateChange(ctx, gender, target(player), value);
}
export function setGender(ctx: Context, player: string, value: Gender): void {
  const before = genderOf(ctx.world, player);
  ctx.commit(Character.genderChanged, [genderChange(ctx, player, value)], {
    player,
    before,
    after: value,
  });
}
/** 无性别不构成异性，双性与任一有性别角色可构成异性；同一角色不与自身比较出异性。 */
export function differentGender(world: WorldReader, first: string, second: string): boolean {
  const a = genderOf(world, first);
  const b = genderOf(world, second);
  return (
    first !== second && a !== 'none' && b !== 'none' && (a === 'dual' || b === 'dual' || a !== b)
  );
}
