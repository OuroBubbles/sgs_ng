// 渲染模块自行安装无动态求值适配，兼容原生生产 CSP，入口无需预载 Pixi。
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
import type { GameView } from '../../core/view/game';
import { layoutTable, photoLayout, type TableLayout } from './layout';
import { PortraitTextures } from './portraits';
import { seatFrame, skinImage } from '../presentation/skin';

/** 只读取视图；点击区域由同一份布局驱动的 DOM 按钮承接。 */
export class BattleBoard {
  readonly #app = new Application();
  readonly #portraits = new PortraitTextures(() => this.#draw());
  #observer: ResizeObserver | null = null;
  #view: GameView | null = null;
  #active = true;
  #destroyed = false;
  #layoutChanged: (layout: TableLayout) => void = () => undefined;
  #layoutWidth = 0;
  #layoutHeight = 0;
  #layoutFocus = '';

  async mount(host: HTMLElement, layoutChanged: (layout: TableLayout) => void): Promise<void> {
    this.#layoutChanged = layoutChanged;
    await this.#app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      preference: 'webgl',
      resolution: Math.min(window.devicePixelRatio, 1.5),
      autoDensity: true,
    });
    if (this.#destroyed) {
      this.#app.destroy(true, { children: true, context: true });
      return;
    }

    // 静态战场按视图变更重绘，不持续占用每帧的渲染预算。
    this.#app.stop();

    host.append(this.#app.canvas);
    this.#app.canvas.setAttribute('aria-hidden', 'true');
    this.#observer = new ResizeObserver(() => {
      this.#app.resize();
      this.#draw();
    });
    this.#observer.observe(host);
    this.#draw();
  }

  update(view: GameView): void {
    this.#view = view;
    this.#draw();
  }

  setActive(active: boolean): void {
    this.#active = active;
    if (!this.#app.renderer) return;
    // 恢复时按当前投影重绘，不把暂停前的渲染指令当作当前画面。
    if (active) this.#draw();
  }

  #draw(): void {
    if (!this.#view || !this.#app.renderer || this.#destroyed) return;
    // 重绘创建的 GraphicsContext 独占；释放它们，不销毁立绘共享的纹理源。
    for (const child of this.#app.stage.removeChildren())
      child.destroy({ children: true, context: true });
    const unknown = skinImage('ui/photo/unknown.jpg');
    this.#portraits.sync([
      unknown,
      ...this.#view.players.flatMap((player) => [
        seatFrame(player.kingdom),
        ...(player.portrait ? [player.portrait] : []),
      ]),
    ]);

    const w = this.#app.screen.width;
    const h = this.#app.screen.height;
    const focus = Math.max(
      0,
      this.#view.players.findIndex(
        (player) => player.self || (!this.#view?.viewer && player.id === this.#view?.active),
      ),
    );
    const layout = layoutTable(w, h, this.#view.players.length, focus);
    const layoutFocus = `${focus}:${this.#view.players.length}`;
    if (w !== this.#layoutWidth || h !== this.#layoutHeight || layoutFocus !== this.#layoutFocus) {
      this.#layoutWidth = w;
      this.#layoutHeight = h;
      this.#layoutFocus = layoutFocus;
      this.#layoutChanged(layout);
    }
    const positions = layout.seats;

    const portraits: string[] = [];
    this.#view.players.forEach((player, index) => {
      const position = positions[index];
      if (!position) return;
      const node = new Container();
      const geometry = photoLayout(position);
      node.alpha = player.alive ? 1 : 0.5;
      const frame = this.#portraits.get(seatFrame(player.kingdom));
      if (frame) {
        const sprite = new Sprite(frame);
        Object.assign(sprite, {
          x: geometry.frame.left,
          y: geometry.frame.top,
          width: geometry.frame.width,
          height: geometry.frame.height,
        });
        node.addChild(sprite);
      }
      const ownTexture = player.portrait ? this.#portraits.get(player.portrait) : undefined;
      const texture = ownTexture ?? this.#portraits.get(unknown);
      if (texture) {
        if (ownTexture) portraits.push(player.id);
        const { left, top, width, height } = geometry.portrait;
        const scale = Math.max(width / texture.width, height / texture.height);
        const cropWidth = Math.min(texture.width, width / scale);
        const cropHeight = Math.min(texture.height, height / scale);
        // 裁取纹理 UV，不创建 stencil mask；独立渲染器的销毁不影响此裁取。
        // 每帧只释放这个轻量视图，原始纹理源仍由 PortraitTextures 独占。
        const cropped = new Texture({
          source: texture.source,
          frame: new Rectangle(
            (texture.width - cropWidth) / 2,
            (texture.height - cropHeight) / 2,
            cropWidth,
            cropHeight,
          ),
        });
        // 直接填充圆角几何，不使用 stencil mask；圆角半径对应原 Photo 的 6 / 0.75。
        const portrait = new Graphics().roundRect(0, 0, width, height, 8 * geometry.scale).fill({
          texture: cropped,
          textureSpace: 'global',
          matrix: new Matrix().scale(width / cropWidth, height / cropHeight),
        });
        portrait.position.set(left, top);
        portrait.once('destroyed', () => cropped.destroy());
        node.addChild(portrait);
      }

      node.eventMode = 'none';
      this.#app.stage.addChild(node);
    });

    // 供桌面/触控验收读取本次场景中已解码并绘制的公开席位，不导出资源和规则状态。
    this.#app.canvas.dataset.portraits = portraits.join(',');
    if (this.#active) this.#app.render();
  }

  destroy(): void {
    this.#destroyed = true;
    this.#observer?.disconnect();
    if (this.#app.renderer) this.#app.destroy(true, { children: true, context: true });
    this.#portraits.destroy();
  }
}
