<script lang="ts">
  import type { SkillView, OfferView } from '../../core/view/game';
  import SkillButton from './SkillButton.svelte';

  const {
    skills,
    offers,
    selected,
    onselect,
    oninspect,
  }: {
    skills: readonly SkillView[];
    offers: readonly OfferView[];
    selected: string | null;
    onselect: (id: string) => void;
    oninspect: () => void;
  } = $props();
  const enabled = $derived(offers.filter((offer) => offer.kind !== 'physical'));
  const disabled = $derived(
    skills.filter((skill) => skill.active && !enabled.some((offer) => offer.skill === skill.id)),
  );
  const passive = $derived(skills.filter((skill) => !skill.active));
</script>

<!-- FreeKill SkillArea：主动/转换键两列，被动名称三列；当前请求是可发动性的唯一来源。 -->
<div
  class="skill-area"
  style:--skill-columns={Math.min(2, Math.max(1, enabled.length + disabled.length))}
>
  <div class="skill-actions" data-selection-input>
    {#each enabled as offer (offer.id)}<SkillButton
        label={offer.label}
        description={offer.description}
        selected={selected === offer.id}
        onclick={() => onselect(offer.id)}
      />{/each}
    {#each disabled as skill (skill.id)}<SkillButton
        label={skill.name}
        description={skill.description}
        disabled
        ineffective={!skill.effective}
        onclick={oninspect}
      />{/each}
  </div>
  <div class="skill-passives">
    {#each passive as skill (skill.id)}<SkillButton
        label={skill.name}
        description={skill.description}
        passive
        ineffective={!skill.effective}
        onclick={oninspect}
      />{/each}
  </div>
</div>

<style>
  .skill-area {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 3px;
    font-family: var(--fk-button);
    width: max-content;
    max-width: 100%;
    margin-left: auto;
    padding: 2px 12px 17px 8px;
  }
  .skill-actions {
    display: grid;
    grid-template-columns: repeat(var(--skill-columns), max-content);
    gap: 2px;
  }
  .skill-passives {
    display: grid;
    grid-template-columns: repeat(3, max-content);
    gap: 2px;
  }
  @media (max-width: 700px), (max-height: 600px) {
    .skill-actions {
      grid-template-columns: max-content;
    }
  }
</style>
