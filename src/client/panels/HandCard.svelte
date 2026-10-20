<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CardView } from '../../core/view/table';
  import CardFace from './CardFace.svelte';

  const {
    card,
    index,
    selected,
    available = true,
    compact = false,
    onselect,
    oninspect,
  }: {
    card: CardView;
    index: number;
    selected: boolean;
    available?: boolean;
    compact?: boolean;
    onselect: () => void;
    oninspect: () => void;
  } = $props();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin = { x: 0, y: 0 };
  let suppressClickUntil = 0;

  function clearHold() {
    clearTimeout(timer);
  }

  function pointerdown(event: PointerEvent) {
    if (event.pointerType !== 'touch') return;
    origin = { x: event.clientX, y: event.clientY };
    clearHold();
    timer = setTimeout(() => {
      suppressClickUntil = performance.now() + 500;
      oninspect();
    }, 500);
  }

  onDestroy(clearHold);
</script>

<button
  class="playing-card"
  class:compact
  class:chosen={selected}
  class:red={card.color === 'red' ||
    (card.color === undefined && (card.suit === '♥' || card.suit === '♦'))}
  class:response={card.kind === 'dodge'}
  class:unavailable={!available}
  data-testid={`card-${card.id}`}
  aria-label={`${card.name} ${card.suit}${card.rank}`}
  aria-pressed={selected}
  aria-disabled={!available}
  title={`${card.description} 右键或长按查看。`}
  onclick={() => {
    if (performance.now() >= suppressClickUntil) onselect();
  }}
  onpointerdown={pointerdown}
  onpointermove={(event) => {
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) clearHold();
  }}
  onpointerup={clearHold}
  onpointercancel={clearHold}
  oncontextmenu={(event) => {
    event.preventDefault();
    clearHold();
    oninspect();
  }}><CardFace {card} shortcut={index + 1} /></button
>

<style>
  .compact {
    width: 102px;
    height: 38px;
    flex-shrink: 0;
  }
  .compact.chosen {
    transform: translateY(-2px);
  }
  .compact :global(.card-art),
  .compact :global(.card-type),
  .compact :global(.card-bottom) {
    display: none;
  }
  .compact :global(.card-rank) {
    top: 4px;
    left: 5px;
    font-size: 11px;
    line-height: 1;
  }
  .compact :global(.card-rank small) {
    font-size: 9px;
  }
  .compact :global(.card-name) {
    bottom: 11px;
    left: 22px;
    width: 74px;
    font-size: 13px;
  }
  .compact :global(.card-shortcut) {
    bottom: 1px;
    right: 4px;
    font-size: 8px;
  }
</style>
