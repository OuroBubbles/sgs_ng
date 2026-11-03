import type { Fact } from '../../core/history/journal';
import { immutable } from '../../core/model/value';
import type { SemanticCard } from './types';
import type { PhaseKind } from '../turn/turn';

/** 宣告发生时真正执行中的阶段；准备窗口、结束后的后效和外层暂停阶段不混入。 */
export interface CardActivityPhase {
  readonly id: string;
  readonly owner: string;
  readonly kind: PhaseKind;
}

export interface CardActivity {
  readonly seq: number;
  readonly kind: 'use' | 'response';
  readonly actor: string;
  readonly card: SemanticCard;
  readonly turnId: string | null;
  readonly phase: CardActivityPhase | null;
  readonly scopePath: readonly string[];
}
/** 从完整、有序的事实列表查询活动，不依赖技能当时是否存在，也不把普通移牌视为打出。
 * 改判的打出与材料交换同次提交，所以从 judgment.replaced 的 response 读取。
 * withinScope 只过滤因果后代；回合/阶段归属按宣告当时的最近领域边界分别记录。
 */
export function cardActivities(
  facts: readonly Fact[],
  withinScope?: string,
): readonly CardActivity[] {
  const turns = new Map<string, boolean>();
  const phases = new Map<string, { view: CardActivityPhase; active: boolean }>();
  const period = (path: readonly string[]) => {
    let turnId: string | null = null;
    let boundary = -1;
    for (let index = path.length - 1; index >= 0; index--) {
      const id = path[index]!;
      if (!turns.has(id)) continue;
      boundary = index;
      if (turns.get(id)) turnId = id;
      break;
    }
    let phase: CardActivityPhase | null = null;
    // 最近回合/阶段即使尚未开始或已经结束，也阻止穿透到暂停的外层阶段。
    for (let index = path.length - 1; index > boundary; index--) {
      const entry = phases.get(path[index]!);
      if (!entry) continue;
      if (entry.active) phase = entry.view;
      break;
    }
    return { turnId, phase };
  };
  return immutable(
    // 先按事实顺序建立边界，再筛选活动；祖先开始记录可能在 withinScope 之外。
    facts.flatMap((fact): CardActivity[] => {
      if (fact.data.kind === 'turn.started') {
        turns.set((fact.data.detail as { id: string }).id, true);
      } else if (fact.data.kind === 'phase.before' || fact.data.kind === 'phase.started') {
        const { id, owner, kind } = fact.data.detail as CardActivityPhase;
        phases.set(id, { view: { id, owner, kind }, active: fact.data.kind === 'phase.started' });
      } else if (fact.data.kind === 'lifetime.ended') {
        const { id } = fact.data.detail as { id: string };
        if (turns.has(id)) turns.set(id, false);
        const phase = phases.get(id);
        if (phase) phases.set(id, { ...phase, active: false });
      }
      if (withinScope !== undefined && !fact.scopePath.includes(withinScope)) return [];
      if (fact.data.kind === 'card.used' || fact.data.kind === 'card.responded') {
        const detail = fact.data.detail as { actor: string; declaration: { card: SemanticCard } };
        return [
          {
            seq: fact.seq,
            kind: fact.data.kind === 'card.used' ? 'use' : 'response',
            actor: detail.actor,
            card: detail.declaration.card,
            ...period(fact.scopePath),
            scopePath: fact.scopePath,
          },
        ];
      }
      if (fact.data.kind === 'judgment.replaced') {
        const detail = fact.data.detail as {
          declaration: { response?: SemanticCard; invocation?: { actor: string } };
        };
        const { response, invocation } = detail.declaration;
        if (response && invocation)
          return [
            {
              seq: fact.seq,
              kind: 'response',
              actor: invocation.actor,
              card: response,
              ...period(fact.scopePath),
              scopePath: fact.scopePath,
            },
          ];
      }
      return [];
    }),
  );
}
