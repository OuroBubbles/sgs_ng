import type { DecisionRequest, ReplyResult } from '../core/decisions/hub';
import { immutable } from '../core/model/value';
import type { GameView, GameSelection, ChoicePreview } from '../protocol';
import { projectMatch } from './projection';
import { emptyPreview } from '../protocol';
import { inspectSelection, selectionInput } from './selection';
import type { RoleMatch } from './role-match';
import { AgentDriver } from './ai/driver';
import { setAiGuide } from './ai/think';
import { createRoleMatch, defaultContent, practiceContent, seatNames } from './content';
import type { ClientCommand, CommandResult, ServerMessage, SoloSetup } from '../protocol';
import { closedReply } from '../protocol';

export interface SoloSessionOptions {
  /** 固定人类席位；省略时保留内容作者的手动多席演练。 */
  readonly human?: string;
  /** 展示侧节奏，不进入规则时间或随机源。 */
  readonly aiDelayMs?: number;
}

/** 单机主持侧。私有权威状态留在这里；客户端只经协议接收投影并提交当前选择。 */
export class SoloSession {
  #viewer: string | null = null;
  #listeners = new Set<(view: GameView) => void>();
  #unsubscribe: () => void;
  #disposed = false;
  #error = '';
  #view: GameView;
  #paused = false;
  readonly #agent: AgentDriver;
  #delegated = false;
  #controlReason = '';
  readonly human: string | null;
  constructor(
    private readonly match: RoleMatch,
    options: SoloSessionOptions = {},
  ) {
    this.human = options.human ?? null;
    if (this.human && !match.initial.players.some((player) => player.id === this.human))
      throw new Error('Unknown human seat.');
    this.#agent = new AgentDriver(match, options.aiDelayMs ?? 300, (update) => {
      if (update.kind === 'unsupported' && update.player === this.human && this.#delegated) {
        this.#delegated = false;
        this.#controlReason = update.reason;
      } else if (update.kind !== 'changed') {
        this.#stop(new Error(update.reason));
      }
      this.#refresh();
    });
    this.#viewer = this.human;
    this.#view = this.#project(this.#viewer, null);
    this.#unsubscribe = match.room.history.subscribe(() => this.#refresh());
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
  start(): void {
    if (this.#disposed) throw new Error('Session closed.');
    this.match
      .start()
      .then((result) => {
        if (result.kind === 'aborted' && !this.#disposed) this.#error = result.reason;
        this.#refresh();
      })
      .catch((error: unknown) => {
        if (this.#disposed) return;
        this.#error ||= error instanceof Error ? error.message : String(error);
        this.#refresh();
      });
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#agent.update(null);
    this.#unsubscribe();
    this.#listeners.clear();
    this.match.room.abort('Solo session closed.');
  }

  /** 单人模式暂停并藏牌；手动演练则撤销本次席位查看许可。已提交的结算不回滚。 */
  hide(): void {
    if (this.human) {
      if (this.view.status !== 'running') return;
      this.#paused = true;
      this.#agent.update(null);
    }
    this.#viewer = null;
    this.#refresh();
  }
  resume(): void {
    if (!this.human || this.#disposed) return;
    this.#paused = false;
    this.#viewer = this.human;
    this.#refresh();
  }

  #request(): DecisionRequest | null {
    return this.match.room.decisions.pending[0] ?? null;
  }
  #project(viewer: string | null, request: DecisionRequest | null, focus = viewer): GameView {
    try {
      return projectMatch(this.match, viewer, request, this.#error, focus);
    } catch (error) {
      this.#stop(error);
      return projectMatch(this.match, viewer, null, this.#error, focus);
    }
  }
  #stop(error: unknown): void {
    this.#error ||= error instanceof Error ? error.message : String(error);
    this.#agent.update(null);
    try {
      this.match.room.abort(this.#error);
    } catch (cleanupError) {
      this.#error += `; ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
    }
  }
  #interact<T>(body: () => T, failed: () => T): T {
    try {
      return body();
    } catch (error) {
      this.#stop(error);
      // 预览可能从 Svelte 派生值发起，不能在同一栈内通知组件修改状态。
      queueMicrotask(() => this.#refresh());
      return failed();
    }
  }
  #refresh(): void {
    if (this.#disposed) return;
    let request: DecisionRequest | null;
    try {
      request = this.#request();
    } catch (error) {
      this.#stop(error);
      request = null;
    }
    if (this.human) {
      this.#viewer = this.#paused ? null : this.human;
      const humanRequest =
        !this.#paused &&
        !this.#delegated &&
        request?.player === this.human &&
        request.kind !== 'seat-ready'
          ? request
          : null;
      this.#view = immutable({
        ...this.#project(this.#viewer, humanRequest, this.human),
        automated:
          !this.#error && request && (request.player !== this.human || this.#delegated)
            ? request.player
            : null,
        paused: this.#paused,
        control: { delegated: this.#delegated, reason: this.#controlReason },
      });
      const automated =
        request &&
        (request.kind === 'seat-ready' || request.player !== this.human || this.#delegated);
      this.#agent.update(
        automated && !this.#paused && !this.#error && !this.match.result ? request : null,
      );
    } else {
      if (request && (request.kind === 'seat-ready' || request.player !== this.#viewer))
        this.#viewer = null;
      this.#view = this.#project(this.#viewer, request);
    }
    for (const listener of this.#listeners) listener(this.#view);
  }
  /** 控制权交接不关闭决策，也不回滚已提交的动作。 */
  setDelegated(enabled: boolean): ReplyResult {
    if (!this.human || this.#disposed || this.view.status !== 'running') return this.#closed();
    this.#delegated = enabled;
    this.#controlReason = '';
    this.#refresh();
    return { kind: 'accepted' };
  }
  confirmSeat(key: string): void {
    if (this.human) return;
    this.#interact(
      () => {
        const request = this.#request();
        if (!request || key !== `${request.id}:${request.token}` || this.#disposed) return;
        this.#viewer = request.player;
        if (request.kind === 'seat-ready')
          this.match.room.decisions.submit(request.id, request.token, true);
        this.#refresh();
      },
      () => undefined,
    );
  }
  #authorized(id: string, token: number): DecisionRequest | null {
    const request = this.#request();
    return !this.#disposed &&
      !this.#paused &&
      !this.#delegated &&
      request?.id === id &&
      request.token === token &&
      request.player === this.#viewer &&
      request.kind !== 'seat-ready'
      ? request
      : null;
  }
  inspect(
    id: string | undefined,
    token: number | undefined,
    selection: GameSelection,
  ): ChoicePreview {
    if (!id || token === undefined) return emptyPreview();
    return this.#interact(
      () => {
        const request = this.#authorized(id, token);
        return request
          ? inspectSelection(this.match, request, selection)
          : emptyPreview('请先完成席位交接');
      },
      () => emptyPreview(this.#error),
    );
  }
  reply(id: string, token: number, selection: GameSelection): ReplyResult {
    return this.#interact(
      () => {
        const request = this.#authorized(id, token);
        return request
          ? this.answer(id, token, selectionInput(request, selection))
          : this.#closed();
      },
      () => this.#closed(),
    );
  }
  /** 专用面板仍通过同一份规则校验预览；不把执行侧闭包交给组件。 */
  inspectAnswer(
    id: string,
    token: number,
    value: unknown,
  ): { readonly valid: boolean; readonly reason: string } {
    return this.#interact(
      () => {
        if (!this.#authorized(id, token))
          return { valid: false, reason: '选择已结束或当前不可操作' };
        const result = this.match.room.decisions.preview(id, value);
        return result
          ? { valid: result.valid, reason: result.reason }
          : { valid: false, reason: '选择已结束' };
      },
      () => ({ valid: false, reason: this.#error }),
    );
  }
  answer(id: string, token: number, value: unknown): ReplyResult {
    return this.#interact(
      () => {
        if (!this.#authorized(id, token)) return this.#closed();
        const result = this.match.room.decisions.submit(id, token, value);
        if (result.kind === 'accepted') this.#controlReason = '';
        this.#refresh();
        return result;
      },
      () => this.#closed(),
    );
  }
  cancel(id: string, token: number): ReplyResult {
    return this.#interact(
      () => {
        if (!this.#authorized(id, token)) return this.#closed();
        const result = this.match.room.decisions.cancel(id, token);
        if (result.kind === 'accepted') this.#controlReason = '';
        this.#refresh();
        return result;
      },
      () => this.#closed(),
    );
  }
  #closed(): ReplyResult {
    return { kind: 'rejected', reason: 'closed', message: '此席位的选择已关闭或尚未交接。' };
  }
}

/** 与联机席位同形的连接绑定；单机只有一局，round 恒为 0。 */
export interface SoloConnection {
  command(round: number, command: ClientCommand): CommandResult;
  disconnect(): void;
}

function soloMatch(setup: SoloSetup): RoleMatch {
  if (!Number.isSafeInteger(setup.seed) || setup.seed < 1 || setup.seed > 0xffffffff)
    throw new Error('牌局种子需为 1 至 4294967295 的整数');
  if (typeof setup.preset !== 'string') throw new Error('牌组无效。');
  const content = setup.practice ? practiceContent : defaultContent;
  const base = { seed: setup.seed, preset: setup.preset, content };
  if (setup.lineup) {
    const lineup = setup.lineup;
    if (!Array.isArray(lineup) || lineup.some((id) => typeof id !== 'string'))
      throw new Error('阵容无效。');
    if (lineup.length < 2 || lineup.length > seatNames.length) throw new Error('席位数无效。');
    return createRoleMatch({ ...base, lineup });
  }
  if (!Number.isInteger(setup.count) || setup.count < 2 || setup.count > seatNames.length)
    throw new Error('席位数无效。');
  return createRoleMatch({ ...base, count: setup.count });
}

/**
 * 单机连接：一条连接即一局，断开即结束。命令与联机同形；pause / confirm-seat 只在此生效。
 * 装配失败抛出，由传输层回报错误并关闭连接。
 */
export function openSolo(
  setup: SoloSetup,
  send: (message: ServerMessage) => void,
  aiDelayMs?: number,
): SoloConnection {
  let session: SoloSession;
  try {
    setAiGuide(setup.aiGuide ?? null);
    session = new SoloSession(soloMatch(setup), {
      ...(setup.lineup ? { human: seatNames[0]! } : {}),
      ...(aiDelayMs === undefined ? {} : { aiDelayMs }),
    });
  } catch (error) {
    throw new Error(`内容装配失败：${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!closed) send({ kind: 'view', lobby: null, view: session.view });
  };
  // 一次结算可能连续刷新多次；同一轮事件循环只发送最后一份投影。
  session.subscribe(() => {
    timer ??= setTimeout(flush, 0);
  });
  session.start();
  const accepted = { kind: 'accepted' } as const;
  return {
    command(_round, command) {
      const result = handle(command);
      // 命令造成的新投影先于其回执送出：客户端收到回执时已看到结果。
      if (timer !== undefined) flush();
      return result;
    },
    disconnect() {
      closed = true;
      clearTimeout(timer);
      setAiGuide(null);
      session.dispose();
    },
  };
  function handle(command: ClientCommand): CommandResult {
    if (closed) return closedReply('对局已结束。');
    switch (command.kind) {
      case 'inspect':
        return session.inspect(command.id, command.token, command.selection);
      case 'inspect-answer':
        return session.inspectAnswer(command.id, command.token, command.value);
      case 'reply':
        return session.reply(command.id, command.token, command.selection);
      case 'answer':
        return session.answer(command.id, command.token, command.value);
      case 'cancel':
        return session.cancel(command.id, command.token);
      case 'delegate':
        return session.setDelegated(command.enabled);
      case 'pause':
        if (command.enabled) session.hide();
        else session.resume();
        return accepted;
      case 'confirm-seat':
        session.confirmSeat(command.key);
        return accepted;
      case 'ready':
      case 'choose-general':
      case 'prepare':
      case 'leave':
      case 'end-round':
        return closedReply('单机对局没有房间操作。');
    }
  }
}
