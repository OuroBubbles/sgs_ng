import type { GameView, LogView } from '../../core/view/game';

const effects = import.meta.glob<string>('../../assets/freekill/audio/system/*.mp3', {
  eager: true,
  import: 'default',
  query: '?url',
});
const effectNames = {
  start: 'gamestart',
  draw: 'draw',
  damage: 'normal_damage',
  'fire-damage': 'fire_damage',
  'thunder-damage': 'thunder_damage',
  'lose-hp': 'losehp',
  chain: 'chain',
} as const;

/** 一个有界声道：不截断当前片段，暂停后丢弃待播内容。 */
class AudioChannel {
  readonly #audio = new Audio();
  readonly #limit: number;
  #queue: string[] = [];
  #playing = false;
  #generation = 0;

  constructor(volume: number, limit: number) {
    this.#limit = limit;
    this.#audio.volume = volume;
    this.#audio.preload = 'none';
    this.#audio.onended = this.#audio.onerror = () => {
      this.#playing = false;
      this.#next();
    };
  }

  enqueue(urls: readonly string[]): void {
    this.#queue = [...this.#queue, ...urls].slice(-this.#limit);
    this.#next();
  }

  #next(): void {
    if (this.#playing || !this.#queue.length) return;
    this.#audio.src = this.#queue.shift()!;
    this.#playing = true;
    const generation = ++this.#generation;
    // 自动播放限制或设备静音不会改变结算，也不形成应用故障。
    void this.#audio.play().catch(() => {
      if (generation !== this.#generation) return;
      this.#playing = false;
      this.#queue = [];
    });
  }

  stop(): void {
    this.#generation++;
    this.#audio.pause();
    this.#playing = false;
    this.#queue = [];
  }

  destroy(): void {
    this.stop();
    this.#audio.onended = this.#audio.onerror = null;
    this.#audio.removeAttribute('src');
    this.#audio.load();
  }
}

/** 消费公开投影；不等待音频推进规则，也不在恢复页面时补播旧事实。 */
export class GameAudio {
  readonly #intro = new AudioChannel(0.15, 1);
  readonly #voice = new AudioChannel(0.75, 4);
  readonly #effect = new AudioChannel(0.3, 1);
  #seen = 0;
  #running = false;

  update(view: GameView, audible: boolean): void {
    const latest = view.log.at(-1)?.seq ?? 0;
    const fresh = view.log.filter((entry) => entry.seq > this.#seen);
    this.#seen = Math.max(this.#seen, latest);
    const started = !this.#running && view.status === 'running';
    this.#running = view.status === 'running';
    if (!audible || view.paused || view.handoff || !['running', 'ended'].includes(view.status)) {
      this.stop();
      return;
    }
    if (started) {
      const intro = effects['../../assets/freekill/audio/system/gamestart.mp3'];
      if (intro) this.#intro.enqueue([intro]);
    }
    let effect: NonNullable<LogView['audio']>['effect'];
    const voices: string[] = [];
    for (const entry of fresh) {
      if (entry.audio?.effect) effect = entry.audio.effect;
      if (entry.audio?.voice) voices.push(entry.audio.voice);
    }
    if (effect) {
      const name =
        effect === 'finish'
          ? view.result?.winners.includes(view.viewer ?? '')
            ? 'win'
            : 'lose'
          : effectNames[effect];
      const url = effects['../../assets/freekill/audio/system/' + name + '.mp3'];
      if (url) this.#effect.enqueue([url]);
    }
    // 快速 AI 结算不能留下数分钟的过期语音；只保留最近四条待播语音。
    this.#voice.enqueue(voices);
  }

  stop(): void {
    this.#intro.stop();
    this.#voice.stop();
    this.#effect.stop();
  }

  reset(): void {
    this.stop();
    this.#seen = 0;
    this.#running = false;
  }

  destroy(): void {
    this.#intro.destroy();
    this.#voice.destroy();
    this.#effect.destroy();
  }
}
