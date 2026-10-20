<script lang="ts">
  import { onMount } from 'svelte';
  const { onresume }: { onresume: () => void } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => dialog.showModal());
</script>

<dialog
  bind:this={dialog}
  class="pause-curtain"
  aria-labelledby="pause-title"
  oncancel={(event) => event.preventDefault()}
>
  <span class="eyebrow">OFFLINE / PAUSED</span>
  <h2 id="pause-title">对局已暂停</h2>
  <p>手牌已隐藏，AI 会等待你回来。</p>
  <button class="confirm-button" onclick={onresume}>继续对局</button>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
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
</style>
