<script lang="ts">
  import { skinImage } from '../presentation/skin';

  const {
    label,
    description,
    selected = false,
    disabled = false,
    passive = false,
    ineffective = false,
    onclick,
  }: {
    label: string;
    description: string;
    selected?: boolean;
    disabled?: boolean;
    passive?: boolean;
    ineffective?: boolean;
    onclick: () => void;
  } = $props();
</script>

<!-- FreeKill SkillButton：80×36 命中区，150×80 原图以 0.66 倍外扩，不拉伸底图。 -->
<button
  class="skill-button"
  class:passive
  class:active={selected}
  class:ineffective
  {disabled}
  aria-pressed={passive ? undefined : selected}
  aria-label={passive ? `查看${label}技能说明` : undefined}
  title={description}
  style:--label-size={`${Math.max(26 - label.length, 18)}px`}
  {onclick}
>
  {#if !passive}<img
      class="skill-back"
      src={skinImage(`ui/skill/${disabled ? 'disabled' : selected ? 'pressed' : 'normal'}.png`)}
      alt=""
    />{/if}
  <span>{label}</span>
  {#if ineffective}<img class="skill-lock" src={skinImage('ui/skill/locked.png')} alt="" />{/if}
</button>

<style>
  .skill-button {
    position: relative;
    isolation: isolate;
    min-width: 80px;
    height: 36px;
    padding: 5px 4px 0;
    overflow: visible;
    font: bold var(--label-size) var(--fk-button);
    white-space: nowrap;
    border: 0;
    background: none;
  }
  .skill-back {
    position: absolute;
    left: -7.42px;
    top: -1.53px;
    width: 99px;
    height: 52.8px;
    z-index: -1;
    pointer-events: none;
  }
  .skill-button span {
    display: inline-block;
    color: transparent;
    background: linear-gradient(#fef7c2, #d2ad4a 80%, #be9878);
    background-clip: text;
    filter: drop-shadow(0 0 2px black) drop-shadow(0 1px 1px black);
  }
  .skill-button.ineffective span {
    background-image: linear-gradient(#ccc8c4, #a09691 80%, #787173);
  }
  .passive {
    min-width: 0;
    height: 24px;
    padding: 2px;
  }
  .skill-lock {
    position: absolute;
    width: 32px;
    height: 32px;
    object-fit: contain;
    left: calc(50% - 16px);
    top: calc(50% - 16px);
    opacity: 0.8;
    pointer-events: none;
  }
</style>
