/** 输入框、组合输入与修饰键不应被全局游戏快捷键截获。 */
export function acceptsGameShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
    return false;
  const target = event.target;
  return !(
    target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')
  );
}
