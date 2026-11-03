<script lang="ts">
  import type { CardView } from '../../core/view/table';
  import { numberImage, suitImage } from '../presentation/skin';
  const {
    card,
    shortcut,
    compact = false,
  }: { card: CardView; shortcut?: number; compact?: boolean } = $props();
  const number = $derived(
    numberImage(
      card.rank,
      card.color === 'red' ||
        (card.color === undefined && (card.suit === '♥' || card.suit === '♦')),
    ),
  );
  let failedImage = $state<string | null>(null);
  const motifs = {
    slash: ['戈', '攻其不备'],
    peach: ['寿', '生生不息'],
    dodge: ['风', '避其锋芒'],
    duel: ['争', '一决高下'],
    draw: ['策', '运筹帷幄'],
    trick: ['谋', '虚实相生'],
    equipment: ['器', '锋芒在握'],
    other: ['弈', '变化无穷'],
  };
</script>

{#if card.image && card.image !== failedImage && !compact}
  <span class="illustrated-face" aria-hidden="true">
    <img
      class="card-picture"
      src={card.image}
      alt=""
      onerror={(event) => {
        failedImage = event.currentTarget.getAttribute('src');
      }}
    />
    {#if number}<img class="printed-number" src={number} alt="" />{/if}
    <img
      class="printed-suit"
      class:without-number={!number}
      src={suitImage(card.suit, card.color)}
      alt=""
    />
  </span>
  <strong class="card-name sr-only">{card.name}</strong>
  <span class="card-rank sr-only">{card.rank}<small>{card.suit}</small></span>
{:else}
  <span class="card-rank">{card.rank}<small>{card.suit}</small></span>
  <span class="card-type"
    >{card.kind === 'equipment'
      ? '装备'
      : card.kind === 'duel' || card.kind === 'draw' || card.kind === 'trick'
        ? '锦囊'
        : '基本'}</span
  >
  <span class="card-art" aria-hidden="true"><i></i><b>{motifs[card.kind][0]}</b></span>
  <strong
    class="card-name"
    class:long-name={card.name.length > 2}
    style:--name-length={card.name.length}>{card.name}</strong
  >
  <span class="card-bottom">{motifs[card.kind][1]}</span>
{/if}
{#if shortcut}<span class="card-shortcut">{shortcut}</span>{/if}

<style>
  /* 卡面组件自己决定原图皮肤；手牌、公开牌、排序和详情不再各留一套旧内框。 */
  :global(.playing-card):has(> .illustrated-face) {
    border: 0;
    background: transparent;
    border-radius: 4px;
    box-shadow: 0 4px 9px #0005;
  }
  :global(.playing-card):has(> .illustrated-face)::before {
    display: none;
  }
  :global(.playing-card.chosen):has(> .illustrated-face) {
    box-shadow: 0 0 9px #fff9;
  }
  .illustrated-face {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: 4px;
  }
  .illustrated-face img {
    position: absolute;
    display: block;
  }
  .card-picture {
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .printed-number {
    left: 0;
    top: 0;
    width: 29.0323%;
    height: 21.5385%;
  }
  .printed-suit {
    left: 3.2258%;
    top: 14.6154%;
    width: 22.5806%;
    height: 13.0769%;
  }
  .printed-suit.without-number {
    top: 7.3077%;
  }
  .card-name.long-name {
    font-size: clamp(12px, calc((100cqw - 14px) / var(--name-length)), 25px);
    white-space: nowrap;
  }
</style>
