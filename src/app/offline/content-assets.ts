/** Blob 本身不可变；只冻结资源声明，不把二进制塞入规则的纯数据/事实协议。 */
export interface ContentAsset {
  readonly path: string;
  readonly blob: Blob;
}

export function contentAssets(input: unknown): readonly ContentAsset[] {
  if (!Array.isArray(input)) throw new Error('内容资源列表不正确。');
  const paths = new Set<string>();
  return Object.freeze(
    input.map((value: unknown) => {
      if (
        !value ||
        typeof value !== 'object' ||
        !('path' in value) ||
        typeof value.path !== 'string' ||
        !value.path.startsWith('assets/') ||
        value.path.includes('\\') ||
        value.path.split('/').some((part) => !part || part === '.' || part === '..') ||
        !('blob' in value) ||
        !(value.blob instanceof Blob) ||
        paths.has(value.path)
      )
        throw new Error('内容资源路径、二进制或重复声明不正确。');
      paths.add(value.path);
      return Object.freeze({ path: value.path, blob: value.blob });
    }),
  );
}

/** URL 只属于一次已加载模块；保存的是 Blob，恢复时重新创建 URL。 */
export function leaseContentAssets(assets: readonly ContentAsset[]) {
  const urls = new Map<string, string>();
  const byPath = new Map(assets.map((asset) => [asset.path, asset.blob]));
  let disposed = false;
  return {
    url(this: void, path: string): string {
      if (disposed) throw new Error('内容资源已经释放。');
      const blob = byPath.get(path);
      if (!blob) throw new Error(`内容包缺少资源：${path}`);
      let url = urls.get(path);
      if (!url) {
        url = URL.createObjectURL(blob);
        urls.set(path, url);
      }
      return url;
    },
    dispose(this: void): void {
      if (disposed) return;
      disposed = true;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}
