import { expect, it } from 'vitest';
import { ContentLibrary } from '../../src/app/offline/content-library';
import {
  ContentConflict,
  emptySavedContent,
  IndexedContentStorage,
  parseSavedContent,
  savedContent,
} from '../../src/app/offline/content-storage';
import type { ContentStorage, SavedContent } from '../../src/app/offline/content-storage';
import type { LoadedContentModule } from '../../src/app/offline/content-modules';
import { definePackage } from '../../src/sdk';
import type { ContentPackage } from '../../src/sdk';
import { availablePackages } from '../../src/app/offline/practice';

const module = (id = 'harbor', requires = ['standard']): LoadedContentModule => {
  const manifest = { id, name: id, version: '1', requires: requires.map((id) => ({ id })) };
  return {
    package: definePackage({ manifest }),
    source: JSON.stringify(manifest),
    fileName: `${id}.sgs.mjs`,
  };
};
const file = (entry: LoadedContentModule) => ({
  name: entry.fileName,
  text: () => Promise.resolve(entry.source),
});
const load: ConstructorParameters<typeof ContentLibrary>[2] = (files) =>
  Promise.all(
    files.map(async (file) => {
      const source = await file.text();
      const manifest: unknown = JSON.parse(source);
      return {
        source,
        fileName: file.name,
        package: definePackage({ manifest } as ContentPackage),
      };
    }),
  );
class Storage implements ContentStorage {
  current = emptySavedContent();
  beforeSave: ((next: SavedContent) => Promise<void>) | undefined;
  saves = 0;
  read() {
    return Promise.resolve(this.current);
  }
  save(revision: number, modules: readonly LoadedContentModule[], enabled: readonly string[]) {
    this.saves++;
    if (revision !== this.current.revision) return Promise.reject(new ContentConflict());
    const next = savedContent(revision + 1, modules, enabled);
    return (this.beforeSave?.(next) ?? Promise.resolve()).then(() => {
      this.current = next;
      return next;
    });
  }
  reset() {
    this.current = emptySavedContent();
    return Promise.resolve(this.current);
  }
}
const library = (storage = new Storage()) => new ContentLibrary(availablePackages, storage, load);
const ids = (target: ContentLibrary) =>
  target.view.modules.map((entry) => entry.package.manifest.id);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

it('模块源码、元数据和选择被一起恢复，函数对象重新由加载器构造', async () => {
  const storage = new Storage();
  storage.current = savedContent(4, [module()], ['harbor']);
  const target = library(storage);
  expect(target.view.ready).toBe(false);
  expect(await target.restore()).toBe(true);
  expect(ids(target)).toEqual(['harbor']);
  expect(target.view.enabled).toEqual(['harbor']);
  expect(target.view.modules[0]!.package).not.toBe(module().package);
  expect(storage.saves).toBe(0);
  expect(target.view).toMatchObject({ ready: true, busy: false, recovery: false, error: '' });
});

it('提交尚未完成时不显示半安装，重复操作拒绝，完成后一次发布目录与开关', async () => {
  const storage = new Storage();
  const target = library(storage);
  await target.restore();
  const gate = deferred<void>();
  const entered = deferred<void>();
  storage.beforeSave = () => {
    entered.resolve();
    return gate.promise;
  };
  const running = target.import([file(module())]);
  await entered.promise;
  expect(target.view.busy).toBe(true);
  expect(ids(target)).toEqual([]);
  expect(storage.current.modules).toEqual([]);
  expect(await target.toggle('workshop', true)).toBe(false);
  gate.resolve();
  expect(await running).toBe(true);
  expect(ids(target)).toEqual(['harbor']);
  expect(target.view.enabled).toEqual(['harbor']);
  expect(storage.current.modules[0]!.source).toBe(module().source);
  expect(storage.saves).toBe(1);
});

it('持久提交失败保留旧目录和记录，重载后仍可继续正常导入', async () => {
  const storage = new Storage();
  const target = library(storage);
  await target.restore();
  storage.beforeSave = () => Promise.reject(new Error('quota'));
  expect(await target.import([file(module())])).toBe(false);
  expect(target.view).toMatchObject({ enabled: [], error: 'quota', recovery: true, busy: false });
  expect(ids(target)).toEqual([]);
  expect(storage.current.modules).toEqual([]);
  expect(await target.import([file(module())])).toBe(false);
  storage.beforeSave = undefined;
  expect(await target.restore()).toBe(true);
  expect(await target.import([file(module())])).toBe(true);
});

it('启用闭包、停用和移除依赖同时保存，重新创建窗口仍保持停用状态', async () => {
  const storage = new Storage();
  const first = library(storage);
  await first.restore();
  await first.import([file(module('pilot', ['harbor'])), file(module())]);
  expect(await first.toggle('harbor', false)).toBe(true);
  expect(first.view.enabled).toEqual([]);
  const second = library(storage);
  await second.restore();
  expect(ids(second)).toEqual(['pilot', 'harbor']);
  expect(second.view.enabled).toEqual([]);
  expect(await second.remove('harbor')).toBe(true);
  expect(storage.current.modules).toEqual([]);
  expect(await library(storage).restore()).toBe(true);
});

it('其他窗口的版本更新不能被旧目录覆盖，重载取得新版本后再操作', async () => {
  const storage = new Storage();
  const first = library(storage);
  const second = library(storage);
  await first.restore();
  await second.restore();
  await first.import([file(module())]);
  expect(await second.toggle('workshop', true)).toBe(false);
  expect(second.view.error).toContain('其他窗口');
  expect(storage.current.enabled).toEqual(['harbor']);
  expect(await second.restore()).toBe(true);
  expect(ids(second)).toEqual(['harbor']);
  expect(await second.toggle('workshop', true)).toBe(true);
  expect(storage.current.enabled).toEqual(['harbor', 'workshop']);
});

it('错误源码恢复失败不删除记录，仍完成启动，可明确清空后正常使用', async () => {
  const storage = new Storage();
  storage.current = savedContent(2, [{ ...module(), source: 'invalid source' }], ['harbor']);
  const target = library(storage);
  expect(await target.restore()).toBe(false);
  expect(target.view).toMatchObject({ ready: true, busy: false, recovery: true, modules: [] });
  expect(storage.current.modules).toHaveLength(1);
  expect(await target.clear()).toBe(true);
  expect(storage.current.modules).toEqual([]);
  expect(target.view.recovery).toBe(false);
});

it('保存元数据与重新执行得到的声明不一致时拒绝恢复，记录仍保留', async () => {
  const storage = new Storage();
  storage.current = savedContent(2, [{ ...module(), source: module('different').source }], []);
  const target = library(storage);
  expect(await target.restore()).toBe(false);
  expect(target.view.error).toContain('声明与记录不一致');
  expect(storage.current.modules[0]!.id).toBe('harbor');
});

it('失效依赖恢复时没有半目录，也不抹掉已保存模块', async () => {
  const storage = new Storage();
  storage.current = savedContent(1, [module('pilot', ['missing'])], ['pilot']);
  const target = library(storage);
  expect(await target.restore()).toBe(false);
  expect(ids(target)).toEqual([]);
  expect(target.view.error).toContain('Missing package');
  expect(storage.current.modules).toHaveLength(1);
});

it('已加载目录在一次重载失败后保留，清空不会悄悄覆盖新窗口写入', async () => {
  const storage = new Storage();
  storage.current = savedContent(2, [module()], ['harbor']);
  const target = library(storage);
  await target.restore();
  storage.current = savedContent(3, [module('pilot', ['missing'])], ['pilot']);
  expect(await target.restore()).toBe(false);
  expect(ids(target)).toEqual(['harbor']);
  // 故障后另一个窗口再次提交；清空仍受版本检查，不能误删其新目录。
  storage.current = savedContent(4, [module('newer')], []);
  expect(await target.clear()).toBe(false);
  expect(storage.current.modules[0]!.id).toBe('newer');
});

it('加载过程中关闭窗口不再安装；已经进入提交的写入可完成但不再通知旧界面', async () => {
  const storage = new Storage();
  const loading = deferred<readonly LoadedContentModule[]>();
  const target = new ContentLibrary(availablePackages, storage, () => loading.promise);
  const restoring = target.restore();
  await Promise.resolve();
  target.dispose();
  loading.resolve([]);
  expect(await restoring).toBe(false);
  expect(storage.saves).toBe(0);
  const second = library(storage);
  await second.restore();
  const save = deferred<void>();
  const entered = deferred<void>();
  storage.beforeSave = () => {
    entered.resolve();
    return save.promise;
  };
  const running = second.import([file(module())]);
  await entered.promise;
  second.dispose();
  save.resolve();
  expect(await running).toBe(false);
  expect(storage.current.modules).toHaveLength(1);
});

it('取消/空文件与重复 ID 不产生保存操作，原声明继续可用', async () => {
  const storage = new Storage();
  const target = library(storage);
  await target.restore();
  expect(await target.import([])).toBe(false);
  await target.import([file(module())]);
  expect(await target.import([file(module())])).toBe(false);
  expect(storage.saves).toBe(1);
  expect(ids(target)).toEqual(['harbor']);
  expect(target.view.recovery).toBe(false);
});

it.each([
  null,
  {},
  { format: 'other', revision: 0, modules: [], enabled: [] },
  { ...emptySavedContent(), revision: -1 },
  { ...emptySavedContent(), revision: 0.5 },
  { ...emptySavedContent(), revision: Number.MAX_SAFE_INTEGER + 1 },
  { ...savedContent(1, [module()], []), enabled: ['harbor', 'harbor'] },
  { ...savedContent(1, [module()], []), modules: [{ id: 'harbor' }] },
])('非法本地记录 %j 不进入目录', (input) => {
  expect(() => parseSavedContent(input)).toThrow();
});

it('持久数据为冻结快照，不借用调用者列表，也不包含执行对象', () => {
  const raw = { format: 'sgs-content-store/1', revision: 1, modules: [], enabled: ['workshop'] };
  const value = parseSavedContent(raw);
  raw.enabled.push('harbor');
  expect(value.enabled).toEqual(['workshop']);
  expect(Object.isFrozen(value.enabled)).toBe(true);
  const saved = savedContent(1, [module()], []);
  expect(Object.keys(saved.modules[0]!)).toEqual(['id', 'name', 'version', 'fileName', 'source']);
});

it('当前环境没有 IndexedDB 时明确失败，不伪装持久安装成功', async () => {
  await expect(new IndexedContentStorage(undefined).read()).rejects.toThrow('存储');
});
