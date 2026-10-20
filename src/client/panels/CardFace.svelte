<script lang="ts">
  import type { CardView } from '../../core/view/table';
  const { card, shortcut }: { card: CardView; shortcut?: number } = $props();
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
{#if shortcut}<span class="card-shortcut">{shortcut}</span>{/if}

<style>
  .card-name.long-name {
    font-size: clamp(12px, calc((100cqw - 14px) / var(--name-length)), 25px);
    white-space: nowrap;
  }
</style>
