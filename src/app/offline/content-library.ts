import type { ContentPackage } from '../../content/package';
import { resolvePackages } from '../../content/package';
import { dependentPackages, readContentModules, stageContentModules } from './content-modules';
import type { ContentFile, LoadedContentModule } from './content-modules';
import { IndexedContentStorage } from './content-storage';
import type { ContentStorage } from './content-storage';

export interface ContentLibraryView {
  readonly ready: boolean;
  readonly busy: boolean;
  readonly modules: readonly LoadedContentModule[];
  readonly enabled: readonly string[];
  readonly error: string;
  /** 失败记录保留，需明确重载或清空才能继续写入。标准对局仍可开始。 */
  readonly recovery: boolean;
}

/** 内容目录与持久化的协调器；不持有 Room，不热换正在运行的规则。 */
export class ContentLibrary {
  #view: ContentLibraryView = Object.freeze({
    ready: false,
    busy: false,
    modules: [],
    enabled: [],
    error: '',
    recovery: false,
  });
  #revision: number | null = null;
  #disposed = false;
  #listeners = new Set<(view: ContentLibraryView) => void>();
  constructor(
    private readonly base: readonly ContentPackage[],
    private readonly storage: ContentStorage = new IndexedContentStorage(),
    private readonly load: typeof readContentModules = readContentModules,
  ) {}
  get view(): ContentLibraryView {
    return this.#view;
  }
  subscribe(listener: (view: ContentLibraryView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
    for (const entry of this.#view.modules) entry.dispose?.();
  }
  #publish(patch: Partial<ContentLibraryView>): void {
    if (this.#disposed) return;
    const previous = this.#view.modules;
    this.#view = Object.freeze({ ...this.#view, ...patch });
    try {
      for (const listener of this.#listeners) listener(this.#view);
    } finally {
      for (const entry of previous) if (!this.#view.modules.includes(entry)) entry.dispose?.();
    }
  }
  #begin(recovery = false): boolean {
    if (
      this.#disposed ||
      this.#view.busy ||
      (!recovery && (!this.#view.ready || this.#view.recovery))
    )
      return false;
    this.#publish({ busy: true, error: '' });
    return true;
  }
  #failed(error: unknown, recovery: boolean): void {
    this.#publish({ error: error instanceof Error ? error.message : String(error), recovery });
  }
  #packages(): readonly ContentPackage[] {
    return [...this.base, ...this.#view.modules.map((entry) => entry.package)];
  }

  async restore(): Promise<boolean> {
    if (!this.#begin(true)) return false;
    this.#revision = null;
    let modules: readonly LoadedContentModule[] = [];
    try {
      const saved = await this.storage.read();
      if (this.#disposed) return false;
      this.#revision = saved.revision;
      modules = await this.load(
        saved.modules.map((entry) => ({
          name: entry.fileName,
          text: () => Promise.resolve(entry.source),
          assets: entry.assets ?? [],
        })),
      );
      for (let index = 0; index < modules.length; index++) {
        const actual = modules[index]!.package.manifest;
        const expected = saved.modules[index]!;
        if (
          actual.id !== expected.id ||
          actual.name !== expected.name ||
          actual.version !== expected.version
        )
          throw new Error(`${expected.fileName}：已保存模块的声明与记录不一致。`);
      }
      const staged = stageContentModules(
        this.base,
        modules.map((entry) => entry.package),
      );
      resolvePackages(staged, ['standard', ...saved.enabled]);
      this.#publish({
        modules: Object.freeze([...modules]),
        enabled: saved.enabled,
        recovery: false,
      });
      return !this.#disposed;
    } catch (error) {
      this.#failed(error, true);
      return false;
    } finally {
      for (const entry of modules) if (!this.#view.modules.includes(entry)) entry.dispose?.();
      this.#publish({ ready: true, busy: false });
    }
  }

  async #save(
    modules: readonly LoadedContentModule[],
    enabled: readonly string[],
  ): Promise<boolean> {
    if (this.#disposed || this.#revision === null) return false;
    try {
      const saved = await this.storage.save(this.#revision, modules, enabled);
      this.#revision = saved.revision;
      this.#publish({
        modules: Object.freeze([...modules]),
        enabled: saved.enabled,
        recovery: false,
      });
      return !this.#disposed;
    } catch (error) {
      this.#failed(error, true);
      return false;
    }
  }

  async import(files: readonly ContentFile[]): Promise<boolean> {
    if (!files.length || !this.#begin()) return false;
    let incoming: readonly LoadedContentModule[] = [];
    try {
      incoming = await this.load(files);
      if (this.#disposed) return false;
      stageContentModules(
        this.#packages(),
        incoming.map((entry) => entry.package),
      );
      return await this.#save(
        [...this.#view.modules, ...incoming],
        [
          ...new Set([
            ...this.#view.enabled,
            ...incoming.map((entry) => entry.package.manifest.id),
          ]),
        ],
      );
    } catch (error) {
      this.#failed(error, false);
      return false;
    } finally {
      for (const entry of incoming) if (!this.#view.modules.includes(entry)) entry.dispose?.();
      this.#publish({ busy: false });
    }
  }

  async toggle(id: string, enabled: boolean): Promise<boolean> {
    if (!this.#begin()) return false;
    try {
      const removed = enabled ? [] : dependentPackages(this.#packages(), id);
      const next = enabled
        ? [...new Set([...this.#view.enabled, id])]
        : this.#view.enabled.filter((entry) => !removed.includes(entry));
      resolvePackages(this.#packages(), ['standard', ...next]);
      return await this.#save(this.#view.modules, next);
    } catch (error) {
      this.#failed(error, false);
      return false;
    } finally {
      this.#publish({ busy: false });
    }
  }

  async remove(id: string): Promise<boolean> {
    if (!this.#begin()) return false;
    try {
      const removed = dependentPackages(this.#packages(), id);
      return await this.#save(
        this.#view.modules.filter((entry) => !removed.includes(entry.package.manifest.id)),
        this.#view.enabled.filter((entry) => !removed.includes(entry)),
      );
    } catch (error) {
      this.#failed(error, false);
      return false;
    } finally {
      this.#publish({ busy: false });
    }
  }

  async clear(): Promise<boolean> {
    if (!this.#begin(true)) return false;
    try {
      const saved =
        this.#revision === null
          ? await this.storage.reset()
          : await this.storage.save(this.#revision, [], []);
      this.#revision = saved.revision;
      this.#publish({ modules: [], enabled: [], recovery: false });
      return !this.#disposed;
    } catch (error) {
      this.#failed(error, true);
      return false;
    } finally {
      this.#publish({ ready: true, busy: false });
    }
  }
}
