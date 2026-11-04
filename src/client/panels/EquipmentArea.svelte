<script lang="ts">
  import type { SeatView, CardView } from '../../protocol';

  import { skinImage } from '../presentation/skin';
  import HandCard from './HandCard.svelte';

  const {
    player,
    selectedCards,
    handCount,
    available,
    oncard,
    oninspect,
  }: {
    player: SeatView;
    selectedCards: readonly string[];
    handCount: number;
    available: (id: string) => boolean;
    oncard: (card: CardView) => void;
    oninspect: (card: CardView) => void;
  } = $props();
  const extras = $derived(
    player.equipment.filter(
      (card) =>
        !['weapon', 'armor', 'defensive-horse', 'offensive-horse'].includes(card.slot ?? ''),
    ),
  );
  function cell(card: CardView): string {
    const offset = extras.length;
    if (card.slot === 'weapon') return `${offset + 1} / 1 / ${offset + 2} / 3`;
    if (card.slot === 'armor') return `${offset + 2} / 1 / ${offset + 3} / 3`;
    if (card.slot === 'defensive-horse') return `${offset + 3} / 1 / ${offset + 4} / 2`;
    if (card.slot === 'offensive-horse') return `${offset + 3} / 2 / ${offset + 4} / 3`;
    return `${1 + extras.indexOf(card)} / 1 / ${2 + extras.indexOf(card)} / 3`;
  }
</script>

<!-- FreeKill EquipArea：扩展槽、武器、防具、双坐骑，整块使用 Photo 的原始坐标。 -->
{#if player.equipment.length}
  <img class="equipment-backdrop" src={skinImage('ui/equipment.png')} alt="" />
  <div
    class="equipment-area"
    style:grid-template-rows={`repeat(${3 + extras.length}, 1fr)`}
    data-testid={`equipment-${player.id}`}
    aria-label={`${player.name}的装备`}
    role="group"
  >
    {#each player.equipment as card, i (card.id)}
      <div
        class="equipment-slot"
        data-selection-input={(player.self && available(card.id)) || undefined}
        class:horse={card.slot?.endsWith('-horse')}
        style:grid-area={cell(card)}
      >
        <HandCard
          {card}
          compact
          index={player.self ? handCount + i : -1}
          compactLabel={card.slot === 'defensive-horse'
            ? '+1'
            : card.slot === 'offensive-horse'
              ? '-1'
              : undefined}
          selected={player.self && selectedCards.includes(card.id)}
          available={!player.self || available(card.id)}
          onselect={() => oncard(card)}
          oninspect={() => oninspect(card)}
        />
      </div>
    {/each}
  </div>
{/if}

<style>
  .equipment-backdrop {
    position: absolute;
    left: 30.6667px;
    top: 121.3333px;
    width: 138px;
    height: 106px;
    pointer-events: none;
  }
  .equipment-area {
    position: absolute;
    left: 30.6667px;
    top: 157.3333px;
    width: 137.3333px;
    height: 70.6667px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    pointer-events: auto;
  }
  .equipment-slot {
    min-width: 0;
    min-height: 0;
  }
  .equipment-slot :global(.playing-card.compact) {
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    transform: none;
    color: white;
    overflow: hidden;
    font-family: var(--fk-name);
    text-shadow: 0 1px 2px black;
  }
  .equipment-slot :global(.playing-card.compact::before) {
    display: none;
  }
  .equipment-slot :global(.playing-card.compact.chosen) {
    outline: 2px solid #f9df67;
    outline-offset: -2px;
    background: #e4bc572b;
  }
  .equipment-slot :global(.zone-icon) {
    width: 28px;
    height: 22px;
    left: 4px;
    top: calc(50% - 11px);
    transform: none;
    object-fit: contain;
  }
  .equipment-slot :global(.zone-suit) {
    display: flex;
    align-items: center;
    gap: 1px;
    right: 0;
    top: 0;
    bottom: auto;
    font-size: 16px;
    line-height: 1;
  }
  .equipment-slot :global(.zone-suit img) {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }
  .equipment-slot :global(.card-name) {
    left: 28px;
    top: 50%;
    transform: translateY(-50%);
    bottom: auto;
    width: calc(100% - 60px);
    font-size: 16px;
    line-height: 1.1;
    letter-spacing: -1px;
    text-align: left;
  }
  .equipment-slot.horse :global(.card-name) {
    left: 22px;
    width: 22px;
    font-size: 14px;
  }
  .equipment-slot.horse :global(.zone-suit) {
    gap: 0;
    font-size: 12px;
  }
  .equipment-slot.horse :global(.zone-suit img) {
    width: 12px;
    height: 12px;
  }
  .equipment-slot :global(.card-shortcut) {
    display: none;
  }
</style>
