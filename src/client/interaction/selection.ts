import type { ChoicePreview, GameSelection } from '../../protocol';

/** 只补必选且唯一的下一目标；保留多目标的选择顺序，从不自动提交。 */
export function selectForcedTargets(
  draft: GameSelection,
  inspect: (draft: GameSelection) => ChoicePreview,
): GameSelection {
  let next = draft;
  while (true) {
    const preview = inspect(next);
    if (next.targets.length >= preview.targetCount.min) return next;
    const remaining = preview.targets.filter(
      (target) => target.selectable && !next.targets.includes(target.id),
    );
    if (remaining.length !== 1) return next;
    next = { ...next, targets: [...next.targets, remaining[0]!.id] };
  }
}

/** 命令按钮保留原生 Enter；牌、技能和目标选区仍可快捷确认。 */
export function acceptsGameShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
    return false;
  const target = event.target;
  if (
    event.key === 'Enter' &&
    target instanceof Element &&
    target.closest('button, a, summary') &&
    !target.closest('[data-selection-input]')
  )
    return false;
  return !(
    target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')
  );
}
