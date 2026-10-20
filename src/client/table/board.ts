import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { GameView, GameSelection, ChoicePreview } from '../../core/view/game';
import { layoutTable, type TableLayout } from './layout';
import { PortraitTextures } from './portraits';

const serif = 'KaiTi, STKaiti, SimSun, serif';

function label(text: string, size: number, color: string): Text {
  const node = new Text({
    text,
    style: { fontFamily: serif, fontSize: size, fill: color, letterSpacing: 3 },
  });
  node.anchor.set(0.5);
  return node;
}

/** 只读取视图；点击区域由同一份布局驱动的 DOM 按钮承接。 */
export class BattleBoard {
  readonly #app = new Application();
  readonly #portraits = new PortraitTextures(() => this.#draw());
  #observer: ResizeObserver | null = null;
  #view: GameView | null = null;
  #selection: GameSelection = { offer: null, cards: [], targets: [] };
  #preview: ChoicePreview = {
    valid: false,
    reason: '',
    cards: [],
    targets: [],
    targetCount: { min: 0, max: 0 },
    fixedTargets: [],
  };
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
      this.#app.destroy(true, { children: true });
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

  update(view: GameView, selection: GameSelection, preview: ChoicePreview): void {
    this.#view = view;
    this.#selection = selection;
    this.#preview = preview;
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
    for (const child of this.#app.stage.removeChildren()) child.destroy({ children: true });
    this.#portraits.sync(
      this.#view.players.flatMap((player) => (player.portrait ? [player.portrait] : [])),
    );

    const w = this.#app.screen.width;
    const h = this.#app.screen.height;
    const focus = Math.max(
      0,
      this.#view.players.findIndex(
        (player) => player.self || (!this.#view?.viewer && player.id === this.#view?.active),
      ),
    );
    const layout = layoutTable(w, h, this.#view.players.length, focus);
    const compact = layout.compact;
    const layoutFocus = `${focus}:${this.#view.players.length}`;
    if (w !== this.#layoutWidth || h !== this.#layoutHeight || layoutFocus !== this.#layoutFocus) {
      this.#layoutWidth = w;
      this.#layoutHeight = h;
      this.#layoutFocus = layoutFocus;
      this.#layoutChanged(layout);
    }
    const cx = w / 2;
    const cy = layout.arena.height * 0.58;
    const radius = Math.min(w * 0.24, layout.arena.height * 0.31);
    const ground = new Graphics();

    ground
      .ellipse(cx, cy + radius * 0.32, radius * 1.55, radius * 0.67)
      .fill({ color: '#c7a368', alpha: 0.025 });
    ground.circle(cx, cy, radius).stroke({ color: '#c7a368', alpha: 0.12, width: 1 });
    ground.circle(cx, cy, radius * 0.92).stroke({ color: '#c7a368', alpha: 0.055, width: 1 });

    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * Math.PI * 2;
      const start = radius * (i % 4 === 0 ? 1.02 : 1.04);
      ground.moveTo(cx + Math.cos(angle) * start, cy + Math.sin(angle) * start);
      ground.lineTo(cx + Math.cos(angle) * radius * 1.09, cy + Math.sin(angle) * radius * 1.09);
    }
    ground.stroke({ color: '#c7a368', alpha: 0.13, width: 1 });
    this.#app.stage.addChild(ground);

    const positions = layout.seats;

    for (const target of this.#selection.targets) {
      const targetIndex = this.#view.players.findIndex((player) => player.id === target);
      const targetPosition = positions[targetIndex];
      if (!targetPosition) continue;
      const line = new Graphics()
        .moveTo(positions[focus]!.x, positions[focus]!.y)
        .lineTo(targetPosition.x, targetPosition.y + 22)
        .stroke({ color: '#e1bd7c', alpha: 0.65, width: 1.5 });
      line.circle(targetPosition.x, targetPosition.y + 22, 5).fill('#e1bd7c');
      this.#app.stage.addChild(line);
    }

    const seal = label('弈', compact ? 40 : 65, '#c0a16d');
    seal.alpha = 0.19;
    seal.position.set(cx, cy - (compact ? 9 : 16));
    this.#app.stage.addChild(seal);
    const subtitle = label('一 局 · 一 世 界', compact ? 9 : 11, '#70837c');
    subtitle.position.set(cx, cy + (compact ? 24 : 39));
    this.#app.stage.addChild(subtitle);

    const portraits: string[] = [];
    this.#view.players.forEach((player, index) => {
      const position = positions[index];
      if (!position) return;
      const node = new Container();
      node.position.set(position.x, position.y);
      const self = player.self;
      const selected = this.#selection.targets.includes(player.id);
      const legal = this.#preview.targets.some(
        (target) => target.id === player.id && target.selectable,
      );
      const pw = position.width;
      const ph = position.height;
      node.alpha = !player.alive ? 0.3 : this.#selection.offer && !legal ? 0.6 : 1;
      const frame = new Graphics();
      frame
        .roundRect(-pw / 2, -ph / 2, pw, ph, 5)
        .fill({ color: '#172927', alpha: 0.96 })
        .stroke({
          color: selected ? '#e4bf7b' : legal ? '#8d845d' : '#3b4a40',
          width: selected ? 2 : 1,
        });
      frame
        .roundRect(-pw / 2 + 5, -ph / 2 + 5, pw - 10, ph - 10, 3)
        .stroke({ color: player.color, alpha: 0.16, width: 1 });
      node.addChild(frame);

      const texture = player.portrait ? this.#portraits.get(player.portrait) : undefined;
      const tiny = ph < 64;
      if (texture && !tiny) {
        portraits.push(player.id);
        const width = pw - 12;
        const height = ph - 12;
        const scale = Math.max(width / texture.width, height / texture.height);
        const cropWidth = Math.min(texture.width, width / scale);
        const cropHeight = Math.min(texture.height, height / scale);
        // 裁取纹理 UV，不创建 stencil mask；独立渲染器的销毁不影响此裁取。
        // 每帧只释放这个轻量视图，原始纹理源仍由 PortraitTextures 独占。
        const cropped = new Texture({
          source: texture.source,
          frame: new Rectangle((texture.width - cropWidth) / 2, 0, cropWidth, cropHeight),
        });
        const portrait = new Sprite(cropped);
        portrait.width = width;
        portrait.height = height;
        portrait.position.set(-width / 2, -height / 2);
        portrait.once('destroyed', () => cropped.destroy());
        node.addChild(portrait);
        // 信息带先于文字绘制，保证立绘明暗变化不影响角色与状态的可读性。
        const shade = new Graphics()
          .rect(-width / 2, -height / 2, width, height)
          .fill({ color: '#081817', alpha: 0.18 })
          .rect(-width / 2, -height / 2, width, compact ? 21 : 30)
          .fill({ color: '#081817', alpha: 0.72 })
          .rect(-width / 2, height / 2 - (compact ? 44 : 58), width, compact ? 44 : 58)
          .fill({ color: '#081817', alpha: 0.82 });
        node.addChild(shade);
      }

      if (player.alive && (player.chained || player.shield > 0)) {
        const status = [
          player.chained ? (ph < 64 ? '连' : '连环') : '',
          player.shield > 0 ? `盾${player.shield}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const marker = label(status, compact ? 8 : 10, '#e0b976');
        marker.position.set(0, -ph / 2 + (ph < 64 ? 10 : 38));
        node.addChild(marker);
      }

      if (!tiny) {
        if (!texture) {
          const silhouette = new Graphics();
          const s = Math.min(compact ? 0.58 : 1, (ph - 45) / 105);
          silhouette.ellipse(0, -12, 18, 23).fill({ color: player.color, alpha: 0.18 });
          silhouette
            .poly([-34, 39, -24, 13, -11, 4, 0, 15, 11, 4, 24, 13, 34, 39])
            .fill({ color: player.color, alpha: 0.16 });
          silhouette
            .poly([-22, -26, -17, -42, -5, -45, 0, -53, 5, -45, 17, -42, 22, -26])
            .fill({ color: player.color, alpha: 0.24 });
          silhouette.scale.set(s);
          silhouette.position.y = compact ? -10 : -14;
          node.addChild(silhouette);
        }
        const info = label(
          `${player.role ?? '未知'} · ${player.gender} · 手牌 ${player.handCount}`,
          compact ? 8 : 10,
          player.color,
        );
        info.style.letterSpacing = 0.5;
        info.position.set(0, -ph / 2 + (compact ? 12 : 20));
        node.addChild(info);
      }

      const name = label(
        tiny
          ? `${player.title || player.name} ${player.role?.slice(0, 1) ?? '·'} ${player.handCount}`
          : player.title || player.name,
        tiny ? 11 : compact ? 16 : 23,
        '#e0d3b9',
      );
      if (tiny) {
        name.style.letterSpacing = 1;
        name.scale.x = Math.min(1, (pw - 12) / name.width);
      }
      name.position.set(0, tiny ? -6 : ph / 2 - (compact ? 26 : 37));
      node.addChild(name);
      const hp = new Graphics();
      for (let i = 0; i < player.maxHp; i += 1)
        hp.roundRect((i - (player.maxHp - 1) / 2) * 12 - 3.5, 0, 7, 5, 1).fill(
          i < player.hp ? '#8eac85' : '#334640',
        );
      hp.position.set(0, ph / 2 - (tiny ? 9 : 15));
      node.addChild(hp);
      if (self) {
        const you = label('你', 12, '#9aa88b');
        you.position.set(pw / 2 - 17, 0);
        node.addChild(you);
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
    if (this.#app.renderer) this.#app.destroy(true, { children: true });
    this.#portraits.destroy();
  }
}
