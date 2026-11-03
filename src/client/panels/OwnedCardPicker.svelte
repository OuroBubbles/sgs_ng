<script lang="ts">
  import type { CardChoiceGroupView, CandidateView } from '../../core/view/game';
  import type { CardView } from '../../core/view/table';
  import HandCard from './HandCard.svelte';

  const {
    groups,
    cards,
    selected,
    onselect,
    oninspect,
  }: {
    groups: readonly CardChoiceGroupView[];
    cards: readonly CandidateView[];
    selected: readonly string[];
    onselect: (id: string) => void;
    oninspect: (card: CardView) => void;
  } = $props();
</script>

<div class="owned-picker" data-testid="owned-card-picker">
  {#each groups as group (group.id)}
    <section aria-label={group.label}>
      <h2>{group.label}</h2>
      <div class="choice-cards">
        {#each group.cards as card (card.id)}
          <HandCard
            {card}
            index={cards.findIndex((item) => item.id === card.id)}
            selected={selected.includes(card.id)}
            available={cards.some((item) => item.id === card.id && item.selectable)}
            onselect={() => onselect(card.id)}
            oninspect={() => {
              if (card.face) oninspect(card.face);
            }}
          />
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .owned-picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  section {
    flex: none;
  }
  h2 {
    margin: 0 0 2px;
    color: #b6b78c;
    font-size: 11px;
    line-height: 14px;
    font-weight: 400;
  }
  .choice-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 14px 2px 2px;
  }
  .choice-cards :global(.playing-card) {
    width: auto;
    height: clamp(62px, 14vh, 130px);
    aspect-ratio: 93 / 130;
  }
</style>
