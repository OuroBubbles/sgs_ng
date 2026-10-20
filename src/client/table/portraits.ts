import { Texture } from 'pixi.js';

interface PortraitEntry {
  readonly image: HTMLImageElement;
  texture?: Texture;
}

/** 牌桌独占纹理，不进入 Pixi 全局缓存；异步完成不复活已移除的资源。 */
export class PortraitTextures {
  readonly #entries = new Map<string, PortraitEntry>();
  readonly #changed: () => void;

  constructor(changed: () => void) {
    this.#changed = changed;
  }

  sync(sources: readonly string[]): void {
    const wanted = new Set(sources);
    for (const [source, entry] of this.#entries) {
      if (wanted.has(source)) continue;
      this.#entries.delete(source);
      entry.texture?.destroy(true);
    }
    for (const source of wanted) {
      if (this.#entries.has(source)) continue;
      const image = new Image();
      const entry: PortraitEntry = { image };
      this.#entries.set(source, entry);
      image.src = source;
      void image.decode().then(
        () => {
          if (this.#entries.get(source) !== entry) return;
          entry.texture = Texture.from(image, true);
          this.#changed();
        },
        () => {
          // 加载失败保留轮廓；当前牌桌不反复请求坏资源，也不影响规则和点击。
        },
      );
    }
  }

  get(source: string): Texture | undefined {
    return this.#entries.get(source)?.texture;
  }

  destroy(): void {
    this.sync([]);
  }
}
