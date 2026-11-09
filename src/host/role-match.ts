import type { Card, WorldSeed } from '../core/model/state';
import { immutable } from '../core/model/value';
import { Room } from '../core/runtime/room';
import type { Context, FlowResult } from '../core/runtime/room';
import { draw } from '../rules/cards/draw';
import { moveCards } from '../rules/cards/move';
import { installRescue } from '../rules/combat/rescue';
import { installCounterspells } from '../rules/cards/counter';
import { installDelayedCards } from '../rules/cards/delayed';
import { isGameOver, resultOf } from '../rules/game/end';
import type { GameResult } from '../rules/game/end';
import { assignRoles, installRoleMode, roleRoster, roleSeats } from '../rules/game/roles';
import type { Role } from '../rules/game/roles';
import type { SkillBook } from '../rules/skills/skills';
import { defineMark } from '../rules/state/mark';
import { defaultPhaseBody } from '../rules/turn/turn';
import type { PhaseBody } from '../rules/turn/turn';
import { playRounds, rotationOf, turnActionAnchor } from '../rules/turn/order';
import type { ActionAnchor } from '../core/runtime/event';
import { genderChange } from '../rules/characters/gender';
import type { Gender } from '../rules/characters/gender';
import { kingdomChange } from '../rules/characters/kingdom';
import { generalChange } from '../rules/characters/general';
import type { GeneralBook } from '../rules/characters/general';
import { createContent } from '../content/catalog';
import type { ContentCatalog, ContentDefinition } from '../content/catalog';
import { defineEvent, timing } from '../core/runtime/event';

export interface MatchPlayer {
  readonly id: string;
  readonly maxHp?: number;
  readonly skills?: readonly string[];
  readonly gender?: Gender;
  readonly kingdom?: string | null;
  readonly general?: string;
}
export interface RoleMatchOptions {
  /** 默认采用当前回合政策；只控制结算行动序，不改变物理座次和回合游标。 */
  readonly actionAnchor?: ActionAnchor;
  readonly id: string;
  readonly deckName?: string;
  readonly seed: number;
  readonly players: readonly MatchPlayer[];
  /** 目录牌组 ID，或直接生成的实体牌表；建局统一固定并验证实际使用的快照。 */
  readonly deck: string | readonly Card[];
  /** 内容统一单独传入；普通定义按本局装配，预装配目录直接复用。 */
  readonly content: ContentDefinition | ContentCatalog;
  /** 测试/预设局可固定身份，否则按基础配置用局内随机源洗牌。 */
  readonly roles?: readonly Role[];
  readonly phaseBody?: PhaseBody;
}
export interface MatchProgress {
  readonly stage: 'preparing' | 'ready' | 'playing';
  readonly turns: number;
  readonly next: string;
}
/** 本局阶段与首席；回合游标（turns / next）属于规则层的回合序列。 */
const matchState = defineMark<{
  readonly stage: 'preparing' | 'ready';
  readonly first: string;
} | null>('role:match', null);
export const Match = defineEvent('match', {
  prepared: timing<{ readonly first: string }>(),
  preparing: timing<unknown>(),
});

/** Fisher–Yates 只消耗 Context 随机源；最终身份/牌序都通过事实提交。 */
function shuffled<T>(ctx: Context, values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = ctx.randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** 无渲染依赖的本地对局装配。World 持有进度；当前 Promise 只负责执行，不作为存档。 */
export class RoleMatch {
  readonly content: ContentCatalog;
  readonly deckName: string;
  readonly room: Room;
  readonly skills: SkillBook;
  readonly generals: GeneralBook;
  readonly initial: WorldSeed;
  #players: readonly MatchPlayer[];
  #roles: readonly Role[] | null;
  #body: PhaseBody;

  constructor(options: RoleMatchOptions) {
    roleRoster(options.players.length);
    this.content =
      'createBooks' in options.content ? options.content : createContent(options.content);
    const requestedDeck = options.deck;
    const deck = immutable(
      typeof requestedDeck === 'string' ? this.content.createDeck(requestedDeck) : requestedDeck,
    );
    this.deckName =
      options.deckName ??
      (typeof requestedDeck === 'string'
        ? this.content.decks.find((entry) => entry.id === requestedDeck)?.label
        : undefined) ??
      '自定义牌组';
    const books = this.content.createBooks();
    this.skills = books.skills;
    this.generals = books.generals;
    this.#players = immutable(
      options.players.map((player) => {
        if (player.general === undefined) return player;
        if (
          player.maxHp !== undefined ||
          player.gender !== undefined ||
          player.kingdom !== undefined ||
          player.skills !== undefined
        )
          throw new Error('General presets cannot override vitality, gender, kingdom or skills.');
        const general = this.generals.definition(player.general);
        return {
          ...player,
          maxHp: general.maxHp,
          gender: general.gender,
          kingdom: general.kingdom,
          skills: general.skills,
        };
      }),
    );
    this.#roles = options.roles ? immutable(options.roles) : null;
    if (
      this.#roles &&
      (this.#roles.length !== this.#players.length ||
        this.#roles.filter((role) => role === 'lord').length !== 1)
    )
      throw new Error('Invalid preset roles.');
    this.#body = options.phaseBody ?? defaultPhaseBody;
    for (const card of deck)
      if (!this.skills.cards.has(card.name))
        throw new Error(`Unknown card definition: ${card.name}`);
    for (const player of this.#players)
      for (const skill of player.skills ?? []) this.skills.definition(skill);
    this.initial = immutable({
      players: this.#players.map((player) => ({
        id: player.id,
        hp: player.maxHp ?? 4,
        maxHp: player.maxHp ?? 4,
        alive: true,
      })),
      cards: deck,
      skills: [],
      states: [],
      zones: [
        {
          id: 'draw',
          kind: 'draw',
          owner: null,
          scopeId: null,
          cards: deck.map((card) => card.id),
        },
        { id: 'discard', kind: 'discard', owner: null, scopeId: null, cards: [] },
        ...this.#players.flatMap((player) => [
          {
            id: `${player.id}:hand`,
            kind: 'hand' as const,
            owner: player.id,
            scopeId: null,
            cards: [],
          },
          {
            id: `${player.id}:equipment`,
            kind: 'equipment' as const,
            owner: player.id,
            scopeId: null,
            cards: [],
          },
          {
            id: `${player.id}:judgment`,
            kind: 'judgment' as const,
            owner: player.id,
            scopeId: null,
            cards: [],
          },
        ]),
      ],
    });
    this.room = new Room({
      id: options.id,
      seed: options.seed,
      world: this.initial,
      actionAnchor: options.actionAnchor ?? turnActionAnchor,
    });
    this.skills.attach(this.room);
    installRescue(this.room);
    installCounterspells(this.room);
    installDelayedCards(this.room);
    installRoleMode(this.room);
  }

  get progress(): MatchProgress | null {
    const match = matchState.of(this.room.world);
    const rotation = rotationOf(this.room.world);
    if (!match) return null;
    return rotation
      ? { stage: 'playing', turns: rotation.turns, next: rotation.next }
      : { stage: match.stage, turns: 0, next: match.first };
  }
  get result(): GameResult | null {
    return resultOf(this.room.world);
  }

  prepare(): Promise<FlowResult<void>> {
    if (this.progress !== null) throw new Error('Match has already been prepared.');
    return this.room.run('match.prepare', async (ctx) => {
      const roles = this.#roles ?? shuffled(ctx, roleRoster(this.#players.length));
      assignRoles(
        ctx,
        this.#players.map((player, i) => ({ player: player.id, role: roles[i]! })),
      );
      const lord = roleSeats(ctx.world).find((seat) => seat.role === 'lord')!.player;
      const player = ctx.world.player(lord);
      ctx.commit(
        Match.preparing,
        [
          matchState.change(ctx, null, { stage: 'preparing', first: lord }),
          ...this.#players.map((player) => genderChange(ctx, player.id, player.gender ?? 'none')),
          ...this.#players.map((player) => kingdomChange(ctx, player.id, player.kingdom ?? null)),
          ...this.#players.flatMap((player) =>
            player.general ? [generalChange(ctx, player.id, player.general)] : [],
          ),
          ...(this.#players.length > 4
            ? [
                {
                  kind: 'vitality' as const,
                  player: lord,
                  hp: player.hp + 1,
                  maxHp: player.maxHp + 1,
                },
              ]
            : []),
        ],
        { first: lord },
      );
      const cards = shuffled(ctx, ctx.world.zone('draw').cards);
      if (cards.length)
        await moveCards(
          ctx,
          [{ cards, from: 'draw', to: 'draw', place: 'bottom' }],
          'match:initial-shuffle',
        );
      for (const player of this.#players) {
        if (this.result) break;
        for (const skill of player.skills ?? []) {
          if (this.skills.definition(skill).lord && player.id !== lord) continue;
          await this.skills.grant(ctx, {
            owner: player.id,
            skill,
            source: { kind: 'general', id: player.general ?? `preset:${player.id}` },
          });
        }
      }
      const seats = this.#players.map((player) => player.id);
      const index = seats.indexOf(lord);
      for (const id of [...seats.slice(index), ...seats.slice(0, index)]) {
        if (this.result) break;
        await draw(ctx, { player: id, count: 4, reason: 'match:initial-hand' });
      }
      ctx.commit(Match.prepared, [matchState.change(ctx, null, { stage: 'ready', first: lord })], {
        first: lord,
      });
      if (!this.result) await ctx.window(Match.prepared, { first: lord }, { subject: lord });
    });
  }

  play(): Promise<FlowResult<GameResult>> {
    if (this.result) return Promise.resolve({ kind: 'resolved', value: this.result });
    if (this.progress?.stage !== 'ready') throw new Error('Prepare the match before play.');
    const first = this.progress.next;
    return this.room.run('match.play', async (ctx) => {
      await playRounds(ctx, {
        seats: this.#players.map((player) => player.id),
        first,
        body: this.#body,
        // 热座交接也是无可用动作时的暂停点；不靠计时器或无限空转推进回合。
        async ready(at, next) {
          const ready = await at.ask<true>({
            player: next.owner,
            kind: 'seat-ready',
            prompt: `请交给 ${next.owner}，确认开始回合`,
            data: { turn: next.turn, extra: next.extra !== null },
            optional: false,
            validate: (input) =>
              input === true
                ? { ok: true, value: true }
                : { ok: false, reason: 'Confirm the active seat.' },
          });
          if (ready.kind !== 'chosen' && !isGameOver(at.world))
            return at.abort('Seat handoff interrupted.');
        },
      });
      return this.result!;
    });
  }

  async start(): Promise<FlowResult<GameResult>> {
    const prepared = await this.prepare();
    if (prepared.kind === 'aborted') return prepared;
    return this.play();
  }
}
