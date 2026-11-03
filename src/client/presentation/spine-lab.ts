// 动画可从大厅独立打开，不依赖战场先安装 CSP 适配。
import 'pixi.js/unsafe-eval';
import { Application, Assets, Cache } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';

export interface SpineMetrics {
  readonly instances: number;
  readonly frames: number;
  readonly p95: number;
  readonly fps: number;
  readonly paused: boolean;
  readonly animation: string;
}

/** 独立表现夹具：共享骨骼/贴图，每个实例拥有独立动画状态。 */
export class SpineLab {
  readonly #app = new Application();
  #instances: Spine[] = [];
  #samples: number[] = [];
  #frames = 0;
  #elapsed = 0;
  #paused = false;
  #destroyed = false;
  #animation = 'walk';
  #observer: ResizeObserver | null = null;
  #report: (metrics: SpineMetrics) => void = () => undefined;

  async mount(host: HTMLElement, report: (metrics: SpineMetrics) => void): Promise<void> {
    this.#report = report;
    await this.#app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      preference: 'webgl',
      antialias: true,
      resolution: Math.min(window.devicePixelRatio, 1.5),
      autoDensity: true,
    });
    if (this.#destroyed) {
      this.#app.destroy(true, { children: true });
      return;
    }
    host.append(this.#app.canvas);
    this.#app.canvas.setAttribute('aria-label', 'Spine 4.2 骨骼动画验证');

    await Assets.load([
      { alias: 'p0-spineboy', src: '/spine/spineboy-pro.skel' },
      { alias: 'p0-spineboy-atlas', src: '/spine/spineboy.atlas' },
    ]);
    if (this.#destroyed) return;

    this.setCount(1);
    this.#observer = new ResizeObserver(() => this.#layout());
    this.#observer.observe(host);
    this.#app.ticker.add((ticker) => {
      if (this.#paused) return;
      const dt = Math.min(ticker.deltaMS, 100) / 1000;
      for (const instance of this.#instances) instance.update(dt);
      this.#samples.push(ticker.elapsedMS);
      if (this.#samples.length > 600) this.#samples.shift();
      this.#frames += 1;
      this.#elapsed += ticker.elapsedMS;
      if (this.#elapsed >= 500) {
        this.#elapsed = 0;
        this.#publish();
      }
    });
    if (this.#paused) this.#app.stop();
  }

  setCount(count: 1 | 8): void {
    if (!this.#app.renderer || this.#destroyed) return;
    for (const instance of this.#instances) instance.destroy();
    this.#instances = [];
    this.#samples = [];
    this.#frames = 0;

    for (let i = 0; i < count; i += 1) {
      const instance = Spine.from({
        skeleton: 'p0-spineboy',
        atlas: 'p0-spineboy-atlas',
        autoUpdate: false,
      });
      instance.state.setAnimation(0, this.#animation, true);
      instance.update((i / count) * 0.8);
      this.#app.stage.addChild(instance);
      this.#instances.push(instance);
    }
    this.#layout();
    this.#publish();
  }

  setAnimation(animation: 'walk' | 'run'): void {
    this.#animation = animation;
    for (const instance of this.#instances) {
      instance.state.setAnimation(0, animation, true);
      instance.update(0);
    }
    this.#app.render();
    this.#publish();
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
    if (!this.#app.renderer) return;
    if (paused) this.#app.stop();
    else this.#app.start();
    this.#publish();
  }

  #layout(): void {
    const w = this.#app.screen.width;
    const h = this.#app.screen.height;
    const count = this.#instances.length;
    const cols = count === 1 ? 1 : 4;
    const rows = count === 1 ? 1 : 2;
    const scale = Math.min(w / cols / 340, h / rows / 720);
    this.#instances.forEach((instance, i) => {
      instance.scale.set(scale);
      instance.position.set(
        (w / cols) * ((i % cols) + 0.5) - 20 * scale,
        (h / rows) * (Math.floor(i / cols) + 1) - 10,
      );
    });
    this.#app.render();
  }

  #publish(): void {
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
    this.#report({
      instances: this.#instances.length,
      frames: this.#frames,
      p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
      fps: mean ? 1000 / mean : 0,
      paused: this.#paused,
      animation: this.#animation,
    });
  }

  /** 卸载容器和缓存，避免反复打开验证器积累 GPU 资源。 */
  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#observer?.disconnect();
    for (const instance of this.#instances) instance.destroy();
    this.#instances = [];
    // 4.2 的 from() 文档公开此缓存 key；4.3 的 unload API 不适用于本版本。
    Cache.remove('p0-spineboy-p0-spineboy-atlas-1');
    if (this.#app.renderer) this.#app.destroy(true, { children: true });
    await Assets.unload(['p0-spineboy', 'p0-spineboy-atlas']);
  }
}
