<script lang="ts">
  import { untrack } from 'svelte';
  import type { HostingState } from '../../platform/hosting';
  import type { RoomSetup } from '../../protocol';

  const {
    hosting,
    onconnect,
    oncreate,
    generals,
    decks,
    seats,
    initialSetup,
    initialPort,
  }: {
    hosting: HostingState;
    onconnect: (address: string) => void;
    oncreate: (port: number, setup: RoomSetup) => Promise<void>;
    generals: readonly { readonly id: string; readonly name: string }[];
    decks: readonly { readonly id: string; readonly label: string }[];
    seats: readonly string[];
    initialSetup: RoomSetup;
    initialPort: number;
  } = $props();
  let address = $state('http://127.0.0.1:1422');
  // 仅在重新进入开局页时恢复上次提交的配置；不覆盖用户正在编辑的草稿。
  const initial = untrack(() => ({ ...initialSetup, port: initialPort }));
  let port = $state(initial.port);
  let seed = $state(initial.seed);
  let preset = $state(initial.preset);
  let lineup = $state([...initial.lineup]);
  let humans = $state(initial.humans);
  let creating = $state(false);
  $effect(() => {
    if (!decks.some((deck) => deck.id === preset)) preset = decks[0]!.id;
    const next = lineup.map((id, i) =>
      generals.some((general) => general.id === id) ? id : generals[i % generals.length]!.id,
    );
    if (next.some((id, i) => id !== lineup[i])) lineup = next;
  });
  async function create() {
    creating = true;
    try {
      await oncreate(port, { seed, preset, lineup: [...lineup], humans });
    } finally {
      creating = false;
    }
  }
  function resize(count: number) {
    lineup = Array.from(
      { length: count },
      (_, i) => lineup[i] ?? generals[i % generals.length]!.id,
    );
    humans = Math.min(humans, count);
  }
</script>

<section class="network-join" aria-label="创建与加入房间">
  {#if hosting.supported}
    <div class="network-create">
      <span class="network-caption">邀友同席</span>
      <h2>创建房间</h2>
      <p>在本机主持一张牌桌，与好友及基础 AI 一起对局。</p>
      <form
        onsubmit={async (event) => {
          event.preventDefault();
          await create();
        }}
      >
        <div class="room-config">
          <label
            >联机席位
            <select
              value={lineup.length}
              onchange={(event) => resize(Number(event.currentTarget.value))}
            >
              {#each Array.from({ length: 7 }, (_, i) => i + 2) as count (count)}
                <option value={count}>{count} 席</option>
              {/each}
            </select>
          </label>
          <label
            >玩家人数
            <select bind:value={humans}>
              {#each Array.from({ length: lineup.length - 1 }, (_, i) => i + 2) as count (count)}
                <option value={count}>{count} 人</option>
              {/each}
            </select>
          </label>
          <label
            >联机牌组
            <select bind:value={preset}>
              {#each decks as deck (deck.id)}<option value={deck.id}>{deck.label}</option>{/each}
            </select>
          </label>
          <label
            >房间端口 <input
              type="number"
              min="0"
              max="65535"
              step="1"
              required
              bind:value={port}
            /></label
          >
          <label
            >对局种子 <input
              type="number"
              min="1"
              max="4294967295"
              step="1"
              required
              bind:value={seed}
            /></label
          >
        </div>
        <div class="room-lineup">
          {#each seats.slice(0, lineup.length) as seat, i (seat)}
            <label
              >{seat}武将
              <select bind:value={lineup[i]}>
                {#each generals as general (general.id)}<option value={general.id}
                    >{general.name}</option
                  >{/each}
              </select>
            </label>
          {/each}
        </div>
        <button class="confirm-button" disabled={creating || hosting.busy || !!hosting.room}>
          {creating || hosting.busy ? '正在创建…' : '创建房间 →'}
        </button>
      </form>
      <small
        >使用开局页选择的内置内容。前 {humans} 席由玩家加入，其余由基础 AI 行动。端口填 0 可自动分配。</small
      >
    </div>
  {/if}
  <div class="network-connect">
    <span class="network-caption">已有房间</span>
    <h2>加入房间</h2>
    <p>填写好友分享的主持端地址，连接后选择武将并准备。</p>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        onconnect(address);
      }}
    >
      <label
        >主持端地址 <input
          bind:value={address}
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="192.168.1.10:1422"
        /></label
      >
      <button class="confirm-button">连接主持端 →</button>
    </form>
    <small>同一局域网使用主持端的网卡地址。退出联机可返回大厅。</small>
    {#if !hosting.supported}
      <p class="network-platform-note">
        创建房间需使用 Windows 桌面程序；当前端可直接加入已有房间。
      </p>
    {/if}
  </div>
</section>

<style>
  .network-join {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(230px, 1fr);
    gap: 32px;
  }
  .network-connect:only-child {
    grid-column: 1 / -1;
  }
  .network-create,
  .network-connect {
    min-width: 0;
  }
  .network-caption {
    display: block;
    margin-bottom: 12px;
    font-size: 11px;
    color: #c5b17b;
    letter-spacing: 3px;
  }
  .network-platform-note {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid #a596642f;
  }
  @media (max-width: 1100px) {
    .network-join {
      grid-template-columns: minmax(0, 1fr);
    }
    .network-create {
      padding-bottom: 24px;
      border-bottom: 1px solid #a5966440;
    }
  }
  .room-config,
  .room-lineup {
    flex-basis: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .room-config label,
  .room-lineup label {
    min-width: 0;
  }
  .room-config select,
  .room-lineup select {
    max-width: none;
  }
</style>
