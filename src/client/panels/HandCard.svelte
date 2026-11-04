<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CardView, CardChoiceView } from '../../protocol';
  import CardFace from './CardFace.svelte';
  import { skinImage, suitImage } from '../presentation/skin';

  const {
    card,
    index,
    selected,
    available = true,
    compact = false,
    compactLabel,
    mark = false,
    onselect,
    oninspect,
  }: {
    card: CardView | CardChoiceView;
    index: number;
    selected: boolean;
    available?: boolean;
    compact?: boolean;
    compactLabel?: string | undefined;
    mark?: boolean;
    onselect: () => void;
    oninspect?: () => void;
  } = $props();
  const face = $derived('face' in card ? card.face : card);
  const label = $derived(
    face ? `${face.name} ${face.suit}${face.rank}` : 'label' in card ? card.label : card.name,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin = { x: 0, y: 0 };
  // 长按只抑制本次指针激活；下一次按下和键盘激活不需要等待。
  let suppressClick = false;

  function clearHold() {
    clearTimeout(timer);
  }

  function pointerdown(event: PointerEvent) {
    suppressClick = false;
    if (event.pointerType !== 'touch') return;
    origin = { x: event.clientX, y: event.clientY };
    clearHold();
    timer = setTimeout(() => {
      suppressClick = true;
      if (face) oninspect?.();
    }, 500);
  }

  onDestroy(clearHold);
</script>

<button
  class="playing-card"
  class:compact
  class:judgment={mark}
  class:zone-card={compact && Boolean(face?.icon)}
  class:chosen={selected}
  class:card-back={!face}
  class:red={face?.color === 'red' ||
    (face?.color === undefined && (face?.suit === '♥' || face?.suit === '♦'))}
  class:unavailable={!available}
  data-testid={`card-${card.id}`}
  aria-label={label}
  aria-pressed={selected}
  aria-disabled={!available}
  title={face
    ? `${face.description}${oninspect ? ' 右键或长按查看。' : ''}`
    : '牌面不可见。选择不会翻开手牌。'}
  onclick={(event) => {
    if (event.detail === 0 || !suppressClick) onselect();
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
    suppressClick = true;
    if (face) oninspect?.();
  }}
  >{#if compact && face?.icon}<img class="zone-icon" src={face.icon} alt="" /><span
      class="zone-suit"><span>{face.rank}</span><img src={suitImage(face.suit)} alt="" /></span
    >{/if}{#if face}<CardFace
      card={compactLabel ? { ...face, name: compactLabel } : face}
      shortcut={index + 1}
      {compact}
    />{:else}<span class="card-back-label">{label}</span><span class="card-shortcut"
      >{index + 1}</span
    >{/if}{#if selected && 'face' in card}<img
      class="choice-selected"
      src={skinImage('cards/chosen.png')}
      alt=""
    />{/if}{#if !available && !compact}<span class="unavailable-shade" aria-hidden="true"
    ></span>{/if}</button
>

<style>
  /* BasicCard 的黑色遮层：0.5 × 0.7，不改变卡面颜色，也用于私有/公共选牌。 */
  .unavailable-shade {
    position: absolute;
    inset: 0;
    background: #00000059;
    pointer-events: none;
    z-index: 2;
  }
  .playing-card:not(.compact):hover {
    box-shadow: 0 0 8px #ffffff88;
  }
  .choice-selected {
    position: absolute;
    left: 50%;
    top: 69.2308%;
    width: 84.6774%;
    height: auto;
    transform: translateX(-50%);
    pointer-events: none;
    z-index: 1;
  }
  .playing-card.card-back {
    border: 0;
    background: transparent;
    box-shadow: 0 4px 9px #0005;
    border-radius: 4px;
  }
  .playing-card.card-back::before {
    display: none;
  }
  .playing-card.card-back {
    background: url('../../assets/freekill/cards/card-back.png') center / 100% 100% no-repeat;
  }
  .card-back .card-back-label {
    visibility: hidden;
  }
  .playing-card.card-back:not(.chosen) {
    box-shadow: 0 4px 9px #0005;
  }
  .judgment.zone-card {
    background: none;
    border: 0;
    box-shadow: none;
    overflow: visible;
  }
  .judgment .zone-icon {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: none;
    object-fit: contain;
  }
  .judgment .zone-suit,
  .judgment :global(.card-rank),
  .judgment.zone-card :global(.card-name),
  .judgment :global(.card-shortcut) {
    display: none;
  }
  .judgment:not(.zone-card) :global(.card-name) {
    inset: 3px;
    width: calc(100% - 6px);
    height: auto;
    display: grid;
    place-items: center;
    font-size: 12px;
    line-height: 1.1;
    white-space: normal;
  }
  .compact {
    container-type: size;
    width: 102px;
    height: 38px;
    flex-shrink: 0;
  }
  .compact.chosen {
    transform: translateY(-2px);
  }
  .compact:hover {
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
  .compact.zone-card {
    background: #202820 url('../../assets/freekill/ui/equipment.png') center / 100% 100%;
    color: #efddb0;
    border-color: #918168;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px #91816855;
  }
  .compact.zone-card::before {
    display: none;
  }
  .compact.zone-card.chosen {
    box-shadow:
      0 0 0 2px #bc9b61,
      inset 0 0 0 1px #ead49b;
  }
  .zone-icon {
    position: absolute;
    left: 3px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    object-fit: contain;
  }
  .compact.zone-card :global(.card-name) {
    color: #efddb0;
    font-size: 12px;
    line-height: 1.1;
    letter-spacing: 0;
    left: 22px;
    width: calc(100% - 25px);
    top: 4px;
    bottom: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .compact.zone-card :global(.card-rank) {
    display: none;
  }
  .compact.zone-card :global(.card-shortcut) {
    color: #cbb98b;
  }
  .zone-suit {
    position: absolute;
    bottom: 2px;
    right: 15px;
    font-size: 10px;
  }
  .zone-suit {
    color: white;
  }
  .zone-suit img {
    width: 13px;
    height: 11px;
    object-fit: contain;
  }
  @container (max-height: 28px) {
    .zone-suit {
      display: none;
    }
    .zone-icon {
      width: 18px;
      height: 18px;
    }
    .compact.zone-card :global(.card-name) {
      top: 50%;
      transform: translateY(-50%);
    }
  }
</style>
