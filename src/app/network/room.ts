import type { DecisionRequest } from '../../core/decisions/hub';
import { immutable } from '../../core/model/value';
import { projectMatch } from '../offline/projection';
import { emptyPreview } from '../../core/view/game';
import { inspectSelection, selectionInput } from '../offline/selection';
import type { RoleMatch } from '../offline/role-match';
import { AgentDriver } from '../offline/agent-driver';
import { closedReply } from './protocol';
import type { ClientCommand, CommandResult, LobbyView, ServerMessage } from './protocol';

export interface RoomPlayer {
  readonly id: string;
  readonly general: string;
  readonly human: boolean;
}

/** 房间持有普通装配数据；工厂每次返回一个全新的、尚未启动的对局。 */
export interface NetworkRoomOptions {
  readonly seed: number;
  readonly deckName: string;
  readonly players: readonly RoomPlayer[];
  readonly generals: readonly {
    readonly id: string;
    readonly name: string;
    readonly portrait?: string;
  }[];
  readonly createMatch: (players: readonly RoomPlayer[], seed: number) => RoleMatch;
}

interface Round {
  readonly match: RoleMatch;
  readonly agent: AgentDriver;
  readonly unsubscribe: () => void;
  readonly delegated: Set<string>;
  readonly reasons: Map<string, string>;
  settled: boolean;
  error: string;
}

interface Connection {
  readonly key: string;
  readonly send: ((message: ServerMessage) => void) | null;
}

/** 连接与准备草稿属于房间；World、AI 和订阅只属于当前局。 */
export class NetworkRoom {
  readonly #options: NetworkRoomOptions;
  readonly #clients = new Map<string, Connection>();
  readonly #ready = new Set<string>();
  readonly #editing = new Set<string>();
  readonly #humans: readonly string[];
  #players: readonly RoomPlayer[];
  #game: Round | null = null;
  #round = 0;
  #closed = false;
  #error = '';
  #publication: ReturnType<typeof setTimeout> | null = null;

  constructor(
    options: NetworkRoomOptions,
    private readonly aiDelayMs = 300,
  ) {
    if (
      !options.players.length ||
      new Set(options.players.map((player) => player.id)).size !== options.players.length ||
      !options.players.some((player) => player.human) ||
      options.players.some(
        (player) => !options.generals.some((general) => general.id === player.general),
      ) ||
      !Number.isSafeInteger(options.seed) ||
      options.seed < 1 ||
      options.seed > 0xffffffff
    )
      throw new Error('Invalid room setup.');
    // 创建配置属于房间；调用者可继续编辑原草稿，准备页选将只改本房间的玩家列表。
    this.#options = Object.freeze({
      seed: options.seed,
      deckName: options.deckName,
      players: immutable(options.players),
      generals: immutable(options.generals),
      // 固定函数但保留原接收者，普通 class 方法和私有字段仍可作为建局工厂。
      createMatch: options.createMatch.bind(options),
    });
    this.#players = this.#options.players;
    this.#humans = this.#players.filter((player) => player.human).map((player) => player.id);
  }

  /** 回房凭据只绑定席位；连接注册每次替换，旧命令和旧断开通知即刻失效。 */
  join(
    send: (message: ServerMessage) => void,
    resume?: string,
  ): {
    readonly seat: string;
    readonly key: string;
    readonly command: (round: number, command: ClientCommand) => CommandResult;
    readonly leave: () => void;
    readonly disconnect: () => void;
  } | null {
    if (this.#closed) return null;
    const returning = resume
      ? [...this.#clients].find(([, client]) => client.key === resume)
      : undefined;
    if (resume && !returning) return null;
    if (!returning && this.#game && !this.#game.settled) return null;
    const seat = returning?.[0] ?? this.#humans.find((id) => !this.#clients.get(id)?.send);
    if (!seat) return null;
    const client = { send, key: returning?.[1].key ?? crypto.randomUUID() };
    this.#clients.set(seat, client);
    if (!returning) {
      this.#editing.add(seat);
      this.#ready.delete(seat);
    }
    returning?.[1].send?.({ kind: 'error', code: 'replaced', message: '此席位已在另一连接恢复。' });
    this.#changed();
    return {
      seat,
      key: client.key,
      command: (round, command) => {
        if (this.#closed || this.#clients.get(seat) !== client) return closedReply('连接已关闭。');
        if (command.kind === 'leave') {
          this.#detach(seat, client, true);
          return { kind: 'accepted' };
        }
        if (round !== this.#round) return closedReply('对局已切换，请重新操作。');
        try {
          return this.#command(seat, command);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (this.#game && !this.#game.settled) this.#stop(this.#game, reason);
          else {
            this.#error = reason;
            this.#ready.clear();
            this.#changed();
          }
          return closedReply(reason);
        }
      },
      leave: () => this.#detach(seat, client, true),
      disconnect: () => this.#detach(seat, client, false),
    };
  }

  #detach(seat: string, client: Connection, leaving: boolean): void {
    if (this.#clients.get(seat) !== client) return;
    this.#ready.delete(seat);
    if (leaving) {
      this.#clients.delete(seat);
      this.#editing.delete(seat);
      if (this.#game && !this.#game.settled) this.#stop(this.#game, seat + ' 已离开，本局结束。');
    } else {
      this.#clients.set(seat, { key: client.key, send: null });
      // 不中止原请求，不更改托管选择；人类请求自然等待，已有托管继续调度。
    }
    this.#changed();
  }

  #command(seat: string, command: ClientCommand): CommandResult {
    const game = this.#game;
    if (command.kind === 'leave') return closedReply('连接已关闭。');
    if (command.kind === 'end-round') {
      if (!game || game.settled || this.#humans.every((id) => this.#clients.get(id)?.send))
        return closedReply('只有本局有人断线时才可结束。');
      this.#stop(game, seat + ' 结束本局，等待玩家重新准备。');
      return { kind: 'accepted' };
    }
    if (command.kind === 'prepare') {
      if (game && !game.settled) return closedReply('本局仍在结算。');
      this.#editing.add(seat);
      this.#ready.delete(seat);
      this.#changed();
      return { kind: 'accepted' };
    }
    if (command.kind === 'ready' || command.kind === 'choose-general') {
      if (!this.#editing.has(seat) || (game && !game.settled))
        return closedReply('当前不能修改开局配置。');
      if (command.kind === 'choose-general') {
        if (!this.#options.generals.some((general) => general.id === command.general))
          return closedReply('此武将不在当前房间内容中。');
        this.#players = immutable(
          this.#players.map((player) =>
            player.id === seat ? { ...player, general: command.general } : player,
          ),
        );
        this.#ready.delete(seat);
      } else if (command.enabled) this.#ready.add(seat);
      else this.#ready.delete(seat);
      this.#error = '';
      if (this.#humans.every((id) => this.#clients.get(id)?.send && this.#ready.has(id)))
        this.#start();
      this.#changed();
      return { kind: 'accepted' };
    }
    if (command.kind === 'delegate') {
      if (!game || game.settled || game.error || game.match.result)
        return closedReply('当前不能切换控制权。');
      if (command.enabled) game.delegated.add(seat);
      else game.delegated.delete(seat);
      game.reasons.delete(seat);
      game.agent.update(null);
      this.#changed();
      return { kind: 'accepted' };
    }
    const request =
      game && !game.settled && !game.error && !game.delegated.has(seat)
        ? (game.match.room.decisions.pending.find(
            (request) =>
              this.#round + ':' + request.id === command.id &&
              request.token === command.token &&
              request.player === seat &&
              request.kind !== 'seat-ready',
          ) ?? null)
        : null;
    if (!game || !request)
      return command.kind === 'inspect'
        ? emptyPreview('选择已结束或不属于此席位')
        : command.kind === 'inspect-answer'
          ? { valid: false, reason: '选择已结束或不属于此席位' }
          : closedReply('选择已结束或不属于此席位。');
    const hub = game.match.room.decisions;
    switch (command.kind) {
      case 'inspect':
        return inspectSelection(game.match, request, command.selection);
      case 'inspect-answer': {
        const preview = hub.preview(request.id, command.value);
        return { valid: preview?.valid ?? false, reason: preview?.reason ?? '选择已结束' };
      }
      case 'reply':
      case 'answer':
      case 'cancel': {
        const result =
          command.kind === 'cancel'
            ? hub.cancel(request.id, command.token)
            : hub.submit(
                request.id,
                command.token,
                command.kind === 'reply'
                  ? selectionInput(request, command.selection)
                  : command.value,
              );
        if (result.kind === 'accepted') game.reasons.delete(seat);
        return result;
      }
    }
  }

  #seed(round: number): number {
    // 在非零 uint32 范围内递进；同一房间种子与局号可确定性重现每局。
    return ((this.#options.seed - 1 + round - 1) % 0xffffffff) + 1;
  }

  #start(): void {
    const round = this.#round + 1;
    const match = this.#options.createMatch(this.#players, this.#seed(round));
    if (
      match === this.#game?.match ||
      match.room.status !== 'ready' ||
      match.progress !== null ||
      match.initial.players.length !== this.#players.length ||
      match.initial.players.some((player, i) => player.id !== this.#players[i]?.id)
    )
      throw new Error('Room factory must return a fresh matching game.');
    this.#release();
    const game: Round = {
      match,
      settled: false,
      error: '',
      delegated: new Set(),
      reasons: new Map(),
      agent: new AgentDriver(match, this.aiDelayMs, (update) => {
        if (this.#game?.match !== match) return;
        const current = this.#game;
        if (update.kind === 'unsupported' && current.delegated.has(update.player)) {
          current.delegated.delete(update.player);
          current.reasons.set(update.player, update.reason);
        } else if (update.kind !== 'changed') this.#stop(current, update.reason);
        this.#changed();
      }),
      unsubscribe: match.room.history.subscribe(() => {
        if (this.#game?.match === match) this.#changed();
      }),
    };
    this.#game = game;
    this.#round = round;
    this.#ready.clear();
    this.#editing.clear();
    this.#error = '';
    Promise.resolve()
      .then(() => match.start())
      .then(
        (result) => {
          if (this.#game !== game || this.#closed) return;
          if (result.kind === 'aborted') game.error ||= result.reason;
          game.settled = true;
          game.agent.update(null);
          this.#changed();
        },
        (error: unknown) => {
          if (this.#game !== game || this.#closed) return;
          this.#stop(game, error instanceof Error ? error.message : String(error));
          game.settled = true;
          this.#changed();
        },
      );
  }

  #stop(game: Round, reason: string): void {
    game.error = reason;
    game.agent.update(null);
    game.match.room.abort(reason);
    this.#changed();
  }

  #release(): void {
    const game = this.#game;
    this.#game = null;
    if (!game) return;
    game.agent.update(null);
    game.unsubscribe();
    if (!game.settled) game.match.room.abort('Network room closed.');
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#publication) clearTimeout(this.#publication);
    this.#publication = null;
    this.#release();
    this.#clients.clear();
    this.#ready.clear();
    this.#editing.clear();
  }

  #changed(): void {
    if (this.#closed || this.#publication) return;
    this.#publication = setTimeout(() => {
      this.#publication = null;
      if (this.#closed) return;
      const game = this.#game;
      const round = this.#round;
      const request: DecisionRequest | null = game?.match.room.decisions.pending[0] ?? null;
      const automated =
        request &&
        (request.kind === 'seat-ready' ||
          !this.#humans.includes(request.player) ||
          game!.delegated.has(request.player));
      const phase = !game ? 'preparing' : game.settled ? 'finished' : 'playing';
      const lineup = this.#players.map((player) => {
        const general = this.#options.generals.find((general) => general.id === player.general)!;
        return {
          id: player.id,
          generalId: player.general,
          general: general.name,
          ...(general.portrait ? { portrait: general.portrait } : {}),
        };
      });
      for (const [seat, client] of this.#clients) {
        if (!client.send) continue;
        const editing = this.#editing.has(seat);
        const lobby: LobbyView = {
          seat,
          phase,
          editing,
          lineup,
          round,
          seed: this.#seed(editing ? round + 1 : round),
          deckName: this.#options.deckName,
          generals: editing ? this.#options.generals : [],
          error: this.#error,
          waitingFor: request && !automated ? request.player : null,
          seats: this.#humans.map((id) => ({
            id,
            connected: !!this.#clients.get(id)?.send,
            ready: this.#ready.has(id),
            editing: this.#editing.has(id),
          })),
        };
        const projected =
          game && !editing
            ? projectMatch(
                game.match,
                seat,
                request?.player === seat &&
                  !game.delegated.has(seat) &&
                  request.kind !== 'seat-ready'
                  ? request
                  : null,
                game.error,
                seat,
              )
            : null;
        const view =
          projected && game
            ? immutable({
                ...projected,
                decision: projected.decision
                  ? { ...projected.decision, id: round + ':' + projected.decision.id }
                  : null,
                automated: automated ? request.player : null,
                control: {
                  delegated: game.delegated.has(seat),
                  reason: game.reasons.get(seat) ?? '',
                },
              })
            : null;
        client.send({ kind: 'view', lobby, view });
      }
      if (!this.#closed && this.#game === game)
        game?.agent.update(
          automated && !game.error && !game.settled && !game.match.result ? request : null,
        );
    }, 0);
  }
}
