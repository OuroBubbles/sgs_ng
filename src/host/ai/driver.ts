import type { DecisionRequest } from '../../core/decisions/hub';
import type { RoleMatch } from '../role-match';
import { decide } from './think';

export type AgentUpdate =
  | { readonly kind: 'changed' }
  | { readonly kind: 'unsupported'; readonly player: string; readonly reason: string }
  | { readonly kind: 'fault'; readonly reason: string };

/** 离线与联机共用的 AI 调度。控制权、暂停和结束由主持者决定；null 立即撤销待执行任务。 */
export class AgentDriver {
  #scheduled: { readonly key: string; readonly handle: ReturnType<typeof setTimeout> } | null =
    null;

  constructor(
    private readonly match: RoleMatch,
    private readonly delayMs: number,
    private readonly notify: (update: AgentUpdate) => void,
  ) {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('Invalid AI delay.');
  }

  update(request: DecisionRequest | null): void {
    const key = request ? `${request.id}:${request.token}` : null;
    if (key && this.#scheduled?.key === key) return;
    if (this.#scheduled) clearTimeout(this.#scheduled.handle);
    this.#scheduled = null;
    if (!request) return;

    const ticket = {
      key: key!,
      handle: setTimeout(() => {
        this.#answer(ticket).catch((error: unknown) =>
          this.notify({ kind: 'fault', reason: String(error) }),
        );
      }, this.delayMs),
    };
    this.#scheduled = ticket;
  }

  /** 推演是异步的：想好之后若请求已变（被收回、暂停或已作答）就放弃这次答案。 */
  async #answer(ticket: { readonly key: string }): Promise<void> {
    if (this.#scheduled !== ticket) return;
    const hub = this.match.room.decisions;
    try {
      const current = hub.pending[0];
      if (!current || `${current.id}:${current.token}` !== ticket.key) {
        this.#scheduled = null;
        this.notify({ kind: 'changed' });
        return;
      }
      const answer = await decide(this.match, current);
      if (this.#scheduled !== ticket) return;
      this.#scheduled = null;
      if (answer.kind === 'unsupported') {
        this.notify({ kind: 'unsupported', player: current.player, reason: answer.reason });
        return;
      }
      const result =
        answer.kind === 'cancel'
          ? hub.cancel(current.id, current.token)
          : hub.submit(current.id, current.token, answer.value);
      if (result.kind === 'rejected' && result.reason !== 'closed' && result.reason !== 'stale')
        throw new Error(`AI 提交失败：${result.message}`);
      this.notify({ kind: 'changed' });
    } catch (error) {
      if (this.#scheduled === ticket) this.#scheduled = null;
      this.notify({
        kind: 'fault',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
