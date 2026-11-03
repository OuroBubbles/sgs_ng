<script lang="ts">
  import { skinImage } from '../presentation/skin';

  const {
    entries,
    selected,
    onselect,
  }: {
    entries: readonly {
      id: string;
      name: string;
      kingdom: string;
      maxHp: number;
      portrait: string | undefined;
    }[];
    selected: string;
    onselect: (id: string) => void;
  } = $props();
  let search = $state('');
  const visible = $derived(entries.filter((entry) => entry.name.includes(search.trim())));
</script>

<section class="lobby-panel general-gallery" aria-label="武将一览">
  <header>
    <div>
      <h2>武将一览</h2>
      <p>择将进入单机演武，其他开局设置保持。</p>
    </div>
    <label>查找武将<input type="search" bind:value={search} placeholder="输入武将名" /></label>
  </header>
  <span class="gallery-count" role="status">{visible.length} / {entries.length} 名武将</span>
  <div class="gallery-grid">
    {#each visible as entry (entry.id)}
      <button
        class:chosen={selected === entry.id}
        aria-label={`选择${entry.name}并前往单机演武`}
        aria-describedby={`gallery-${entry.id}`}
        aria-pressed={selected === entry.id}
        onclick={() => onselect(entry.id)}
      >
        <img
          src={entry.portrait ?? skinImage('ui/photo/unknown.jpg')}
          alt=""
          loading="lazy"
          onerror={(event) => {
            const image = event.currentTarget as HTMLImageElement;
            const fallback = new URL(skinImage('ui/photo/unknown.jpg'), location.href).href;
            if (image.src !== fallback) image.src = fallback;
          }}
        />
        <strong>{entry.name}</strong>
        <small id={`gallery-${entry.id}`}>{entry.kingdom} · 体力 {entry.maxHp}</small>
        {#if selected === entry.id}<span>已选</span>{/if}
      </button>
    {/each}
  </div>
  {#if visible.length === 0}<p class="gallery-empty">没有找到该武将，试试其他名字。</p>{/if}
</section>

<style>
  header {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: start;
  }
  header label {
    width: 170px;
    flex-shrink: 0;
  }
  .gallery-count {
    display: block;
    margin: 8px 0 18px;
    color: #b0bfaa;
    font-size: 11px;
  }
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 16px;
  }
  button {
    position: relative;
    min-width: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid #b3aa7766;
    border-radius: 5px;
    background: #13231f;
    transition:
      border-color 0.15s,
      transform 0.15s;
  }
  button:hover,
  button.chosen {
    border-color: #e3c580;
    box-shadow: 0 0 0 1px #d4b66a66;
  }
  button:hover {
    transform: translateY(-2px);
  }
  img {
    display: block;
    width: 100%;
    aspect-ratio: 88 / 110;
    object-fit: cover;
    object-position: top;
  }
  strong {
    display: block;
    padding: 10px 2px 5px;
    color: #ead7a5;
    font: 20px var(--fk-name);
    font-weight: 400;
  }
  button small {
    display: block;
    padding: 0 2px 10px;
    color: #b7c4af;
    font: 11px var(--sans);
  }
  button > span {
    position: absolute;
    top: 4px;
    right: 4px;
    padding: 3px 5px;
    background: #d5be85;
    color: #263c2d;
    font-size: 10px;
  }
  .gallery-empty {
    padding: 32px 0;
    text-align: center;
  }
  @media (max-width: 700px) {
    header {
      flex-wrap: wrap;
    }
    header label {
      width: 100%;
    }
    .gallery-grid {
      gap: 12px;
    }
  }
</style>
