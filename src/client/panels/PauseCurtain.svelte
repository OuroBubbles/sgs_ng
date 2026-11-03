<script lang="ts">
  import { onMount } from 'svelte';
  const {
    onresume,
    onexit,
    online = false,
    delegated = false,
  }: {
    onresume: () => void;
    onexit: () => void | Promise<void>;
    online?: boolean;
    delegated?: boolean;
  } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => dialog.showModal());
</script>

<dialog
  bind:this={dialog}
  class="pause-curtain"
  aria-labelledby="pause-title"
  oncancel={(event) => event.preventDefault()}
>
  <span class="eyebrow">{online ? 'ONLINE / HIDDEN' : 'OFFLINE / PAUSED'}</span>
  <h2 id="pause-title">{online ? '手牌已隐藏' : '对局已暂停'}</h2>
  <p>
    {online
      ? delegated
        ? '本席由基础 AI 继续行动，恢复显示后可收回操作。'
        : '牌局继续运行；轮到你的选择时会等待回答。'
      : '手牌已隐藏，AI 会等待你回来。'}
  </p>
  <button class="confirm-button" onclick={onresume}>{online ? '恢复手牌' : '继续对局'}</button>
  <button class="subtle-button exit-match" onclick={onexit}
    >{online ? '离开房间' : '结束本局，返回大厅'}</button
  >
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 36px;
    text-align: center;
    color: var(--text);
    background: #192e25;
    border: 1px solid #98845277;
    border-radius: 8px;
  }
  dialog::backdrop {
    background: #0c1916ed;
    backdrop-filter: blur(12px);
  }
  h2 {
    font: 28px var(--serif);
    color: #e3c68a;
  }
  p {
    font-size: 12px;
    color: #a6b49c;
    margin: 24px 0;
  }
  .exit-match {
    display: block;
    margin: 16px auto 0;
  }
</style>
