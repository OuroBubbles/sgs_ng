<script lang="ts">
  import type { LobbyView } from '../../protocol';
  import { skinImage } from '../presentation/skin';

  const {
    lobby,
    message,
    onready,
    ongeneral,
  }: {
    lobby: LobbyView | null;
    message: string;
    onready: (enabled: boolean) => Promise<void>;
    ongeneral: (id: string) => Promise<void>;
  } = $props();
  const self = $derived(lobby?.lineup.find((player) => player.id === lobby.seat));
  const ready = $derived(lobby?.seats.find((seat) => seat.id === lobby.seat)?.ready ?? false);
  let busy = $state(false);
  async function send(action: () => Promise<void>) {
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  }
</script>

<section class="preparation-room" aria-label="联机准备">
  <div class="preparation-main">
    <header>
      <h2>等待同伴入席</h2>
      <p>{lobby ? lobby.deckName : '正在连接主持端…'}</p>
    </header>
    <div
      class="preparation-seats"
      role="group"
      aria-label="联机阵容"
      style={`--room-columns: ${Math.min(4, (lobby?.lineup.length ?? 2) > 4 ? Math.ceil((lobby?.lineup.length ?? 2) / 2) : (lobby?.lineup.length ?? 2))}`}
    >
      {#each lobby?.lineup ?? [] as player (player.id)}
        {@const seat = lobby?.seats.find((seat) => seat.id === player.id)}
        <article
          class="preparation-seat"
          class:self={player.id === lobby?.seat}
          class:ready={seat?.ready}
          class:empty={seat && !seat.connected}
        >
          <div class="preparation-portrait">
            <img src={player.portrait ?? skinImage('ui/photo/unknown.jpg')} alt="" /><strong
              >{player.general}</strong
            >{#if player.id === lobby?.seat}<span class="self-badge">你</span>{/if}
          </div>
          <span class="preparation-status"
            >{player.id} · {seat
              ? !seat.connected
                ? '等待加入'
                : seat.ready
                  ? '已准备'
                  : seat.editing
                    ? '已入席'
                    : '查看结果'
              : '基础 AI'}</span
          >
        </article>
      {/each}
    </div>
  </div>
  <aside class="preparation-settings">
    <h2>房间信息</h2>
    {#if lobby}
      <dl>
        <div>
          <dt>你的席位</dt>
          <dd>{lobby.seat}</dd>
        </div>
        <div>
          <dt>对局人数</dt>
          <dd>{lobby.lineup.length} 席</dd>
        </div>
        <div>
          <dt>玩家 / AI</dt>
          <dd>{lobby.seats.length} / {lobby.lineup.length - lobby.seats.length}</dd>
        </div>
        <div>
          <dt>下一局</dt>
          <dd>第 {lobby.round + 1} 局</dd>
        </div>
        <div>
          <dt>对局种子</dt>
          <dd>{lobby.seed}</dd>
        </div>
      </dl>
    {/if}
    {#if self && lobby}
      <label class="room-general"
        >我的武将<select
          value={self.generalId}
          disabled={busy}
          onchange={(event) => {
            const id = event.currentTarget.value;
            return send(() => ongeneral(id));
          }}
          >{#each lobby.generals as general (general.id)}<option value={general.id}
              >{general.name}</option
            >{/each}</select
        ></label
      >
    {/if}
    {#if message || lobby?.error}<p role="alert">{message || lobby?.error}</p>{/if}
    <button
      class="confirm-button"
      disabled={!lobby || busy}
      onclick={() => send(() => onready(!ready))}>{ready ? '取消准备' : '准备对局 →'}</button
    >
    <small>所有玩家准备后开局。选将会取消自己的准备；短暂断线可重连原席位。</small>
  </aside>
</section>

<style>
  .preparation-room {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 250px;
    gap: 24px;
  }
  .preparation-main,
  .preparation-settings {
    min-width: 0;
    padding: 24px;
    border: 1px solid #82906b50;
    border-radius: 8px;
    background: #101f1be6;
  }
  h2 {
    margin: 0 0 12px;
    font: 24px var(--fk-button);
    color: #e2c995;
  }
  p,
  small {
    color: #a3ae98;
    font-size: 12px;
    line-height: 1.8;
  }
  .preparation-seats {
    display: grid;
    grid-template-columns: repeat(var(--room-columns), minmax(0, 1fr));
    gap: 20px;
    margin-top: 24px;
  }
  .preparation-seat {
    min-width: 0;
    max-width: 175px;
    text-align: center;
  }
  .preparation-portrait {
    position: relative;
    aspect-ratio: 175/233;
    overflow: hidden;
    border: 1px solid #9f956a77;
    border-radius: 6px;
    box-shadow: 0 4px 15px #0006;
  }
  .preparation-portrait::after {
    content: '';
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 3px #14251f99;
    pointer-events: none;
  }
  .preparation-portrait img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .preparation-portrait strong {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(transparent, #0d1915ef 30%);
    padding: 30px 4px 10px;
    font: 23px var(--fk-name);
    color: #ead5a4;
  }
  .self .preparation-portrait {
    border-color: #d8bc7b;
  }
  .ready .preparation-portrait {
    border-color: #92ba6d;
    box-shadow: 0 0 14px #79b04b3b;
  }
  .empty img {
    opacity: 0.38;
  }
  .self-badge {
    position: absolute;
    right: 5px;
    top: 5px;
    border-radius: 50%;
    background: #c4a763;
    color: #15251c;
    padding: 5px 7px;
    font-size: 11px;
  }
  .preparation-status {
    display: block;
    margin-top: 10px;
    color: #a9b29c;
    font-size: 12px;
  }
  .ready .preparation-status {
    color: #b6d28e;
  }
  dl {
    margin: 22px 0;
  }
  dl > div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid #7f8b692b;
    font-size: 12px;
  }
  dt {
    color: #9ca78f;
  }
  dd {
    color: #e0cfaa;
    margin: 0;
  }
  .room-general {
    display: block;
    color: #b1baa5;
    font-size: 12px;
    margin: 20px 0;
  }
  select {
    width: 100%;
    max-width: none;
    min-height: 42px;
    margin-top: 8px;
    padding: 8px;
    background: #0c1916;
    color: #e2d8ba;
    border: 1px solid #7f8b6955;
    border-radius: 4px;
  }
  .confirm-button {
    width: 100%;
    min-height: 46px;
    margin: 12px 0;
    font-size: 16px;
  }
  small {
    display: block;
    font-size: 11px;
  }
  [role='alert'] {
    color: #f0b59c;
  }
  @media (max-width: 1100px) {
    .preparation-room {
      grid-template-columns: minmax(0, 1fr) 210px;
      gap: 14px;
    }
    .preparation-main,
    .preparation-settings {
      padding: 18px;
    }
    .preparation-seats {
      gap: 12px;
    }
  }
  @media (max-width: 700px) {
    .preparation-room {
      grid-template-columns: 1fr;
    }
    .preparation-seats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .preparation-status {
      font-size: 10px;
    }
    .preparation-portrait strong {
      font-size: 18px;
    }
    dl {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 16px;
    }
  }
  @media (max-width: 420px) {
    .preparation-seats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
