import type { Change, WorldReader, WorldSeed, WorldSnapshot } from '../model/state';
import { immutable } from '../model/value';

function unique(ids: readonly string[], kind: string): ReadonlySet<string> {
  const index = new Set(ids);
  if (ids.some((id) => !id) || index.size !== ids.length)
    throw new Error(`Invalid or duplicate ${kind}.`);
  return index;
}

function validate(state: WorldSeed): void {
  const players = unique(
    state.players.map((player) => player.id),
    'player IDs',
  );
  const cards = unique(
    state.cards.map((card) => card.id),
    'card IDs',
  );
  unique(
    state.zones.map((zone) => zone.id),
    'zone IDs',
  );
  unique(
    state.skills.map((skill) => skill.id),
    'skill instance IDs',
  );
  unique(
    state.skills.map((skill) => JSON.stringify([skill.owner, skill.skill])),
    'owner/skill pairs',
  );
  unique(
    state.states.map((entry) => entry.id),
    'state IDs',
  );
  const located = new Set<string>();

  for (const player of state.players) {
    if (
      !Number.isSafeInteger(player.hp) ||
      !Number.isSafeInteger(player.maxHp) ||
      player.maxHp < 1 ||
      player.hp > player.maxHp
    )
      throw new Error(`Invalid vitality: ${player.id}`);
  }
  for (const skill of state.skills) {
    if (!players.has(skill.owner) || !skill.skill || !skill.grants.length)
      throw new Error('Invalid skill instance.');
    unique(
      skill.grants.map((grant) => JSON.stringify([grant.source.kind, grant.source.id])),
      'skill grant sources',
    );
    if (skill.grants.some((grant) => !grant.source.id))
      throw new Error('Skill source requires an ID.');
  }
  for (const entry of state.states) {
    if (!entry.key || (entry.owner !== null && !players.has(entry.owner)))
      throw new Error('Invalid state owner or key.');
  }
  for (const card of state.cards) {
    if (!Number.isInteger(card.rank) || card.rank < 0 || card.rank > 13)
      throw new Error(`Invalid card rank: ${card.id}`);
  }
  for (const zone of state.zones) {
    if (zone.owner !== null && !players.has(zone.owner))
      throw new Error(`Unknown zone owner: ${zone.id}`);
    if (zone.kind === 'processing' && zone.scopeId === null)
      throw new Error('Processing requires a scope.');
    for (const card of zone.cards) {
      if (!cards.has(card) || located.has(card)) throw new Error(`Invalid card location: ${card}`);
      located.add(card);
    }
  }
  if (located.size !== cards.size)
    throw new Error('Every physical card must have exactly one location.');
}

/** 只在 Room 内持有；批次先准备并验证完整下一状态，再发布权威快照。 */
export class World {
  #snapshot: WorldSnapshot;
  readonly reader: WorldReader;

  constructor(seed: WorldSeed) {
    const initial = immutable({ ...seed, revision: 0 });
    validate(initial);
    this.#snapshot = initial;
    const current = () => this.#snapshot;
    let indexedCards = current().cards;
    let cardIndex = new Map(indexedCards.map((card) => [card.id, card]));
    let indexedStates = current().states;
    let stateIndex = new Map(indexedStates.map((state) => [state.id, state]));
    this.reader = Object.freeze({
      get snapshot() {
        return current();
      },
      player(id: string) {
        const player = current().players.find((item) => item.id === id);
        if (!player) throw new Error(`Unknown player: ${id}`);
        return player;
      },
      card(id: string) {
        // 按实体表身份刷新；普通提交保留牌表，同 revision 换表也不会复用旧索引。
        const cards = current().cards;
        if (cards !== indexedCards) {
          cardIndex = new Map(cards.map((card) => [card.id, card]));
          indexedCards = cards;
        }
        const card = cardIndex.get(id);
        if (!card) throw new Error(`Unknown card: ${id}`);
        return card;
      },
      state(id: string) {
        // 按表身份刷新，同 revision 换表也不会沿用旧状态。
        const states = current().states;
        if (states !== indexedStates) {
          stateIndex = new Map(states.map((state) => [state.id, state]));
          indexedStates = states;
        }
        return stateIndex.get(id);
      },
      zone(id: string) {
        const zone = current().zones.find((item) => item.id === id);
        if (!zone) throw new Error(`Unknown zone: ${id}`);
        return zone;
      },
      position(id: string) {
        const zone = current().zones.find((item) => item.cards.includes(id));
        if (!zone) throw new Error(`Unknown card: ${id}`);
        return zone.id;
      },
    });
  }

  prepare(changes: readonly Change[]): WorldSnapshot {
    // 仅记录事实仍推进 revision，复用已校验的不可变状态表。
    if (!changes.length)
      return immutable({ ...this.#snapshot, revision: this.#snapshot.revision + 1 });

    // 未变化的冻结表直接复用；一次事实或状态提交不必复制整桌区域与牌序。
    let players = this.#snapshot.players;
    let skills = this.#snapshot.skills;
    let states = this.#snapshot.states;
    let zones = this.#snapshot.zones;
    const moves = changes.filter((change) => change.kind === 'move');
    const moved = new Set<string>();
    const affected = new Set<string>();

    for (const change of changes) {
      if (change.kind !== 'createZone') continue;
      if (change.zone.cards.length || zones.some((zone) => zone.id === change.zone.id))
        throw new Error('Create a distinct empty zone.');
      zones = [...zones, { ...change.zone, cards: [] }];
    }

    // 移动的前提全部针对批次前状态；交换 A/B 的牌不会受数组更新顺序影响。
    for (const move of moves) {
      if (!zones.some((zone) => zone.id === move.to))
        throw new Error(`Unknown destination: ${move.to}`);
      for (const id of move.cards) {
        if (moved.has(id) || this.reader.position(id) !== move.from)
          throw new Error(`Invalid move: ${id}`);
        moved.add(id);
      }
      if (move.cards.length) {
        affected.add(move.from);
        affected.add(move.to);
      }
    }
    if (affected.size)
      zones = zones.map((zone) => {
        if (!affected.has(zone.id)) return zone;
        const cards = zone.cards.filter((id) => !moved.has(id));
        for (const move of moves) {
          if (move.to !== zone.id) continue;
          if (move.place === 'top') cards.unshift(...move.cards);
          else cards.push(...move.cards);
        }
        return { ...zone, cards };
      });

    for (const change of changes) {
      switch (change.kind) {
        case 'move':
          break;
        case 'vitality': {
          if (!players.some((player) => player.id === change.player))
            throw new Error('Unknown player.');
          players = players.map((player) =>
            player.id !== change.player
              ? player
              : {
                  ...player,
                  hp: change.hp,
                  maxHp: change.maxHp ?? player.maxHp,
                  alive: change.alive ?? player.alive,
                },
          );
          break;
        }
        case 'setSkill':
          skills = [...skills.filter((skill) => skill.id !== change.skill.id), change.skill];
          break;
        case 'removeSkill':
          if (!skills.some((skill) => skill.id === change.instance))
            throw new Error('Unknown skill instance.');
          skills = skills.filter((skill) => skill.id !== change.instance);
          break;
        case 'setState':
          states = [...states.filter((entry) => entry.id !== change.state.id), change.state];
          break;
        case 'removeState':
          if (!states.some((entry) => entry.id === change.state)) throw new Error('Unknown state.');
          states = states.filter((entry) => entry.id !== change.state);
          break;
        case 'createZone':
          break;
        case 'removeZone': {
          const zone = zones.find((item) => item.id === change.zone);
          if (!zone || zone.cards.length)
            throw new Error('Only an existing empty zone can be removed.');
          zones = zones.filter((item) => item !== zone);
          break;
        }
      }
    }

    const next = immutable({
      ...this.#snapshot,
      revision: this.#snapshot.revision + 1,
      players,
      zones,
      skills,
      states,
    });
    validate(next);
    return next;
  }

  apply(prepared: WorldSnapshot): void {
    this.#snapshot = prepared;
  }
}
