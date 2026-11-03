import type { Card, Player } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Role } from '../../rules/game/roles';
import type { RoleMatch } from './role-match';
import { knownRole } from './knowledge';
import { genderOf } from '../../rules/characters/gender';
import type { Gender } from '../../rules/characters/gender';
import { privateCardPools } from '../../rules/cards/private-pool';
import { kingdomOf } from '../../rules/characters/kingdom';
import { isChained } from '../../rules/combat/chain';
import { shieldOf } from '../../rules/combat/shield';
import type { CardColor } from '../../rules/cards/types';

export interface AgentCard extends Card {
  readonly color: CardColor;
  readonly slot: string | null;
  readonly range: number;
}
export interface AgentSeat extends Player {
  readonly chained: boolean;
  readonly shield: number;
  readonly gender: Gender;
  readonly kingdom: string | null;
  readonly role: Role | null;
  readonly handCount: number;
  readonly equipment: readonly AgentCard[];
}
export interface AgentObservation {
  readonly actor: string;
  readonly hand: readonly AgentCard[];
  readonly pools: readonly AgentCard[];
  readonly players: readonly AgentSeat[];
}

/** 与画面投影分离：AI 只收到本人手牌/私有池、公开装备/体力和有权知道的身份。 */
export function observeAgent(match: RoleMatch, actor: string): AgentObservation {
  return match.room.inspect((ctx) => {
    const world = ctx.world;
    const card = (id: string): AgentCard => {
      const value = match.book.face(ctx, id);
      const equipment = match.book.definition(value.name).equipment;
      return { ...value, slot: equipment?.slot ?? null, range: equipment?.range ?? 0 };
    };
    return immutable({
      actor,
      hand: world.zone(`${actor}:hand`).cards.map(card),
      pools: privateCardPools(world, actor).flatMap((pool) => pool.cards.map(card)),
      players: world.snapshot.players.map((player) => ({
        ...player,
        chained: isChained(world, player.id),
        shield: shieldOf(world, player.id),
        gender: genderOf(world, player.id),
        kingdom: kingdomOf(world, player.id),
        role: match.progress ? knownRole(world, actor, player.id) : null,
        handCount: world.zone(`${player.id}:hand`).cards.length,
        equipment: world.zone(`${player.id}:equipment`).cards.map(card),
      })),
    });
  });
}
