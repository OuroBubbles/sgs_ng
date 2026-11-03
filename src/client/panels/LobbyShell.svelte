<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { skinImage } from '../presentation/skin';
  import '../lobby.css';

  type LobbyPage = 'home' | 'solo' | 'network' | 'content';
  const {
    page,
    summary,
    matchSummary,
    seats,
    message,
    resumeSeat,
    onpage,
    onresume,
    onstart,
    oncount,
    children,
  }: {
    page: LobbyPage | 'room';
    summary: string;
    matchSummary: string;
    seats: readonly {
      readonly seat: string;
      readonly name: string;
      readonly portrait: string;
      readonly controller: string;
    }[];
    message: string;
    resumeSeat: string | undefined;
    onpage: (page: LobbyPage) => void;
    onresume: () => void;
    onstart: () => void;
    oncount: (count: number) => void;
    children: Snippet;
  } = $props();
  const entries = [
    {
      id: 'solo',
      name: '单机演武',
      detail: '选择武将、阵容与牌组',
      icon: 'start',
    },
    {
      id: 'network',
      name: '联机房间',
      detail: '创建或加入好友的房间',
      icon: 'room',
    },
    {
      id: 'content',
      name: '内容管理',
      detail: '浏览武将、技能与牌组',
      icon: 'content',
    },
  ] as const;
  const title = $derived(
    page === 'room' ? '同席，共弈。' : entries.find((entry) => entry.id === page)?.name,
  );
  let shell: HTMLElement;

  // 导航只切换大厅分区；开局草稿由 App 持有，返回时不重新初始化。
  async function navigate(next: LobbyPage) {
    onpage(next);
    await tick();
    shell.scrollTop = 0;
    shell
      .querySelector<HTMLElement>('.launch-title h1, .lobby-heading h1')
      ?.focus({ preventScroll: true });
  }
</script>

<section
  bind:this={shell}
  class="lobby-shell"
  class:launch={page === 'home'}
  class:waiting={page === 'room'}
  aria-label={page === 'home' ? '启动界面' : '游戏大厅'}
  data-content-ready="true"
>
  <div class="lobby-frame">
    <div class="lobby-masthead">
      {#if page === 'home'}
        <span class="lobby-edition">自由落子 <span>／</span> 三国杀新章</span>
      {:else if page !== 'room'}
        <button class="lobby-home" data-back-action onclick={() => navigate('home')}
          >‹ 返回首页</button
        >
      {:else}
        <span class="lobby-edition">联机房间 <span>／</span> 准备入席</span>
      {/if}
      <span class="lobby-state" role="status"
        ><i class="ready"></i>{page === 'room' ? '等待同伴' : '离线可用 · 内容就绪'}</span
      >
    </div>

    <div class="lobby-body">
      {#if page === 'home'}
        <div class="launch-scene">
          <div class="launch-art" aria-hidden="true">
            <img src={skinImage('ui/lobby/hero.png')} alt="" />
          </div>
          <div class="launch-title">
            <span class="launch-kicker">群雄聚首 · 一战成名</span>
            <h1 tabindex="-1">三国杀<span>新章</span></h1>
            <p>运筹帷幄，落子三国。</p>
            <span class="launch-signature" aria-hidden="true">弈</span>
          </div>
        </div>
      {/if}

      {#if page !== 'room'}
        <nav class="lobby-navigation" aria-label="大厅导航">
          {#if page !== 'home'}
            <div class="lobby-nav-title">
              <span>弈</span>
              <div>游戏大厅<small>择席而入，共赴风云</small></div>
            </div>
          {/if}
          {#if resumeSeat}
            <button
              class="lobby-resume"
              aria-label={`返回原房间 · ${resumeSeat}`}
              onclick={onresume}><span>返回原房间</span><span>{resumeSeat} →</span></button
            >
          {/if}
          {#if page === 'home'}
            <div class="launch-welcome">
              <div>
                <span>欢迎入席</span>
                <h2>游戏大厅</h2>
              </div>
              <span class="launch-mode">单机 · 联机</span>
            </div>
            <div class="launch-match" aria-label="待开牌局">
              <div class="launch-match-heading">
                <div>
                  <span>单机牌桌 <small>{seats.length} 席</small></span>
                  <button onclick={() => navigate('solo')}
                    >调整阵容 <span aria-hidden="true">↗</span></button
                  >
                </div>
                <p>{matchSummary}</p>
              </div>
              <div class="launch-count" role="group" aria-label="快捷席位">
                <span>对局席位</span>
                {#each [2, 4, 6, 8] as count (count)}
                  <button aria-pressed={seats.length === count} onclick={() => oncount(count)}
                    >{count} 席</button
                  >
                {/each}
              </div>
              <button class="launch-start" aria-label="直接开始单机对局" onclick={onstart}
                >开始对局 <span aria-hidden="true">→</span></button
              >
              <ol class="launch-roster" aria-label="待开牌局阵容">
                {#each seats as seat (seat.seat)}
                  <li class:human={seat.controller === '你'}>
                    {#if seat.controller === '你'}
                      <button
                        class="launch-general"
                        aria-label={`更换你的武将，当前${seat.name}`}
                        onclick={() => navigate('content')}
                      >
                        <img src={seat.portrait} alt="" />
                        <span aria-hidden="true">换将</span>
                      </button>
                    {:else}
                      <img src={seat.portrait} alt="" />
                    {/if}
                    <div>
                      <strong>{seat.name}</strong><small>{seat.seat} · {seat.controller}</small>
                    </div>
                  </li>
                {/each}
              </ol>
            </div>
            {#if message}<p class="launch-error" role="alert">{message}</p>{/if}
          {/if}
          <div class="lobby-destinations">
            {#each entries as entry (entry.id)}
              <button
                class="lobby-destination"
                aria-label={entry.name}
                aria-current={page === entry.id ? 'page' : undefined}
                onclick={() => navigate(entry.id)}
              >
                <img src={skinImage(`ui/lobby/${entry.icon}.png`)} alt="" />
                <span class="destination-text"
                  ><strong>{entry.name}</strong><small class="destination-detail"
                    >{entry.detail}</small
                  ></span
                >
                <span class="destination-arrow" aria-hidden="true">↗</span>
              </button>
            {/each}
          </div>
          {#if page !== 'home'}<p class="lobby-nav-summary">
              {summary}<span>本地内容 · 随时入席</span>
            </p>{/if}
        </nav>
      {/if}

      <div class="lobby-workspace" hidden={page === 'home'}>
        <header class="lobby-heading">
          <div>
            <span>三国杀新章 / {page === 'room' ? '房间' : '大厅'}</span>
            <h1 tabindex="-1">{title}</h1>
          </div>
          <p>
            {page === 'solo'
              ? '选好武将，即可开局。'
              : page === 'network'
                ? '同一张牌桌，等你入席。'
                : page === 'content'
                  ? '武将与牌组，尽在此处。'
                  : '选择武将，准备开局。'}
          </p>
        </header>
        <div
          class="lobby-panels"
          class:content-page={page === 'content'}
          class:room-page={page === 'room'}
        >
          {@render children()}
        </div>
      </div>
    </div>

    <div class="lobby-bottomline">
      <span>{page === 'room' ? '对局内容由主持端提供' : summary}</span>
      <span>{page === 'room' ? '联机对局 · 准备入席' : '本地内容 · 离线可用'}</span>
    </div>
  </div>
</section>
