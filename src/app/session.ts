import type {
  ChoicePreview,
  ClientCommand,
  CommandResult,
  GameSelection,
  GameView,
  LobbyView,
  ReplyResult,
  ServerMessage,
  SoloSetup,
} from '../protocol';
import { closedReply, emptyPreview } from '../protocol';
import { protocolHash, buildMismatch, helloPayload } from '../protocol/build';
import { bindRoomAssets, decodeAsset } from './assets';

/** 地址只决定主持端位置；客户端保留自己的页面，协议仍固定为 /game。 */
function socketAddress(address: string): string {
  try {
    const input = address.trim();
    if (!input) throw new Error();
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password)
      throw new Error();
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
    url.pathname = '/game';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    throw new Error('主持端地址无效，请填写主机与端口。');
  }
}

export interface RememberedRoom {
  readonly address: string;
  readonly seat: string;
  readonly key: string;
}
const recoveryKey = 'sgs-room-return';

/** 仅保存返回地址与席位凭据；不保存手牌、World、待答值或挂起函数。 */
export function rememberedRoom(): RememberedRoom | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value: unknown = JSON.parse(localStorage.getItem(recoveryKey) ?? 'null');
    return value &&
      typeof value === 'object' &&
      'address' in value &&
      typeof value.address === 'string' &&
      'seat' in value &&
      typeof value.seat === 'string' &&
      'key' in value &&
      typeof value.key === 'string'
      ? { address: socketAddress(value.address), seat: value.seat, key: value.key }
      : null;
  } catch {
    return null;
  }
}

function remember(room: RememberedRoom): void {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(recoveryKey, JSON.stringify(room));
  } catch {
    /* 存储不可用仍可在当前窗口重连。 */
  }
}
function forget(key: string): void {
  try {
    if (rememberedRoom()?.key === key) localStorage.removeItem(recoveryKey);
  } catch {
    /* 不影响已结束的连接。 */
  }
}

/** 尚未创建规则实例的房间没有 GameView；用空展示承接大厅、连接与准备页。 */
export function waitingView(lobby: LobbyView | null = null): GameView {
  return {
    deckName: lobby?.deckName ?? '',
    revision: 0,
    status: 'idle',
    viewer: lobby?.seat ?? null,
    automated: null,
    control: null,
    paused: false,
    hand: [],
    players: [],
    decision: null,
    handoff: null,
    turn: 0,
    extraTurn: false,
    active: null,
    phase: null,
    drawCount: 0,
    discardCount: 0,
    actions: [],
    pools: [],
    log: [],
    result: null,
    error: '',
  };
}

/**
 * 客户端唯一的会话：经 /game 协议连接主持端。联机时入座房间；单机时本机主持端为这条连接
 * 开一局（solo），断开即结束。预览缓存只保存主持端结果，绝不在客户端重算规则。
 */
export class RemoteSession {
  /** 单机开局草稿；null 表示联机房间。 */
  readonly solo: SoloSetup | null;
  readonly #address: string;
  #socket: WebSocket | null = null;
  readonly #listeners = new Set<(view: GameView) => void>();
  readonly #pending = new Map<
    number,
    { readonly round: number; readonly resolve: (result: CommandResult) => void }
  >();
  readonly #previews = new Map<string, CommandResult | null>();
  #sequence = 0;
  #view = waitingView(null);
  #latest = this.#view;
  #lobby: LobbyView | null = null;
  #paused = false;
  #disposed = false;
  #state: 'connecting' | 'connected' | 'disconnected' | 'closed' = 'connecting';
  #connectionError = '';
  #key: string | null;
  #epoch = 0;
  #baselineRound = 0;
  #baselineActions = 0;
  #generation = '';
  #verified = false;
  #stopConnection = () => {};
  readonly #assets = new Map<string, string>();

  constructor(
    address: string,
    options: { readonly resume?: string; readonly solo?: SoloSetup } = {},
  ) {
    this.#address = socketAddress(address);
    this.#key = options.resume ?? null;
    this.solo = options.solo ?? null;
    this.#open();
  }
  #open(): void {
    const socket = new WebSocket(this.#address);
    this.#socket = socket;
    this.#state = 'connecting';
    this.#verified = false;
    this.#connectionError = this.#key ? '正在重连主持端…' : '';
    let firstView = true;
    let received = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - received > 25_000) this.#lose(socket, '连接长时间没有响应，可重连原席位。');
    }, 1000);
    const timeout = setTimeout(
      () => this.#lose(socket, '主持端未完成构建核对，请更新双方构建后重新加入。'),
      10_000,
    );
    const stop = () => {
      clearInterval(watchdog);
      clearTimeout(timeout);
    };
    this.#stopConnection = stop;
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      if (this.#disposed || this.#socket !== socket) return;
      const message = JSON.parse(event.data) as ServerMessage;
      received = Date.now();
      if (message.kind === 'pulse') return;
      if (message.kind === 'error') {
        if (message.code === 'resume-expired' && this.#key) forget(this.#key);
        if (message.code === 'resume-expired' || message.code === 'replaced') this.#key = null;
        this.#lose(socket, message.message, true);
      } else if (!this.#verified) {
        if (message.kind !== 'hello' || message.protocol !== protocolHash) {
          this.#lose(socket, buildMismatch, true);
          return;
        }
        try {
          this.#releaseAssets();
          for (const asset of message.assets) {
            if (this.#assets.has(asset.url)) throw new Error('重复资源');
            this.#assets.set(asset.url, URL.createObjectURL(decodeAsset(asset.type, asset.data)));
          }
        } catch {
          this.#releaseAssets();
          this.#lose(socket, '房间资源加载失败，请重新加入。');
          return;
        }
        this.#verified = true;
        socket.send(
          JSON.stringify(
            helloPayload(this.solo ? { solo: this.solo } : this.#key ? { resume: this.#key } : {}),
          ),
        );
      } else if (message.kind === 'hello') this.#lose(socket, '主持端重复发送构建核对。', true);
      else if (message.kind === 'seat') {
        this.#key = message.key;
        remember({ address: this.#address, seat: message.seat, key: message.key });
      } else if (message.kind === 'view') {
        const lobby = message.lobby;
        if (this.solo ? lobby !== null : !this.#key || !lobby) {
          this.#lose(socket, '主持端未分配席位。', true);
          return;
        }
        if (lobby) {
          if (this.#lobby && lobby.round < this.#lobby.round) return;
          if (lobby.round !== this.#lobby?.round) this.#settlePending(lobby.round);
          this.#lobby = {
            ...lobby,
            lineup: lobby.lineup.map((player) => ({
              ...player,
              ...(player.portrait
                ? { portrait: this.#assets.get(player.portrait) ?? player.portrait }
                : {}),
            })),
          };
        }
        this.#latest = message.view
          ? bindRoomAssets(message.view, this.#assets)
          : waitingView(lobby);
        if (firstView) {
          firstView = false;
          clearTimeout(timeout);
          // 单机连接即新局，无需跳过既有动画或音频；联机首帧可能是重连后的中局。
          if (lobby) {
            this.#epoch++;
            this.#baselineRound = lobby.round;
            this.#baselineActions = Math.max(
              0,
              ...this.#latest.actions.map((action) => action.seq),
            );
          }
        }
        this.#state = 'connected';
        this.#connectionError = '';
        const generation = `${lobby?.round ?? 0}:${this.#latest.revision}:${this.#latest.decision?.id}:${this.#latest.decision?.token}`;
        if (generation !== this.#generation) {
          this.#generation = generation;
          this.#previews.clear();
        }
        this.#publish();
      } else if (message.kind === 'response') {
        const pending = this.#pending.get(message.sequence);
        this.#pending.delete(message.sequence);
        if (pending)
          pending.resolve(
            pending.round === message.round ? message.result : closedReply('对局已切换。'),
          );
      }
    });
    socket.addEventListener('close', () => {
      stop();
      this.#lose(
        socket,
        this.solo
          ? '与本机主持端的连接已断开，本局结束。'
          : '与主持端的连接已断开，可重连回到原席位。',
      );
    });
    socket.addEventListener('error', () => this.#lose(socket, '无法连接主持端。'));
    this.#publish();
  }
  /** 联机席位；单机没有房间席位。 */
  get human(): string | null {
    return this.#lobby?.seat ?? null;
  }
  get online(): boolean {
    return !this.solo;
  }
  get lobby(): LobbyView | null {
    return this.#lobby;
  }
  get connected(): boolean {
    return (
      !this.#disposed && this.#state === 'connected' && this.#socket?.readyState === WebSocket.OPEN
    );
  }
  get connectionState() {
    return this.#state;
  }
  get epoch(): number {
    return this.#epoch;
  }
  get actionBaseline(): number {
    return this.#lobby && this.#lobby.round === this.#baselineRound ? this.#baselineActions : 0;
  }
  get reconnectable(): boolean {
    return !this.#disposed && this.#state === 'disconnected' && this.#key !== null;
  }
  reconnect(): void {
    if (this.reconnectable) this.#open();
  }
  get view(): GameView {
    return this.#view;
  }
  subscribe(listener: (view: GameView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  async setReady(enabled: boolean): Promise<ReplyResult> {
    return this.#reply({ kind: 'ready', enabled });
  }
  async chooseGeneral(general: string): Promise<ReplyResult> {
    return this.#reply({ kind: 'choose-general', general });
  }
  async prepare(): Promise<ReplyResult> {
    return this.#reply({ kind: 'prepare' });
  }
  async endRound(): Promise<ReplyResult> {
    return this.#reply({ kind: 'end-round' });
  }
  /** 显式离开结束活跃局；页面刷新/进程退出只断开，仍可凭原席位返回。 */
  dispose(leaving = true): void {
    if (this.#disposed) return;
    if (leaving && !this.solo) {
      if (this.connected && this.#lobby)
        this.#socket!.send(
          JSON.stringify({
            sequence: ++this.#sequence,
            round: this.#lobby.round,
            command: { kind: 'leave' },
          }),
        );
      if (this.#key) forget(this.#key);
    }
    this.#disposed = true;
    this.#stopConnection();
    this.#state = 'closed';
    this.#settlePending();
    this.#listeners.clear();
    this.#socket?.close();
    this.#socket = null;
    this.#releaseAssets();
  }
  #releaseAssets(): void {
    for (const url of this.#assets.values()) URL.revokeObjectURL(url);
    this.#assets.clear();
  }
  /** 单机交给主持端暂停 AI（手动演练则撤销席位查看）；联机只在本地藏牌，对局继续。 */
  hide(): void {
    if (this.solo) this.#send({ kind: 'pause', enabled: true });
    else {
      this.#paused = true;
      this.#publish();
    }
  }
  resume(): void {
    if (this.solo) this.#send({ kind: 'pause', enabled: false });
    else {
      this.#paused = false;
      this.#publish();
    }
  }
  /** 手动演练的热坐交接；联机席位由连接分配，主持端会拒绝。 */
  confirmSeat(key: string): void {
    if (this.solo) this.#send({ kind: 'confirm-seat', key });
  }
  #send(command: ClientCommand): void {
    this.#request(command).catch((error: unknown) => {
      if (this.#socket) this.#lose(this.#socket, String(error));
    });
  }

  inspect(
    id: string | undefined,
    token: number | undefined,
    selection: GameSelection,
  ): ChoicePreview {
    if (!id || token === undefined || this.#paused || !this.connected) return emptyPreview();
    const result = this.#preview({ kind: 'inspect', id, token, selection });
    if (result && 'kind' in result && result.kind === 'rejected')
      return emptyPreview(result.message);
    return result && 'targetCount' in result ? result : emptyPreview('正在核对选择…');
  }
  inspectAnswer(
    id: string,
    token: number,
    value: unknown,
  ): { readonly valid: boolean; readonly reason: string } {
    if (this.#paused || !this.connected) return { valid: false, reason: '当前不可操作' };
    const result = this.#preview({ kind: 'inspect-answer', id, token, value });
    if (result && 'kind' in result && result.kind === 'rejected')
      return { valid: false, reason: result.message };
    return result && 'valid' in result ? result : { valid: false, reason: '正在核对选择…' };
  }
  async reply(id: string, token: number, selection: GameSelection): Promise<ReplyResult> {
    return this.#reply({ kind: 'reply', id, token, selection });
  }
  async answer(id: string, token: number, value: unknown): Promise<ReplyResult> {
    return this.#reply({ kind: 'answer', id, token, value });
  }
  async cancel(id: string, token: number): Promise<ReplyResult> {
    return this.#reply({ kind: 'cancel', id, token });
  }
  async setDelegated(enabled: boolean): Promise<ReplyResult> {
    return this.#reply({ kind: 'delegate', enabled });
  }
  async #reply(command: ClientCommand): Promise<ReplyResult> {
    if (this.#paused && command.kind !== 'delegate') return closedReply('请先恢复显示。');
    const result = await this.#request(command);
    return 'kind' in result ? result : closedReply('主持端返回了错误的响应。');
  }
  #preview(command: ClientCommand): CommandResult | null {
    const key = JSON.stringify(command);
    if (!this.#previews.has(key)) {
      this.#previews.set(key, null);
      const generation = this.#generation;
      const socket = this.#socket;
      this.#request(command)
        .then((result) => {
          // 迟到响应不覆盖新决策或不同状态的预览。
          if (this.#disposed || socket !== this.#socket || generation !== this.#generation) return;
          this.#previews.set(key, result);
          this.#publish();
        })
        .catch((error: unknown) => {
          if (this.#socket === socket && socket) this.#lose(socket, String(error));
        });
    }
    return this.#previews.get(key) ?? null;
  }
  #request(command: ClientCommand): Promise<CommandResult> {
    if (!this.connected || (!this.#lobby && !this.solo))
      return Promise.resolve(closedReply('尚未连接或连接已关闭。'));
    const sequence = ++this.#sequence;
    const round = this.#lobby?.round ?? 0;
    return new Promise((resolve) => {
      this.#pending.set(sequence, { round, resolve });
      // Svelte 草稿可能为 Proxy；JSON 是实际传输边界。
      this.#socket!.send(JSON.stringify({ sequence, round, command }));
    });
  }
  #settlePending(round?: number): void {
    for (const [sequence, pending] of this.#pending) {
      if (round !== undefined && pending.round === round) continue;
      pending.resolve(closedReply(round === undefined ? '连接已关闭。' : '对局已切换。'));
      this.#pending.delete(sequence);
    }
    this.#previews.clear();
  }
  #lose(socket: WebSocket, message: string, terminal = false): void {
    if (this.#disposed || this.#socket !== socket) return;
    this.#stopConnection();
    this.#socket = null;
    this.#state = !terminal && this.#key ? 'disconnected' : 'closed';
    this.#connectionError = message;
    this.#settlePending();
    this.#generation = '';
    this.#publish();
    socket.close();
  }
  #publish(): void {
    this.#view =
      this.#paused || this.#connectionError
        ? {
            ...this.#latest,
            viewer: null,
            hand: [],
            decision: null,
            paused: this.#paused,
            pools: this.#latest.pools.filter((pool) => pool.visibility !== 'private'),
            players: this.#latest.players.map((player) => ({
              ...player,
              role: player.self ? null : player.role,
            })),
          }
        : { ...this.#latest };
    if (this.#connectionError)
      this.#view = {
        ...this.#view,
        status: 'stopped',
        error: this.#connectionError,
        control: null,
        paused: false,
      };
    for (const listener of this.#listeners) listener(this.#view);
  }
}
