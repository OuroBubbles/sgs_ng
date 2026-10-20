import * as sdk from '../../sdk';
import { definePackage, resolvePackages } from '../../content/package';
import type { ContentPackage } from '../../content/package';
import { contentAssets, leaseContentAssets } from './content-assets';
import type { ContentAsset } from './content-assets';

export interface ContentFile {
  readonly name: string;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  /** 恢复时直接使用已保存的二进制，不依赖原始文件。 */
  readonly assets?: readonly ContentAsset[];
}

export interface LoadedContentModule {
  readonly fileName: string;
  readonly source: string;
  readonly package: ContentPackage;
  readonly assets?: readonly ContentAsset[];
  readonly dispose?: () => void;
}

/** 执行可信普通代码；只暂存目录，不在这里创建/修改正在运行的 Room。 */
export function contentFromModule(
  module: unknown,
  assets = leaseContentAssets([]),
): ContentPackage {
  if (
    !module ||
    typeof module !== 'object' ||
    !('format' in module) ||
    module.format !== 'sgs-content/1' ||
    !('default' in module) ||
    typeof module.default !== 'function'
  )
    throw new Error('请选择由 content:build 生成的 .sgs.mjs 内容模块。');
  const create = module.default as (
    host: typeof sdk,
    resources: Pick<typeof assets, 'url'>,
  ) => unknown;
  const input = create(sdk, assets);
  if (
    !input ||
    typeof input !== 'object' ||
    !('manifest' in input) ||
    !input.manifest ||
    typeof input.manifest !== 'object'
  )
    throw new Error('内容模块必须同步返回一个 definePackage 声明。');
  return definePackage(input as ContentPackage);
}

/** 一批文件全部解析/装配成功后才交付新目录；重复 ID 不覆盖现有包。 */
export function stageContentModules(
  current: readonly ContentPackage[],
  incoming: readonly ContentPackage[],
): readonly ContentPackage[] {
  const next = Object.freeze([...current, ...incoming]);
  const resolved = resolvePackages(
    next,
    next.map((entry) => entry.manifest.id),
  );
  resolved.createBooks();
  for (const deck of resolved.decks) resolved.createDeck(deck.id);
  return next;
}

export async function readContentModules(
  files: readonly ContentFile[],
): Promise<readonly LoadedContentModule[]> {
  const settled = await Promise.allSettled(
    files.map(async (file) => {
      let lease: ReturnType<typeof leaseContentAssets> | undefined;
      let url: string | undefined;
      try {
        const loaded =
          file.assets !== undefined
            ? { source: await file.text(), assets: contentAssets(file.assets) }
            : file.name.endsWith('.sgs')
              ? await (async () => {
                  if (!file.arrayBuffer) throw new Error('请选择完整的二进制 .sgs 内容包。');
                  const { readContentBundle } = await import('./content-bundle');
                  return readContentBundle(await file.arrayBuffer());
                })()
              : { source: await file.text(), assets: [] };
        const { source, assets } = loaded;
        lease = leaseContentAssets(assets);
        url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const module: unknown = await import(/* @vite-ignore */ url);
        return Object.freeze({
          fileName: file.name,
          source,
          assets,
          package: contentFromModule(module, lease),
          dispose: lease.dispose,
        });
      } catch (error) {
        lease?.dispose();
        throw new Error(`${file.name}：${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    }),
  );
  const error = settled.find((entry) => entry.status === 'rejected');
  if (error) {
    for (const entry of settled) if (entry.status === 'fulfilled') entry.value.dispose();
    throw error.reason instanceof Error ? error.reason : new Error(String(error.reason));
  }
  return Object.freeze(
    settled.flatMap((entry) => (entry.status === 'fulfilled' ? [entry.value] : [])),
  );
}

/** 停用/移除一个包时连同依赖它的显式选择一起移除，避免“未勾选却仍启用”。 */
export function dependentPackages(
  packages: readonly ContentPackage[],
  id: string,
): readonly string[] {
  return packages
    .filter((entry) =>
      resolvePackages(packages, [entry.manifest.id]).versions.some((version) => version.id === id),
    )
    .map((entry) => entry.manifest.id);
}
