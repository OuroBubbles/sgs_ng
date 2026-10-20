import type { DecisionRequest, ReplyResult } from '../../core/decisions/hub';
import { immutable } from '../../core/model/value';
import type { GameView, GameSelection, ChoicePreview } from '../../core/view/game';
import { projectMatch, record, candidates } from './projection';
import type { RoleMatch } from './role-match';
import { observeAgent } from './agent-observation';
import { decideBasic } from './basic-agent';

export interface LocalSessionOptions {
  /** 固定人类席位；省略时保留内容作者的手动多席演练。 */
  readonly human?: string;
  /** 展示侧节奏，不进入规则时间或随机源。 */
  readonly aiDelayMs?: number;
}

/** 本地主持侧。私有权威状态留在这里；组件只接收投影并提交当前选择。 */
export class LocalSession {
  #viewer: string | null = null;
  #listeners = new Set<(view: GameView) => void>();
  #unsubscribe: () => void;
  #disposed = false;
  #error = '';
  #view: GameView;
  #paused = false;
  #scheduled: { key: string; handle: ReturnType<typeof setTimeout> } | null = null;
  readonly human: string | null;
  readonly #aiDelay: number;
  constructor(
    private readonly match: RoleMatch,
    options: LocalSessionOptions = {},
  ) {
    this.human = options.human ?? null;
    if (this.human && !match.initial.players.some((player) => player.id === this.human))
      throw new Error('Unknown human seat.');
    this.#aiDelay = options.aiDelayMs ?? 300;
    if (!Number.isFinite(this.#aiDelay) || this.#aiDelay < 0) throw new Error('Invalid AI delay.');
    this.#viewer = this.human;
    this.#view = projectMatch(match, this.#viewer, null);
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
        this.#error = error instanceof Error ? error.message : String(error);
        this.#refresh();
      });
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearTimer();
    this.#unsubscribe();
    this.#listeners.clear();
    this.match.room.abort('Local session closed.');
  }

  /** 单人模式暂停并藏牌；手动演练则撤销本次席位查看许可。已提交的结算不回滚。 */
  hide(): void {
    if (this.human) {
      if (this.view.status !== 'running') return;
      this.#paused = true;
      this.#clearTimer();
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
  #refresh(): void {
    if (this.#disposed) return;
    const request = this.#request();
    if (this.human) {
      this.#viewer = this.#paused ? null : this.human;
      const humanRequest =
        !this.#paused && request?.player === this.human && request.kind !== 'seat-ready'
          ? request
          : null;
      this.#view = immutable({
        ...projectMatch(this.match, this.#viewer, humanRequest, this.#error, this.human),
        automated: request && request.player !== this.human ? request.player : null,
        paused: this.#paused,
      });
      this.#schedule(request);
    } else {
      if (request && (request.kind === 'seat-ready' || request.player !== this.#viewer))
        this.#viewer = null;
      this.#view = projectMatch(this.match, this.#viewer, request, this.#error);
    }
    for (const listener of this.#listeners) listener(this.#view);
  }
  #clearTimer(): void {
    if (this.#scheduled) clearTimeout(this.#scheduled.handle);
    this.#scheduled = null;
  }
  #schedule(request: DecisionRequest | null): void {
    const automated = request && (request.kind === 'seat-ready' || request.player !== this.human);
    if (!automated || this.#paused || this.#error || this.match.result) {
      this.#clearTimer();
      return;
    }
    const key = `${request.id}:${request.token}`;
    if (this.#scheduled?.key === key) return;
    this.#clearTimer();
    this.#scheduled = {
      key,
      handle: setTimeout(() => {
        this.#scheduled = null;
        if (this.#disposed || this.#paused || this.#error) return;
        const current = this.#request();
        if (!current || `${current.id}:${current.token}` !== key) {
          this.#refresh();
          return;
        }
        try {
          const hub = this.match.room.decisions;
          const answer = decideBasic(observeAgent(this.match, current.player), current, (input) =>
            hub.preview(current.id, input),
          );
          if (answer.kind === 'unsupported') throw new Error(answer.reason);
          const result =
            answer.kind === 'cancel'
              ? hub.cancel(current.id, current.token)
              : hub.submit(current.id, current.token, answer.value);
          if (result.kind === 'rejected' && result.reason !== 'closed' && result.reason !== 'stale')
            throw new Error(`基础 AI 提交失败：${result.message}`);
          this.#refresh();
        } catch (error) {
          this.#error = error instanceof Error ? error.message : String(error);
          this.match.room.abort(this.#error);
          this.#refresh();
        }
      }, this.#aiDelay),
    };
  }
  confirmSeat(key: string): void {
    if (this.human) return;
    const request = this.#request();
    if (!request || key !== `${request.id}:${request.token}` || this.#disposed) return;
    this.#viewer = request.player;
    if (request.kind === 'seat-ready')
      this.match.room.decisions.submit(request.id, request.token, true);
    this.#refresh();
  }
  #authorized(id: string, token: number): DecisionRequest | null {
    const request = this.#request();
    return !this.#disposed &&
      !this.#paused &&
      request?.id === id &&
      request.token === token &&
      request.player === this.#viewer &&
      request.kind !== 'seat-ready'
      ? request
      : null;
  }
  #input(request: DecisionRequest, selection: GameSelection): unknown {
    // Svelte 的草稿可能是 Proxy；跨执行边界只提交复制后的普通数组。
    const cards = [...selection.cards];
    const targets = [...selection.targets];
    if (request.kind === 'cards-targets') return { cards, targets };
    const data = record(request.data);
    const offers = Array.isArray(data.offers) ? data.offers : [];
    const raw = offers.find((item: unknown) => record(item).id === selection.offer) as unknown;
    const offer = record(raw);
    const source = record(offer.choice);
    if (offer.kind === 'active') return { skill: source.instance, action: source.action };
    const choice =
      offer.kind === 'physical'
        ? { kind: 'physical', card: source.card }
        : {
            kind: 'viewAs',
            instance: source.instance,
            recipe: source.recipe,
            materials: cards,
          };
    return request.kind === 'play-action' ? { choice, targets } : choice;
  }
  inspect(
    id: string | undefined,
    token: number | undefined,
    selection: GameSelection,
  ): ChoicePreview {
    const empty: ChoicePreview = {
      valid: false,
      reason: '请选择手牌或技能',
      cards: [],
      targets: [],
      targetCount: { min: 0, max: 0 },
      fixedTargets: [],
    };
    if (!id || token === undefined) return empty;
    const request = this.#authorized(id, token);
    if (!request) return { ...empty, reason: '请先完成席位交接' };
    if (request.kind === 'choose-option' || request.kind === 'trigger-order')
      return { ...empty, reason: '请选择上方的一项' };
    if (request.kind === 'invoke') return { ...empty, reason: '请选择是否发动技能' };
    if (request.kind === 'arrange') return { ...empty, reason: '请在排序面板中调整并确认' };
    const preview = this.match.room.decisions.preview(id, this.#input(request, selection));
    if (!preview) return { ...empty, reason: '选择已结束' };
    const feedback = record(preview.feedback);
    const data = record(request.data);
    const range = record(feedback.targetCount ?? data.targetCount);
    return immutable({
      valid: preview.valid,
      reason: preview.valid
        ? '选择完成，可以确认'
        : this.#reason(request, selection, preview.reason),
      cards: candidates(feedback.cards),
      fixedTargets: Array.isArray(feedback.fixedTargets)
        ? feedback.fixedTargets.filter((id): id is string => typeof id === 'string')
        : [],
      targets: candidates(feedback.targets),
      targetCount: {
        min: typeof range.min === 'number' ? range.min : 0,
        max: range.max === 'all' ? 'all' : typeof range.max === 'number' ? range.max : 0,
      },
    });
  }
  #reason(request: DecisionRequest, selection: GameSelection, reason: string): string {
    if (request.kind === 'cards-targets') return '按上方提示完成选择';
    if (!selection.offer) return '请选择手牌或技能';
    const map: Readonly<Record<string, string>> = {
      'Invalid target count or duplicate targets.': '请选择符合数量要求的目标',
      'Illegal target.': '此目标不符合当前牌的条件',
      'Usage limit reached.': '本阶段使用次数已达上限',
      'Card does not satisfy this response.': '此牌不能用于当前响应',
      'Selection is incomplete.': '尚未选择足够的牌或目标',
      'Invalid recipe materials.': '请按技能要求选择材料',
      'Active skill is no longer available.': '此技能当前不能发动',
    };
    return map[reason] ?? reason;
  }
  reply(id: string, token: number, selection: GameSelection): ReplyResult {
    const request = this.#authorized(id, token);
    return request ? this.answer(id, token, this.#input(request, selection)) : this.#closed();
  }
  /** 专用面板仍通过同一份规则校验预览；不把执行侧闭包交给组件。 */
  inspectAnswer(
    id: string,
    token: number,
    value: unknown,
  ): { readonly valid: boolean; readonly reason: string } {
    if (!this.#authorized(id, token)) return { valid: false, reason: '选择已结束或当前不可操作' };
    const result = this.match.room.decisions.preview(id, value);
    return result
      ? { valid: result.valid, reason: result.reason }
      : { valid: false, reason: '选择已结束' };
  }
  answer(id: string, token: number, value: unknown): ReplyResult {
    if (!this.#authorized(id, token)) return this.#closed();
    const result = this.match.room.decisions.submit(id, token, value);
    this.#refresh();
    return result;
  }
  cancel(id: string, token: number): ReplyResult {
    if (!this.#authorized(id, token)) return this.#closed();
    const result = this.match.room.decisions.cancel(id, token);
    this.#refresh();
    return result;
  }
  #closed(): ReplyResult {
    return { kind: 'rejected', reason: 'closed', message: '此席位的选择已关闭或尚未交接。' };
  }
}
