import type { Card, WorldSeed } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import { Room } from '../../core/runtime/room';
import type { Context, FlowResult } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import { CardBook } from '../../rules/cards/book';
import { draw } from '../../rules/cards/draw';
import { moveCards } from '../../rules/cards/move';
import type { CardDefinition, CardPolicy } from '../../rules/cards/types';
import { installRescue } from '../../rules/combat/rescue';
import { installCounterspells } from '../../rules/cards/counter';
import { installDelayedCards } from '../../rules/cards/delayed';
import { resultOf } from '../../rules/game/end';
import type { GameResult } from '../../rules/game/end';
import { assignRoles, installRoleMode, roleRoster, roleSeats } from '../../rules/game/roles';
import type { Role } from '../../rules/game/roles';
import { SkillBook } from '../../rules/skills/skills';
import type { SkillDefinition } from '../../rules/skills/skills';
import { defineState, readState, stateChange } from '../../rules/state/state';
import { runTurn, defaultPhaseBody } from '../../rules/turn/turn';
import type { PhaseBody } from '../../rules/turn/turn';
import { turnActionAnchor } from '../../rules/turn/order';
import type { ActionAnchor } from '../../core/runtime/window';
import { takeExtraTurn } from '../../rules/turn/extra';
import { genderChange } from '../../rules/characters/gender';
import type { Gender } from '../../rules/characters/gender';
import { kingdomChange } from '../../rules/characters/kingdom';
import { GeneralBook, generalChange } from '../../rules/characters/general';
import type { GeneralDefinition } from '../../rules/characters/general';
import type { PackageVersion, ResolvedContent } from '../../content/package';

export interface MatchPlayer {
  readonly id: string;
  readonly maxHp?: number;
  readonly skills?: readonly string[];
  readonly gender?: Gender;
  readonly kingdom?: string | null;
  readonly general?: string;
}
interface MatchOptions {
  /** 默认采用当前回合政策；只控制结算行动序，不改变物理座次和回合游标。 */
  readonly actionAnchor?: ActionAnchor;
  readonly id: string;
  readonly deckName?: string;
  readonly seed: number;
  readonly players: readonly MatchPlayer[];
  readonly deck: readonly Card[];
  /** 测试/预设局可固定身份，否则按基础配置用局内随机源洗牌。 */
  readonly roles?: readonly Role[];
  readonly policy?: Partial<CardPolicy>;
  readonly phaseBody?: PhaseBody;
}
/** 包装配与底层测试装配共用对局流程，不能同时传入两套内容目录。 */
export type RoleMatchOptions = MatchOptions &
  (
    | {
        readonly content: ResolvedContent;
        readonly cards?: never;
        readonly skills?: never;
        readonly generals?: never;
      }
    | {
        readonly content?: undefined;
        readonly cards: readonly CardDefinition[];
        readonly skills?:
          | readonly SkillDefinition[]
          | ((book: CardBook) => readonly SkillDefinition[]);
        readonly generals?: readonly GeneralDefinition[];
      }
  );
export interface MatchProgress {
  readonly stage: 'preparing' | 'ready' | 'playing';
  readonly turns: number;
  readonly next: string;
}
const matchState = defineState<MatchProgress | null>(
  'role:match',
  null,
  (value): value is MatchProgress | null =>
    value === null ||
    (typeof value === 'object' &&
      value !== null &&
      'stage' in value &&
      (value.stage === 'preparing' || value.stage === 'ready' || value.stage === 'playing') &&
      'turns' in value &&
      Number.isSafeInteger(value.turns) &&
      'next' in value &&
      typeof value.next === 'string'),
);
const matchTarget = Object.freeze({ owner: null, source: 'match', lifetime: null });
const contentVersions = defineState<readonly PackageVersion[]>(
  'content:selection',
  [],
  (value): value is readonly PackageVersion[] =>
    Array.isArray(value) &&
    value.every(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'id' in entry &&
        typeof entry.id === 'string' &&
        'version' in entry &&
        typeof entry.version === 'string',
    ),
);
export const matchPrepared = defineWindow<{ readonly first: string }>('match.prepared');

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
  readonly content: ResolvedContent | null;
  readonly deckName: string;
  readonly room: Room;
  readonly book: CardBook;
  readonly skills: SkillBook;
  readonly generals: GeneralBook;
  readonly initial: WorldSeed;
  #players: readonly MatchPlayer[];
  #roles: readonly Role[] | null;
  #body: PhaseBody;

  constructor(options: RoleMatchOptions) {
    this.deckName = options.deckName ?? '自定义牌组';
    roleRoster(options.players.length);
    this.content = options.content ?? null;
    if (options.content) {
      const books = options.content.createBooks(options.policy);
      this.skills = books.skills;
      this.book = books.book;
      this.generals = books.generals;
    } else {
      this.skills = new SkillBook();
      this.book = new CardBook(options.cards, this.skills, options.policy);
      this.skills.register(
        typeof options.skills === 'function' ? options.skills(this.book) : (options.skills ?? []),
      );
      this.generals = new GeneralBook(options.generals ?? [], this.skills);
    }
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
    for (const card of options.deck) this.book.definition(card.name);
    for (const player of this.#players)
      for (const skill of player.skills ?? []) this.skills.definition(skill);
    this.initial = immutable({
      players: this.#players.map((player) => ({
        id: player.id,
        hp: player.maxHp ?? 4,
        maxHp: player.maxHp ?? 4,
        alive: true,
      })),
      cards: options.deck,
      skills: [],
      states: [],
      zones: [
        {
          id: 'draw',
          kind: 'draw',
          owner: null,
          scopeId: null,
          cards: options.deck.map((card) => card.id),
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
    installRescue(this.room, this.book);
    installCounterspells(this.room, this.book);
    installDelayedCards(this.room);
    installRoleMode(this.room);
  }

  get progress(): MatchProgress | null {
    return readState(this.room.world, matchState, matchTarget);
  }
  get result(): GameResult | null {
    return resultOf(this.room.world);
  }

  prepare(): Promise<FlowResult<void>> {
    if (this.progress !== null) throw new Error('Match has already been prepared.');
    return this.room.run('match.prepare', async (ctx) => {
      ctx.commit(
        'match.content',
        [stateChange(ctx, contentVersions, matchTarget, this.content?.versions ?? [])],
        { packages: this.content?.versions ?? [] },
      );
      const roles = this.#roles ?? shuffled(ctx, roleRoster(this.#players.length));
      assignRoles(
        ctx,
        this.#players.map((player, i) => ({ player: player.id, role: roles[i]! })),
      );
      const lord = roleSeats(ctx.world).find((seat) => seat.role === 'lord')!.player;
      const player = ctx.world.player(lord);
      ctx.commit(
        'match.preparing',
        [
          stateChange(ctx, matchState, matchTarget, { stage: 'preparing', turns: 0, next: lord }),
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
          const granted = await this.skills.grant(ctx, {
            owner: player.id,
            skill,
            source: { kind: 'general', id: player.general ?? `preset:${player.id}` },
          });
          if (granted.kind === 'aborted') return ctx.abort(granted.reason);
        }
      }
      const seats = this.#players.map((player) => player.id);
      const index = seats.indexOf(lord);
      for (const id of [...seats.slice(index), ...seats.slice(0, index)]) {
        if (this.result) break;
        const drawn = await draw(ctx, { player: id, count: 4, reason: 'match:initial-hand' });
        if (drawn.kind === 'aborted') return ctx.abort(drawn.reason);
      }
      ctx.commit(
        'match.prepared',
        [stateChange(ctx, matchState, matchTarget, { stage: 'ready', turns: 0, next: lord })],
        { first: lord },
      );
      if (!this.result) await ctx.window(matchPrepared, { first: lord }, { subject: lord });
    });
  }

  play(): Promise<FlowResult<GameResult>> {
    if (this.result) return Promise.resolve({ kind: 'resolved', value: this.result });
    if (this.progress?.stage !== 'ready') throw new Error('Prepare the match before play.');
    return this.room.run('match.play', async (ctx) => {
      const seats = this.#players.map((player) => player.id);
      while (!this.result) {
        const progress = this.progress!;
        const extra = takeExtraTurn(ctx);
        const start = seats.indexOf(progress.next);
        const owner =
          extra?.owner ??
          [...seats.slice(start), ...seats.slice(0, start)].find(
            (id) => ctx.world.player(id).alive,
          );
        if (!owner) throw new Error('No living seat and no game result.');
        // 热座交接也是无可用动作时的暂停点；不靠计时器或无限空转推进回合。
        const ready = await ctx.ask<true>({
          player: owner,
          kind: 'seat-ready',
          prompt: `请交给 ${owner}，确认开始回合`,
          data: { turn: progress.turns + 1, extra: extra !== null },
          optional: false,
          validate: (input) =>
            input === true
              ? { ok: true, value: true }
              : { ok: false, reason: 'Confirm the active seat.' },
        });
        if (this.result) break;
        if (ready.kind !== 'chosen') return ctx.abort('Seat handoff interrupted.');
        // 额外回合只插入执行，不移动正常轮转游标。
        const next = extra ? progress.next : seats[(seats.indexOf(owner) + 1) % seats.length]!;
        ctx.commit(
          'match.turn',
          [
            stateChange(ctx, matchState, matchTarget, {
              stage: 'playing',
              turns: progress.turns + 1,
              next,
            }),
          ],
          { owner, turn: progress.turns + 1, extra },
        );
        const turn = await runTurn(ctx, this.book, owner, {
          body: this.#body,
          ...(extra
            ? {
                origin: { kind: 'extra', id: extra.id, reason: extra.reason },
                phases: extra.phases,
              }
            : {}),
        });
        if (turn.kind === 'aborted') return ctx.abort(turn.reason);
      }
      return this.result;
    });
  }

  async start(): Promise<FlowResult<GameResult>> {
    const prepared = await this.prepare();
    if (prepared.kind === 'aborted') return prepared;
    return this.play();
  }
}
