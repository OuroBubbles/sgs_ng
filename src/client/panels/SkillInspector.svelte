<script lang="ts">
  import { onMount } from 'svelte';
  import type { SkillView } from '../../protocol';
  const {
    name,
    skills,
    onclose,
  }: { name: string; skills: readonly SkillView[]; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => dialog.showModal());
  function close() {
    dialog.close();
    onclose();
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="skill-title"
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
>
  <button class="icon-button close" aria-label="关闭技能说明" onclick={close}>×</button>
  <span class="eyebrow">GENERAL / SKILLS</span>
  <h2 id="skill-title">{name} · 技能</h2>
  {#each skills as skill (skill.id)}
    <section class:inactive={!skill.effective}>
      <h3>{skill.name}{skill.effective ? '' : ' · 当前未生效'}</h3>
      <p>{skill.description || '当前内容尚未提供技能说明。'}</p>
    </section>
  {/each}
</dialog>

<style>
  dialog {
    width: min(460px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow: auto;
    padding: 30px;
    border: 1px solid #98845277;
    border-radius: 8px;
    background: #192e25;
    color: var(--text);
  }
  dialog::backdrop {
    background: #0c1916d9;
    backdrop-filter: blur(8px);
  }
  .close {
    position: absolute;
    top: 12px;
    right: 12px;
  }
  h2 {
    font: 24px var(--serif);
    color: #dfc28a;
  }
  h3 {
    font: 18px var(--serif);
    margin: 22px 0 8px;
    color: #c9bf95;
  }
  p {
    font-size: 12px;
    line-height: 1.9;
    color: #b6c1ad;
    margin: 0;
  }
  .inactive {
    opacity: 0.55;
  }
</style>
