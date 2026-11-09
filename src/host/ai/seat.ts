import type { Card, Player, WorldSeed } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import { Random } from '../../core/runtime/random';
import type { Room } from '../../core/runtime/room';
import { face } from '../../rules/cards/face';
import { useDeclarations } from '../../rules/cards/plan';
import { privateCardPools } from '../../rules/cards/private-pool';
import type { CardColor } from '../../rules/cards/types';
import { genderOf } from '../../rules/characters/gender';
import type { Gender } from '../../rules/characters/gender';
import { kingdomOf } from '../../rules/characters/kingdom';
import { isChained } from '../../rules/combat/chain';
import { shieldOf } from '../../rules/combat/shield';
import { roleSeats, withRoleSeats } from '../../rules/game/roles';
import type { Role } from '../../rules/game/roles';
import { openLifetime } from '../../rules/scopes/lifetime';
import { cardDef } from '../../rules/skills/skills';
import type { SkillBook } from '../../rules/skills/skills';
import { activePhase, activeTurn, Phase, Turn } from '../../rules/turn/turn';
import type { PhaseBody, PhaseKind } from '../../rules/turn/turn';
import { knownRole } from '../knowledge';
import type { RoleMatch } from '../role-match';

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
/** 一个席位此刻有权知道的局面：本人手牌与私有牌池、各席公开状态与已知身份。 */
export interface AgentObservation {
  readonly actor: string;
  readonly hand: readonly AgentCard[];
  readonly pools: readonly AgentCard[];
  readonly players: readonly AgentSeat[];
}

/** 正在进行的回合；AI 可从这里接着推演（副本沿用回合/阶段/轮的作用域状态）。 */
export interface TurnPoint {
  readonly owner: string;
  readonly turn: string;
  readonly round: string | null;
  /** 当前阶段（推演时从它的开头重新进入），回合开始/结束窗口里为 null。 */
  readonly phase: { readonly id: string; readonly kind: PhaseKind } | null;
  /** 当前阶段起（含）尚未结束的阶段。 */
  readonly phases: readonly PhaseKind[];
  /** 有牌或主动技能正在结算：此时的中途决策无法从阶段开头重现。 */
  readonly resolving: boolean;
}

/** 原局或 AI 推演副本：房间与装配它的对局（规则目录、阶段体、开副本）。 */
export interface Table {
  readonly match: RoleMatch;
  readonly room: Room;
}

/**
 * AI 的全部输入：观察（有权知道的）、对各席的立场、规则目录（只读牌/技能定义），
 * 以及“想象”——按本席所知把未知部分（他人手牌、牌堆、未知身份）重新洗配成一个完整局面，
 * 再用同一套规则开一个副本推演。AI 从不读取原局的隐藏信息。
 */
export interface Seat {
  readonly view: AgentObservation;
  /** 自己为 1；友方为正，敌方为负，未知身份按自己的阵营估计。 */
  readonly stance: (player: string) => number;
  readonly rules: SkillBook;
  readonly turn: TurnPoint | null;
  readonly body: PhaseBody;
  imagine(seed: number): WorldSeed;
  fork(world: WorldSeed, seed: number): Room;
  /** 同一对局规则下、另一房间（推演副本）里某一席位的视角：推演中各席各自作答。 */
  seatIn(room: Room, player: string): Seat;
}

const tableOf = (table: Table | RoleMatch): Table =>
  'match' in table ? table : { match: table, room: table.room };

/** 与画面投影分离：AI 只收到本人手牌/私有池、公开装备/体力和有权知道的身份。 */
export function observeAgent(source: Table | RoleMatch, actor: string): AgentObservation {
  const { room } = tableOf(source);
  return room.inspect((ctx) => {
    const world = ctx.world;
    const assigned = roleSeats(world).length > 0;
    const card = (id: string): AgentCard => {
      const value = face(ctx, id);
      const equipment = cardDef(ctx, value.name).equipment;
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
        role: assigned ? knownRole(world, actor, player.id) : null,
        handCount: world.zone(`${player.id}:hand`).cards.length,
        equipment: world.zone(`${player.id}:equipment`).cards.map(card),
      })),
    });
  });
}

/** 身份局的立场估计：只用自己的身份、明置主公与阵亡/终局公开的身份。 */
function stanceOf(view: AgentObservation): (player: string) => number {
  const self = view.players.find((player) => player.id === view.actor)!;
  const living = view.players.filter((player) => player.alive).length;
  return (id) => {
    if (id === self.id) return 1;
    const target = view.players.find((player) => player.id === id);
    if (!target?.alive) return 0;
    const role = target.role;
    switch (self.role) {
      case 'lord':
      case 'loyalist':
        return role === 'lord' || role === 'loyalist' ? 1 : -0.7;
      case 'rebel':
        return role === 'lord' ? -1.3 : role === 'rebel' ? 1 : -0.25;
      case 'renegade':
        return role === 'lord' && living > 2 ? 0.2 : -0.8;
      case null:
      default:
        return -0.5;
    }
  };
}

function turnPoint(room: Room): TurnPoint | null {
  const world = room.world;
  const active = activeTurn.of(world);
  if (!active || openLifetime(world, 'turn') !== active.id) return null;
  const started = room.history
    .facts(Turn.started)
    .filter((fact) => fact.data.detail.id === active.id)
    .at(-1);
  if (!started) return null;
  const done = room.history.facts(Phase.finished, active.id).filter((fact) => {
    const detail = fact.data.detail as { readonly phase?: { readonly owner?: string } };
    return detail.phase?.owner === active.owner;
  }).length;
  const phase = activePhase.of(world);
  const current = phase && phase.owner === active.owner ? phase : null;
  let phases = started.data.detail.phases.slice(done);
  if (current && phases[0] !== current.kind) phases = [current.kind, ...phases];
  return immutable({
    owner: active.owner,
    turn: active.id,
    round: openLifetime(world, 'round'),
    phase: current ? { id: current.id, kind: current.kind } : null,
    phases,
    resolving:
      useDeclarations(world).length > 0 || (current?.kind === 'play' && current.stage === 'acting'),
  });
}

/** 打乱 actor 看不到的部分：他人手牌与私有牌池、牌堆（各区张数不变），以及未知身份。 */
function imagine(table: Table, actor: string, seed: number): WorldSeed {
  const world = table.room.world;
  const random = new Random(seed >>> 0 || 1);
  const shuffle = <T>(values: readonly T[]): T[] => {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = random.integer(i + 1);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  };
  const snapshot = world.snapshot;
  const pooled = new Set(
    snapshot.players
      .filter((player) => player.id !== actor)
      .flatMap((player) => privateCardPools(world, player.id).map((pool) => pool.zone)),
  );
  const hidden = (zone: (typeof snapshot.zones)[number]) =>
    zone.kind === 'draw' || (zone.kind === 'hand' && zone.owner !== actor) || pooled.has(zone.id);
  // 先排序再洗：抽样只取决于本席所知（哪些牌、哪些身份未知），与它们真实的去处无关。
  const unseen = shuffle(
    snapshot.zones
      .filter(hidden)
      .flatMap((zone) => zone.cards)
      .sort(),
  );
  let next = 0;
  const zones = snapshot.zones.map((zone) =>
    hidden(zone) ? { ...zone, cards: unseen.slice(next, (next += zone.cards.length)) } : zone,
  );
  const sample: WorldSeed = {
    players: snapshot.players,
    cards: snapshot.cards,
    zones,
    skills: snapshot.skills,
    states: snapshot.states,
  };
  const seats = roleSeats(world);
  if (!seats.length) return sample;
  const unknown = seats.filter((seat) => knownRole(world, actor, seat.player) === null);
  const roles = shuffle(unknown.map((seat) => seat.role).sort());
  return withRoleSeats(
    sample,
    seats.map((seat) => {
      const index = unknown.indexOf(seat);
      return index < 0 ? seat : { ...seat, role: roles[index]! };
    }),
  );
}

export function seatOf(source: Table | RoleMatch, actor: string): Seat {
  const table = tableOf(source);
  const view = observeAgent(table, actor);
  return {
    view,
    stance: stanceOf(view),
    rules: table.match.skills,
    turn: turnPoint(table.room),
    body: table.match.body,
    imagine: (seed) => imagine(table, actor, seed),
    fork: (world, seed) => table.match.fork('imagined', seed >>> 0 || 1, world),
    seatIn: (room, player) => seatOf({ match: table.match, room }, player),
  };
}
