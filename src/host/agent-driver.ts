import type { DecisionRequest } from '../core/decisions/hub';
import type { RoleMatch } from './role-match';
import { observeAgent } from './agent-observation';
import { decideBasic } from './basic-agent';

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
        if (this.#scheduled !== ticket) return;
        this.#scheduled = null;
        const hub = this.match.room.decisions;
        try {
          const current = hub.pending[0];
          if (!current || `${current.id}:${current.token}` !== ticket.key) {
            this.notify({ kind: 'changed' });
            return;
          }
          const answer = decideBasic(observeAgent(this.match, current.player), current, (input) =>
            hub.preview(current.id, input),
          );
          if (answer.kind === 'unsupported') {
            this.notify({ kind: 'unsupported', player: current.player, reason: answer.reason });
            return;
          }
          const result =
            answer.kind === 'cancel'
              ? hub.cancel(current.id, current.token)
              : hub.submit(current.id, current.token, answer.value);
          if (result.kind === 'rejected' && result.reason !== 'closed' && result.reason !== 'stale')
            throw new Error(`基础 AI 提交失败：${result.message}`);
          this.notify({ kind: 'changed' });
        } catch (error) {
          this.notify({
            kind: 'fault',
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }, this.delayMs),
    };
    this.#scheduled = ticket;
  }
}
