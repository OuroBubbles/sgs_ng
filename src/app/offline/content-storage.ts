import type { LoadedContentModule } from './content-modules';
import { contentAssets } from './content-assets';
import type { ContentAsset } from './content-assets';

export interface SavedContentModule {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly fileName: string;
  readonly source: string;
  readonly assets?: readonly ContentAsset[];
}
export interface SavedContent {
  readonly format: 'sgs-content-store/1';
  readonly revision: number;
  readonly modules: readonly SavedContentModule[];
  readonly enabled: readonly string[];
}
export interface ContentStorage {
  read(): Promise<SavedContent>;
  save(
    revision: number,
    modules: readonly LoadedContentModule[],
    enabled: readonly string[],
  ): Promise<SavedContent>;
  /** 只用于损坏且无法读取版本的记录；若已恢复成有效记录则要求重新载入。 */
  reset(): Promise<SavedContent>;
}

export class ContentConflict extends Error {
  constructor() {
    super('已保存内容在其他窗口中发生变化，请重新载入内容后再操作。');
  }
}
export const emptySavedContent = (): SavedContent =>
  Object.freeze({
    format: 'sgs-content-store/1',
    revision: 0,
    modules: Object.freeze([]),
    enabled: Object.freeze([]),
  });

/** 只接受数据；执行对象、技能闭包和 Room 从不进入存储。 */
export function parseSavedContent(input: unknown): SavedContent {
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object';
  const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
  if (
    !object(input) ||
    input.format !== 'sgs-content-store/1' ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0 ||
    !Array.isArray(input.modules) ||
    !Array.isArray(input.enabled)
  )
    throw new Error('已保存的内容记录格式不正确。');
  const modules: SavedContentModule[] = input.modules.map((entry: unknown) => {
    if (
      !object(entry) ||
      !string(entry.id) ||
      !string(entry.name) ||
      !string(entry.version) ||
      !string(entry.fileName) ||
      !string(entry.source)
    )
      throw new Error('已保存的模块记录不完整。');
    return Object.freeze({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      fileName: entry.fileName,
      source: entry.source,
      ...(entry.assets === undefined ? {} : { assets: contentAssets(entry.assets) }),
    });
  });
  if (
    !input.enabled.every(string) ||
    new Set(input.enabled).size !== input.enabled.length ||
    new Set(modules.map((entry) => entry.id)).size !== modules.length
  )
    throw new Error('已保存的内容包含重复或非法选择。');
  return Object.freeze({
    format: 'sgs-content-store/1',
    revision: Number(input.revision),
    modules: Object.freeze(modules),
    enabled: Object.freeze([...input.enabled]),
  });
}

export function savedContent(
  revision: number,
  modules: readonly LoadedContentModule[],
  enabled: readonly string[],
): SavedContent {
  return parseSavedContent({
    format: 'sgs-content-store/1',
    revision,
    enabled,
    modules: modules.map((entry) => ({
      id: entry.package.manifest.id,
      name: entry.package.manifest.name,
      version: entry.package.manifest.version,
      fileName: entry.fileName,
      source: entry.source,
      ...(entry.assets === undefined ? {} : { assets: entry.assets }),
    })),
  });
}

const databaseName = 'sgs-ng-content';
const storeName = 'loadout';
const key = 'current';

async function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  if (!factory) throw new Error('当前环境无法访问本地内容存储。');
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onerror = () => reject(request.error ?? new Error('无法打开本地内容存储。'));
    request.onblocked = () => {
      failed = true;
      reject(new Error('本地内容存储正在被其他窗口占用，请关闭旧窗口后重试。'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (failed) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

/** resolve 只发生在事务完整提交后；请求成功不等于持久保存成功。 */
function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(failure instanceof Error ? failure : (tx.error ?? new Error('本地内容保存已中止。')));
    tx.onerror = () => {
      failure ??= tx.error;
    };
    const fail = (error: unknown) => {
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    try {
      body(
        tx.objectStore(storeName),
        (value) => {
          result = value;
        },
        fail,
      );
    } catch (error) {
      fail(error);
    }
  });
}

export class IndexedContentStorage implements ContentStorage {
  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  async read(): Promise<SavedContent> {
    const db = await openDatabase(this.factory);
    try {
      return await transaction(db, 'readonly', (store, finish, fail) => {
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            const raw: unknown = request.result;
            finish(raw === undefined ? emptySavedContent() : parseSavedContent(raw));
          } catch (error) {
            fail(error);
          }
        };
      });
    } finally {
      db.close();
    }
  }

  async save(
    revision: number,
    modules: readonly LoadedContentModule[],
    enabled: readonly string[],
  ): Promise<SavedContent> {
    const next = savedContent(revision + 1, modules, enabled);
    const db = await openDatabase(this.factory);
    try {
      return await transaction(db, 'readwrite', (store, finish, fail) => {
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            const raw: unknown = request.result;
            const current = raw === undefined ? emptySavedContent() : parseSavedContent(raw);
            if (current.revision !== revision) throw new ContentConflict();
            store.put(next, key);
            finish(next);
          } catch (error) {
            fail(error);
          }
        };
      });
    } finally {
      db.close();
    }
  }

  async reset(): Promise<SavedContent> {
    const db = await openDatabase(this.factory);
    try {
      return await transaction(db, 'readwrite', (store, finish, fail) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const raw: unknown = request.result;
          if (raw !== undefined) {
            let valid = true;
            try {
              parseSavedContent(raw);
            } catch {
              valid = false;
            }
            if (valid) {
              fail(new ContentConflict());
              return;
            }
          }
          store.delete(key);
          finish(emptySavedContent());
        };
      });
    } finally {
      db.close();
    }
  }
}
