<script lang="ts">
  import type { HostedRoom } from '../../platform/hosting';
  const {
    room,
    busy,
    open,
    onclose,
  }: {
    room: HostedRoom;
    busy: boolean;
    open: boolean;
    onclose: () => Promise<void>;
  } = $props();
  let copied = $state('');
  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      copied = '地址已复制';
    } catch {
      copied = '可选中地址后复制';
    }
  }
</script>

<details class="hosted-room-menu" {open}>
  <summary>房间地址</summary>
  <div class="hosted-room" aria-label="房间连接信息">
    <b>房间连接地址</b>
    <small
      >{room.setup.lineup.length} 席 · {room.setup.humans} 位玩家 · 房间种子 {room.setup
        .seed}</small
    >
    <small>同一局域网的玩家使用网卡地址。</small>
    {#each [...room.addresses, { name: '本机', address: room.local }] as endpoint (`${endpoint.name}:${endpoint.address}`)}
      <div class="host-address">
        <label
          >{endpoint.name}连接地址
          <input
            readonly
            value={endpoint.address}
            onfocus={(event) => event.currentTarget.select()}
          /></label
        >
        <button
          class="subtle-button"
          aria-label={`复制${endpoint.name}地址`}
          onclick={() => copy(endpoint.address)}>复制</button
        >
      </div>
    {/each}
    <small role="status">{copied}</small>
    <button class="subtle-button" disabled={busy} onclick={onclose}>关闭房间</button>
  </div>
</details>

<style>
  .hosted-room-menu {
    position: relative;
    font-size: 12px;
  }
  .hosted-room-menu summary {
    cursor: pointer;
    color: var(--gold);
    padding: 8px;
  }
  .hosted-room {
    position: absolute;
    z-index: 30;
    right: 0;
    top: calc(100% + 8px);
    background: #13271ffa;
    border: 1px solid #aa946344;
    box-shadow: 0 8px 30px #0007;
    max-height: 65vh;
    overflow-y: auto;
  }
  .hosted-room {
    display: grid;
    gap: 8px;
    min-width: 270px;
    padding: 14px;
  }
  .hosted-room small {
    color: var(--muted);
    font-size: 11px;
  }
  .host-address {
    display: flex;
    align-items: end;
    gap: 6px;
  }
  .host-address label {
    flex: 1;
    display: grid;
    gap: 3px;
    font-size: 11px;
  }
  .host-address input {
    width: 100%;
    min-width: 0;
    font-size: 12px;
  }
  .host-address button {
    padding: 7px;
  }
</style>
