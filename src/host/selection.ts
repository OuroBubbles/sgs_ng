import type { DecisionRequest } from '../core/decisions/hub';
import { immutable } from '../core/model/value';
import type { GameSelection, ChoicePreview } from '../protocol';
import { emptyPreview } from '../protocol';
import { record, candidates } from './projection';
import type { RoleMatch } from './role-match';

export function selectionInput(request: DecisionRequest, selection: GameSelection): unknown {
  // Svelte 的草稿可能是 Proxy；跨执行边界只提交复制后的普通数组。
  const cards = [...selection.cards];
  const targets = [...selection.targets];
  if (request.kind === 'cards-targets') return { cards, targets };
  const data = record(request.data);
  const offers = Array.isArray(data.offers) ? data.offers : [];
  const raw = offers.find((item: unknown) => record(item).id === selection.offer) as unknown;
  const offer = record(raw);
  const source = record(offer.choice);
  if (offer.kind === 'active') return { ...source, cards, targets };
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

/** 本地与远端共用选择解释；合法性始终交给主持端 DecisionHub。 */
export function inspectSelection(
  match: RoleMatch,
  request: DecisionRequest,
  selection: GameSelection,
): ChoicePreview {
  const empty = emptyPreview();
  if (request.kind === 'choose-option' || request.kind === 'trigger-order')
    return { ...empty, reason: '请选择上方的一项' };
  if (request.kind === 'invoke') return { ...empty, reason: '请选择是否发动技能' };
  if (request.kind === 'arrange') return { ...empty, reason: '请在排序面板中调整并确认' };
  const preview = match.room.decisions.preview(request.id, selectionInput(request, selection));
  if (!preview) return { ...empty, reason: '选择已结束' };
  const feedback = record(preview.feedback);
  const data = record(request.data);
  const range = record(feedback.targetCount ?? data.targetCount);
  return immutable({
    ...(typeof feedback.prompt === 'string' ? { prompt: feedback.prompt } : {}),
    valid: preview.valid,
    reason: preview.valid
      ? '选择完成，可以确认'
      : selectionReason(request, selection, preview.reason),
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
function selectionReason(
  request: DecisionRequest,
  selection: GameSelection,
  reason: string,
): string {
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
