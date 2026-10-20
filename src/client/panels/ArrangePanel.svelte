<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ArrangementDraft, DecisionView } from '../../core/view/game';
  import type { CardView } from '../../core/view/table';
  import CardFace from './CardFace.svelte';

  const {
    decision,
    cards,
    onpreview,
    onconfirm,
    onpause,
    oncancel,
    privateContent,
  }: {
    decision: Extract<DecisionView, { kind: 'arrange' }>;
    cards: readonly CardView[];
    onpreview: (choice: ArrangementDraft) => { readonly valid: boolean; readonly reason: string };
    onconfirm: (choice: ArrangementDraft) => void;
    onpause: () => void;
    oncancel: () => void;
    privateContent: boolean;
  } = $props();
  let dialog: HTMLDialogElement;
  // 父组件以 Decision ID/token 为 key；暂停销毁面板，恢复时重新取得授权投影。
  const groups = $state(
    untrack(() => decision.groups.map((g) => ({ id: g.id, items: [...g.items] }))),
  );
  const choice = $derived({ groups: groups.map((g) => ({ id: g.id, items: [...g.items] })) });
  const preview = $derived(onpreview(choice));
  const distribution = $derived(decision.presentation === 'distribution');
  onMount(() => dialog.showModal());

  function shift(groupId: string, index: number, delta: number) {
    const group = groups.find((g) => g.id === groupId)!;
    const next = index + delta;
    if (next < 0 || next >= group.items.length) return;
    [group.items[index], group.items[next]] = [group.items[next]!, group.items[index]!];
  }
  function transfer(id: string, from: string, to: string) {
    groups.find((g) => g.id === from)!.items = groups
      .find((g) => g.id === from)!
      .items.filter((item) => item !== id);
    groups.find((g) => g.id === to)!.items.push(id);
  }
</script>

<dialog
  bind:this={dialog}
  class="arrange-panel"
  class:distribution
  aria-labelledby="arrange-title"
  oncancel={(event) => {
    event.preventDefault();
    if (decision.optional) oncancel();
  }}
>
  <header>
    <div>
      <span class="eyebrow">{privateContent ? 'PRIVATE · 仅你可见' : 'ORDER · 顺序调整'}</span>
      <h2 id="arrange-title">{decision.prompt}</h2>
    </div>
    <button class="subtle-button" onclick={onpause}>暂停并隐藏</button>
  </header>
  <p>
    {distribution
      ? '将牌分到各组，请遵守各组标注的数量限制。'
      : '每组从左向右依次排列。使用箭头调整先后，或将牌移到另一组。'}
  </p>
  <div class="arrange-groups">
    {#each groups as group (group.id)}
      {@const definition = decision.groups.find((g) => g.id === group.id)!}
      <section aria-label={definition.label} data-testid={`arrange-${group.id}`}>
        <h3>
          {definition.label} <span>{group.items.length} 张</span>
          {#if definition.count.min > 0}<small>至少 {definition.count.min} 张</small>{/if}
          {#if definition.count.max !== 'all'}<small>至多 {definition.count.max} 张</small>{/if}
        </h3>
        <div class="arrange-items">
          {#each group.items as id, index (id)}
            {@const item = decision.items.find((item) => item.id === id)!}
            {@const card = cards.find((card) => card.id === id)}
            <article data-item-id={id} aria-label={`${index + 1} · ${item.label}`}>
              {#if !distribution}<div class="order-number">{index + 1}</div>{/if}
              {#if card}<div class="playing-card arrange-card" class:red={card.color === 'red'}>
                  <CardFace {card} />
                </div>
              {:else}<div class="item-label">{item.label}</div>{/if}
              {#if !distribution}<div class="arrows">
                  <button
                    aria-label={`前移 ${item.label}`}
                    disabled={index === 0}
                    onclick={() => shift(group.id, index, -1)}>←</button
                  >
                  <button
                    aria-label={`后移 ${item.label}`}
                    disabled={index === group.items.length - 1}
                    onclick={() => shift(group.id, index, 1)}>→</button
                  >
                </div>{/if}
              {#each decision.groups.filter((g) => g.id !== group.id) as destination (destination.id)}
                <button
                  class="transfer"
                  disabled={decision.destinations
                    ? !decision.destinations[id]?.includes(destination.id)
                    : false}
                  onclick={() => transfer(id, group.id, destination.id)}
                  >{distribution ? '分给' : '移至'}{destination.label}</button
                >
              {/each}
            </article>
          {/each}
          {#if !group.items.length}<span class="empty-group">本组留空</span>{/if}
        </div>
      </section>
    {/each}
  </div>
  <footer>
    <span aria-live="polite">{preview.valid ? '全部牌已分配，可以确认' : preview.reason}</span>
    {#if decision.optional}<button class="cancel-button" onclick={oncancel}>取消</button>{/if}
    <button class="confirm-button" disabled={!preview.valid} onclick={() => onconfirm(choice)}
      >{distribution ? '确认分配' : '确认顺序'}</button
    >
  </footer>
</dialog>

<style>
  .arrange-panel {
    width: min(850px, calc(100vw - 28px));
    max-height: calc(100dvh - 24px);
    padding: 20px;
    box-sizing: border-box;
    border: 1px solid #736d4c;
    border-radius: 16px;
    background: #152722;
    color: #f1ebd7;
    overflow: auto;
  }
  .arrange-panel::backdrop {
    background: #081511d9;
    backdrop-filter: blur(6px);
  }
  header,
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  h2 {
    margin: 5px 0;
    font-size: 20px;
  }
  p {
    margin: 6px 0 16px;
    color: #b3bfad;
    font-size: 13px;
  }
  .arrange-groups {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .distribution .arrange-groups {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .distribution section {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 8px;
  }
  .distribution .arrange-items {
    min-height: 25px;
  }
  .distribution h3 span {
    display: block;
    margin: 4px 0;
  }
  .distribution h3 small {
    display: block;
    font-size: 11px;
  }
  .distribution .transfer {
    font-size: 11px;
    padding-inline: 2px;
    white-space: nowrap;
  }
  .distribution footer {
    position: sticky;
    bottom: -20px;
    padding-block: 12px;
    background: #152722;
  }
  section {
    min-width: 0;
    background: #0c1c18;
    border: 1px solid #394b3f;
    border-radius: 10px;
    padding: 10px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 15px;
    color: #e5c887;
  }
  h3 span {
    color: #a8b7a4;
    font-size: 12px;
    margin-left: 6px;
  }
  .arrange-items {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    min-height: 185px;
    padding-bottom: 5px;
  }
  article {
    flex: 0 0 82px;
    position: relative;
  }
  .arrange-card {
    width: 82px;
    height: 112px;
    position: relative;
    border-radius: 7px;
    overflow: hidden;
  }
  .arrange-card:hover {
    transform: none;
  }
  .order-number {
    position: absolute;
    z-index: 1;
    top: 2px;
    right: 3px;
    background: #16372b;
    color: #fff2bd;
    width: 19px;
    height: 19px;
    text-align: center;
    border-radius: 50%;
    font-size: 12px;
  }
  .arrows {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }
  button {
    min-height: 34px;
    cursor: pointer;
  }
  .arrows button {
    flex: 1;
    background: #294638;
    border: 1px solid #53735c;
    color: #e7dfc0;
    border-radius: 5px;
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .transfer {
    width: 100%;
    margin-top: 4px;
    border: 1px solid #665f3d;
    background: #3d432d;
    color: #e6d49d;
    border-radius: 5px;
    font-size: 12px;
  }
  .empty-group {
    margin: auto;
    color: #748877;
    font-size: 13px;
  }
  .item-label {
    padding: 12px 4px;
    min-height: 88px;
    background: #294638;
  }
  footer {
    margin-top: 16px;
    font-size: 12px;
    color: #a8b7a4;
  }
  @media (max-height: 500px) {
    .arrange-panel {
      padding: 12px 16px;
    }
    h2 {
      font-size: 16px;
    }
    p {
      margin-bottom: 9px;
    }
    .arrange-items {
      min-height: 159px;
    }
    .arrange-card {
      width: 74px;
      height: 95px;
    }
    article {
      flex-basis: 74px;
    }
    button {
      min-height: 30px;
    }
    footer {
      margin-top: 9px;
    }
  }
  @media (max-width: 540px) {
    .arrange-groups {
      grid-template-columns: 1fr;
    }
  }
</style>
