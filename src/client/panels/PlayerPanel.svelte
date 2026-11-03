<script lang="ts">
  import type { SeatView } from '../../core/view/game';
  import type { CardView } from '../../core/view/table';
  import { photoLayout, type SeatRect } from '../table/layout';
  import { photoFrames, skinImage } from '../presentation/skin';
  import FrameSequence from '../presentation/FrameSequence.svelte';
  import SeatStatus from './SeatStatus.svelte';
  import EquipmentArea from './EquipmentArea.svelte';
  import HandCard from './HandCard.svelte';

  const {
    player,
    seat,
    index,
    selected,
    selectable,
    choosing,
    order,
    active,
    animated,
    selectedCards,
    handCount,
    available,
    onselect,
    oncard,
    oninspect,
  }: {
    player: SeatView;
    seat: SeatRect;
    index: number;
    selected: boolean;
    selectable: boolean;
    choosing: boolean;
    order?: number | undefined;
    active: boolean;
    animated: boolean;
    selectedCards: readonly string[];
    handCount: number;
    available: (id: string) => boolean;
    onselect: () => void;
    oncard: (card: CardView) => void;
    oninspect: (card: CardView) => void;
  } = $props();
  const geometry = $derived(photoLayout(seat));
  const playing = photoFrames('playing'),
    chosen = photoFrames('selected'),
    candidate = photoFrames('selectable');
</script>

<div
  class="player-panel"
  style={`left:${geometry.frame.left}px;top:${geometry.frame.top}px;width:${geometry.frame.width}px;height:${geometry.frame.height}px;--photo-scale:${geometry.scale}`}
>
  <div class="photo-content">
    <button
      class="target-hitbox"
      class:self={player.self}
      class:selected
      class:available={selectable}
      class:unavailable={choosing && !selectable}
      data-seat={index}
      data-selection-input
      data-testid={`target-${player.id}`}
      data-chained={player.chained}
      data-shield={player.shield}
      aria-label={`${player.name}${player.title ? `·${player.title}` : ''}，性别${player.gender}，${player.alive ? `体力${player.hp}/${player.maxHp}，手牌${player.handCount}，护盾${player.shield}` : '已阵亡'}，${player.role ?? '身份未知'}${player.alive && player.chained ? '，连环' : ''}${order ? `，选择顺序${order}` : ''}`}
      aria-pressed={selected}
      aria-disabled={!selectable}
      onclick={onselect}
    >
      {#if active}<span class="photo-effect"><FrameSequence frames={playing} {animated} /></span
        >{/if}
      {#if selected}<span class="photo-effect"><FrameSequence frames={chosen} {animated} /></span>
      {:else if selectable}<span class="photo-effect selectable"
          ><FrameSequence frames={candidate} {animated} /></span
        >{/if}
      <SeatStatus {player} {index} {animated} />
      {#if choosing && !selectable && !selected}<img
          class="disable-layer"
          src={skinImage('ui/photo/disable.png')}
          alt=""
        />{/if}
      {#if order}<span class="target-state">{order}</span>{/if}
    </button>
    <EquipmentArea {player} {selectedCards} {handCount} {available} {oncard} {oninspect} />
    {#if player.judgment.length}<div
        class="judgment-area"
        data-testid={`judgment-${player.id}`}
        role="group"
        aria-label={`${player.name}的判定区`}
      >
        {#each player.judgment as card (card.id)}<HandCard
            {card}
            compact
            mark
            index={-1}
            selected={false}
            onselect={() => oninspect(card)}
            oninspect={() => oninspect(card)}
          />{/each}
      </div>{/if}
  </div>
</div>

<style>
  .player-panel {
    position: absolute;
    pointer-events: none;
  }
  .photo-content {
    position: relative;
    width: 175px;
    height: 233px;
    transform: scale(var(--photo-scale));
    transform-origin: top left;
  }
  .target-hitbox {
    position: absolute;
    inset: 0;
    width: 175px;
    height: 233px;
    transform: none;
    overflow: visible;
    background: none;
    border: 0;
    border-radius: 0;
    box-shadow: none !important;
  }
  .photo-effect {
    position: absolute;
    width: 220px;
    height: 281.6px;
    left: -22.5px;
    top: -24.3px;
    pointer-events: none;
  }
  .photo-effect.selectable {
    width: 173px;
    height: 178px;
    left: 1px;
    top: 27.5px;
  }
  .disable-layer {
    position: absolute;
    left: 30.6667px;
    top: -21.3333px;
    width: 138px;
    height: 254px;
    pointer-events: none;
  }
  .target-state {
    position: absolute;
    left: 72px;
    top: 78px;
    color: #fefe84;
    font: 36px var(--fk-button);
    text-shadow:
      0 0 4px black,
      0 0 2px black;
    pointer-events: none;
  }
  .judgment-area {
    position: absolute;
    left: 0;
    top: 221.3333px;
    display: flex;
    pointer-events: auto;
  }
  .judgment-area :global(.playing-card) {
    flex: none;
    width: 37.6px;
    height: 44px;
    margin-right: -5px;
  }
</style>
