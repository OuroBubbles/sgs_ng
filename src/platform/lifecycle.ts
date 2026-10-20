/** 浏览器和 WebView 共用前后台暂停；不把系统生命周期放入规则代码。 */
export function observeVisibility(update: (visible: boolean) => void): () => void {
  const apply = () => update(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', apply);
  apply();
  return () => document.removeEventListener('visibilitychange', apply);
}
