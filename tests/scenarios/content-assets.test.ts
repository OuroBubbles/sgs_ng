import { expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { bundleContentArchive } from '../../scripts/build-content.mjs';
import { readContentBundle } from '../../src/app/offline/content-bundle';
import { contentAssets, leaseContentAssets } from '../../src/app/offline/content-assets';
import { contentFromModule } from '../../src/app/offline/content-modules';
import type { ContentFile, LoadedContentModule } from '../../src/app/offline/content-modules';
import { ContentLibrary } from '../../src/app/offline/content-library';
import {
  emptySavedContent,
  savedContent,
  parseSavedContent,
} from '../../src/app/offline/content-storage';
import type { ContentStorage, SavedContent } from '../../src/app/offline/content-storage';
import { availablePackages } from '../../src/app/offline/practice';
import { resolvePackages } from '../../src/content/package';
import { useDeclared } from '../../src/sdk';

const bytes = await bundleContentArchive('examples/content/harbor/index.ts');
const buffer = () => Uint8Array.from(bytes).buffer;
const file: ContentFile = {
  name: 'harbor.sgs',
  text: () => Promise.reject(new Error('Binary archive is not text.')),
  arrayBuffer: () => Promise.resolve(buffer()),
};

// Node 不支持浏览器 blob 模块导入；此处验证真实产物与协调器，实际 blob 加载另由浏览器验证。
async function load(files: readonly ContentFile[]): Promise<readonly LoadedContentModule[]> {
  return Promise.all(
    files.map(async (file) => {
      const parsed =
        file.assets !== undefined
          ? { source: await file.text(), assets: file.assets }
          : await readContentBundle(await file.arrayBuffer!());
      const lease = leaseContentAssets(parsed.assets);
      const module: unknown = await import(
        'data:text/javascript;base64,' + Buffer.from(parsed.source).toString('base64')
      );
      return {
        fileName: file.name,
        ...parsed,
        package: contentFromModule(module, lease),
        dispose: lease.dispose,
      };
    }),
  );
}
class Storage implements ContentStorage {
  current = emptySavedContent();
  beforeSave: (() => Promise<void>) | undefined;
  read() {
    return Promise.resolve(this.current);
  }
  async save(
    revision: number,
    modules: readonly LoadedContentModule[],
    enabled: readonly string[],
  ) {
    await this.beforeSave?.();
    this.current = savedContent(revision + 1, modules, enabled);
    return this.current;
  }
  reset() {
    this.current = emptySavedContent();
    return Promise.resolve(this.current);
  }
}
const portrait = (library: ContentLibrary) =>
  library.view.modules[0]!.package.generalViews![0]!.portrait;

it('资源包为确定性 ZIP，源码不内联图片，原始图片字节与声明完全一致', async () => {
  expect(await bundleContentArchive('examples/content/harbor/index.ts')).toEqual(bytes);
  const entries = unzipSync(bytes);
  expect(Object.keys(entries).sort()).toEqual([
    'assets/guest.jpg',
    'content.sgs.mjs',
    'manifest.json',
  ]);
  const loaded = await readContentBundle(buffer());
  expect(loaded.source).not.toContain('data:image');
  expect(loaded.source.length).toBeLessThan(12_000);
  expect(loaded.assets).toHaveLength(1);
  expect(loaded.assets[0]!.blob.type).toBe('image/jpeg');
  expect(new Uint8Array(await loaded.assets[0]!.blob.arrayBuffer())).toEqual(
    new Uint8Array(await readFile('examples/content/harbor/guest.jpg')),
  );
});

it('资源 URL 同路径复用且按模块隔离，释放后不可再取，缺失资源明确报错', async () => {
  const assets = contentAssets([{ path: 'assets/a.bin', blob: new Blob(['abc']) }]);
  const one = leaseContentAssets(assets),
    two = leaseContentAssets(assets);
  const url = one.url('assets/a.bin');
  expect(one.url('assets/a.bin')).toBe(url);
  expect(two.url('assets/a.bin')).not.toBe(url);
  expect(await (await fetch(url)).text()).toBe('abc');
  expect(() => one.url('assets/missing')).toThrow('缺少资源');
  one.dispose();
  one.dispose();
  await expect(fetch(url)).rejects.toThrow();
  expect(() => one.url('assets/a.bin')).toThrow('已经释放');
  expect(await (await fetch(two.url('assets/a.bin'))).text()).toBe('abc');
  two.dispose();
});

it('二进制记录复制冻结声明与列表，Blob 经结构化克隆仍能恢复，URL 不写入记录', async () => {
  const modules = await load([file]);
  const saved = savedContent(1, modules, ['harbor']);
  const restored = parseSavedContent(structuredClone(saved));
  expect(Object.isFrozen(restored.modules[0]!.assets)).toBe(true);
  expect(Object.isFrozen(restored.modules[0]!.assets![0])).toBe(true);
  expect(await restored.modules[0]!.assets![0]!.blob.arrayBuffer()).toEqual(
    await modules[0]!.assets![0]!.blob.arrayBuffer(),
  );
  expect(JSON.stringify(saved)).not.toContain('blob:');
  modules[0]!.dispose!();
});

it('真实资源包保存后不读原文件即可恢复，URL 重新分配且宿主时点身份不复制', async () => {
  const storage = new Storage(),
    one = new ContentLibrary(availablePackages, storage, load);
  await one.restore();
  expect(await one.import([file])).toBe(true);
  const old = portrait(one);
  expect(await (await fetch(old)).blob()).toMatchObject({ size: 274000 });
  one.dispose();
  await expect(fetch(old)).rejects.toThrow();
  const two = new ContentLibrary(availablePackages, storage, load);
  expect(await two.restore()).toBe(true);
  expect(portrait(two)).not.toBe(old);
  expect(await (await fetch(portrait(two))).blob()).toMatchObject({ size: 274000 });
  const books = resolvePackages(
    [...availablePackages, two.view.modules[0]!.package],
    ['harbor'],
  ).createBooks();
  expect(books.skills.definition('harbor:tide').effects[0]!.window).toBe(useDeclared);
  two.dispose();
});

it('保存失败释放本批新资源，原目录资源仍可用；清空提交后才释放原资源', async () => {
  const storage = new Storage();
  const created: LoadedContentModule[] = [];
  const tracked: typeof load = async (files) => {
    const entries = await load(files);
    created.push(...entries);
    return entries;
  };
  const library = new ContentLibrary(availablePackages, storage, tracked);
  await library.restore();
  storage.beforeSave = () => Promise.reject(new Error('quota'));
  expect(await library.import([file])).toBe(false);
  expect(library.view.modules).toEqual([]);
  await expect(fetch(created[0]!.package.generalViews![0]!.portrait)).rejects.toThrow();
  storage.beforeSave = undefined;
  await library.restore();
  expect(await library.import([file])).toBe(true);
  const old = portrait(library);
  // 第二次加载已拥有资源，重复 ID 在暂存检查中失败；不能泄漏这批 URL。
  expect(await library.import([file])).toBe(false);
  const discarded = created[2]!.package.generalViews![0]!.portrait;
  await expect(fetch(discarded)).rejects.toThrow();
  expect(await (await fetch(old)).blob()).toMatchObject({ size: 274000 });
  storage.beforeSave = () => Promise.reject(new Error('quota'));
  expect(await library.clear()).toBe(false);
  expect(await (await fetch(old)).blob()).toMatchObject({ size: 274000 });
  storage.beforeSave = undefined;
  expect(await library.clear()).toBe(true);
  await expect(fetch(old)).rejects.toThrow();
  library.dispose();
});

it('保存期间关闭目录不复活资源；已完成的二进制事务仍可供下一实例恢复', async () => {
  const storage = new Storage(),
    created: LoadedContentModule[] = [];
  const library = new ContentLibrary(availablePackages, storage, async (files) => {
    const entries = await load(files);
    created.push(...entries);
    return entries;
  });
  await library.restore();
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  storage.beforeSave = () => {
    entered();
    return wait;
  };
  const importing = library.import([file]);
  await ready;
  const url = created[0]!.package.generalViews![0]!.portrait;
  library.dispose();
  release();
  expect(await importing).toBe(false);
  await expect(fetch(url)).rejects.toThrow();
  expect(storage.current.modules[0]!.assets![0]!.blob.size).toBe(274000);
  const next = new ContentLibrary(availablePackages, storage, load);
  expect(await next.restore()).toBe(true);
  next.dispose();
});

it.each([
  {},
  { format: 'wrong', module: 'content.sgs.mjs', assets: [] },
  {
    format: 'sgs-bundle/1',
    module: 'content.sgs.mjs',
    assets: [{ path: 'assets/missing', type: 'text/plain' }],
  },
  {
    format: 'sgs-bundle/1',
    module: 'content.sgs.mjs',
    assets: [
      { path: 'assets/a', type: 'text/plain' },
      { path: 'assets/a', type: 'text/plain' },
    ],
  },
])('缺失/错误/重复资源清单不执行模块 %j', async (manifest) => {
  const archive = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'content.sgs.mjs': strToU8('throw new Error("must not execute")'),
    'assets/a': strToU8('x'),
  });
  await expect(readContentBundle(Uint8Array.from(archive).buffer)).rejects.toThrow();
});

it('存储拒绝非 Blob、重复和不规范资源路径，保留普通源码模块记录', () => {
  const raw: SavedContent = {
    format: 'sgs-content-store/1',
    revision: 1,
    enabled: [],
    modules: [],
  };
  for (const assets of [
    null,
    [{ path: 'assets/a', blob: 'bad' }],
    [{ path: 'assets/../a', blob: new Blob() }],
    [
      { path: 'assets/a', blob: new Blob() },
      { path: 'assets/a', blob: new Blob() },
    ],
  ])
    expect(() =>
      parseSavedContent({
        ...raw,
        modules: [
          { id: 'a', name: 'a', version: '1', fileName: 'a.sgs', source: 'source', assets },
        ],
      }),
    ).toThrow();
  expect(parseSavedContent(raw)).toEqual(raw);
});

it('恢复元数据不符时释放新资源并保留已保存的 Blob，不半发布目录', async () => {
  const storage = new Storage();
  const initial = await load([file]);
  storage.current = savedContent(1, initial, ['harbor']);
  initial[0]!.dispose!();
  storage.current = parseSavedContent({
    ...storage.current,
    modules: storage.current.modules.map((entry) => ({ ...entry, name: 'mismatch' })),
  });
  const created: LoadedContentModule[] = [];
  const library = new ContentLibrary(availablePackages, storage, async (files) => {
    const entries = await load(files);
    created.push(...entries);
    return entries;
  });
  expect(await library.restore()).toBe(false);
  expect(library.view).toMatchObject({ recovery: true, modules: [] });
  await expect(fetch(created[0]!.package.generalViews![0]!.portrait)).rejects.toThrow();
  expect(storage.current.modules[0]!.assets![0]!.blob.size).toBe(274000);
  library.dispose();
});

it('一 MiB 独立原始资源保持逐字节内容，不需要文本或图片编码', async () => {
  const raw = Uint8Array.from({ length: 1024 * 1024 }, (_, i) => (i * 37 + (i >>> 8)) % 256);
  const archive = zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        format: 'sgs-bundle/1',
        module: 'content.sgs.mjs',
        assets: [{ path: 'assets/raw.bin', type: 'application/octet-stream' }],
      }),
    ),
    'content.sgs.mjs': strToU8('export const format = "sgs-content/1";'),
    'assets/raw.bin': raw,
  });
  const parsed = await readContentBundle(Uint8Array.from(archive).buffer);
  expect(new Uint8Array(await parsed.assets[0]!.blob.arrayBuffer())).toEqual(raw);
});

it('资源包在 UTC 和上海时区构建的归档字节相同，不受 ZIP 本地时间编码影响', async () => {
  const code = `import {bundleContentArchive} from './scripts/build-content.mjs';
    import {createHash} from 'node:crypto';
    console.log(createHash('sha256').update(await bundleContentArchive('examples/content/harbor/index.ts')).digest('hex'));`;
  const run = promisify(execFile);
  const outputs = await Promise.all(
    ['UTC', 'Asia/Shanghai'].map((TZ) =>
      run(process.execPath, ['--input-type=module', '-e', code], {
        env: { ...process.env, TZ },
        windowsHide: true,
      }),
    ),
  );
  expect(outputs[0]!.stdout.trim()).toMatch(/^[a-f0-9]{64}$/);
  expect(outputs[0]!.stdout).toBe(outputs[1]!.stdout);
});

it('相同内容在另一目录构建逐字节一致，产物不残留开发机绝对路径', async () => {
  const directory = '.artifacts/content-bundle-portable';
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/index.ts`, await readFile('examples/content/harbor/index.ts'));
  await writeFile(`${directory}/guest.jpg`, await readFile('examples/content/harbor/guest.jpg'));
  const mirrored = await bundleContentArchive(`${directory}/index.ts`);
  expect(Buffer.from(mirrored).equals(Buffer.from(bytes))).toBe(true);
  const source = (await readContentBundle(buffer())).source;
  expect(source).not.toMatch(/[A-Z]:[\\/]|\/home\//i);
});

it('显式 raw 图片导入保留文本含义，不被独立资源 URL 覆盖', async () => {
  const directory = '.artifacts/content-bundle-raw';
  await mkdir(directory, { recursive: true });
  const text = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
  await writeFile(`${directory}/image.svg`, text);
  await writeFile(
    `${directory}/index.ts`,
    `import raw from './image.svg?raw';
    import {definePackage} from '@sgs/sdk';
    export default definePackage({manifest:{id:'raw',name:raw,version:'1'}});`,
  );
  const parsed = await readContentBundle(
    Uint8Array.from(await bundleContentArchive(`${directory}/index.ts`)).buffer,
  );
  expect(parsed.assets).toEqual([]);
  const module: unknown = await import(
    'data:text/javascript;base64,' + Buffer.from(parsed.source).toString('base64')
  );
  expect(contentFromModule(module).manifest.name).toBe(text);
});
