import { unzip } from 'fflate';
import { contentAssets } from './content-assets';
import type { ContentAsset } from './content-assets';

/** 普通 ZIP：一个模块、一个清单和独立资源；解压在异步接口中完成。 */
export async function readContentBundle(data: ArrayBuffer): Promise<{
  readonly source: string;
  readonly assets: readonly ContentAsset[];
}> {
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(new Uint8Array(data), (error, files) => (error ? reject(error) : resolve(files)));
  });
  const manifestFile = entries['manifest.json'];
  if (!manifestFile) throw new Error('内容包缺少 manifest.json。');
  const manifest: unknown = JSON.parse(new TextDecoder().decode(manifestFile));
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('format' in manifest) ||
    manifest.format !== 'sgs-bundle/1' ||
    !('assets' in manifest) ||
    !Array.isArray(manifest.assets) ||
    !('module' in manifest) ||
    manifest.module !== 'content.sgs.mjs' ||
    !entries[manifest.module]
  )
    throw new Error('内容包清单格式不正确。');
  const assets = contentAssets(
    manifest.assets.map((item: unknown) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('path' in item) ||
        typeof item.path !== 'string' ||
        !('type' in item) ||
        typeof item.type !== 'string' ||
        !entries[item.path]
      )
        throw new Error('内容包缺少声明的资源。');
      return {
        path: item.path,
        blob: new Blob([Uint8Array.from(entries[item.path]!)], { type: item.type }),
      };
    }),
  );
  const expected = new Set([
    'manifest.json',
    manifest.module,
    ...assets.map((asset) => asset.path),
  ]);
  if (Object.keys(entries).some((path) => !expected.has(path)))
    throw new Error('内容包包含未声明的文件。');
  return { source: new TextDecoder().decode(entries[manifest.module]), assets };
}
