<script lang="ts">
  import { onMount } from 'svelte';
  import type { CardView } from '../../protocol';
  import CardFace from './CardFace.svelte';

  const { card, onclose }: { card: CardView; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => {
    dialog.showModal();
  });

  function close() {
    dialog.close();
    onclose();
  }
</script>

<dialog
  class="card-inspector"
  bind:this={dialog}
  aria-labelledby="card-info-title"
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
>
  <button class="icon-button inspector-close" aria-label="关闭牌面详情" onclick={close}>×</button>
  <div
    class="playing-card inspected-card"
    class:red={card.color === 'red' ||
      (card.color === undefined && (card.suit === '♥' || card.suit === '♦'))}
    aria-hidden="true"
  >
    <CardFace {card} />
  </div>
  <div class="card-rule">
    <span class="eyebrow">CARD / {card.suit}{card.rank}</span>
    <h2 id="card-info-title">【{card.name}】</h2>
    <p>{card.description}</p>
    <small>具体合法目标与使用条件以当前决策为准。</small><button
      class="subtle-button"
      onclick={close}>返回选择</button
    >
  </div>
</dialog>
