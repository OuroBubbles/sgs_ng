<script lang="ts">
  import { onMount } from 'svelte';
  import type { CardView } from '../core/view/table';
  import type { GameSelection } from '../core/view/game';
  import { LocalSession } from './offline/session';
  import { createOfflineMatch, availablePackages, defaultContent } from './offline/practice';
  import { resolvePackages } from '../content/package';
  import { ContentLibrary } from './offline/content-library';
  import { BattleBoard } from '../client/table/board';
  import type { TableLayout, TableRegion } from '../client/table/layout';
  import { cardPoolCenter } from '../client/table/layout';
  import { acceptsGameShortcut } from '../client/interaction/selection';
  import HandCard from '../client/panels/HandCard.svelte';
  import CardFace from '../client/panels/CardFace.svelte';
  import CardInspector from '../client/panels/CardInspector.svelte';
  import SkillInspector from '../client/panels/SkillInspector.svelte';
  import SeatCurtain from '../client/panels/SeatCurtain.svelte';
  import PauseCurtain from '../client/panels/PauseCurtain.svelte';
  import SpinePanel from '../client/panels/SpinePanel.svelte';
  import ArrangePanel from '../client/panels/ArrangePanel.svelte';
  import { observeVisibility } from '../platform/lifecycle';

  const empty = (): GameSelection => ({ offer: null, cards: [], targets: [] });
  const initialSession = new LocalSession(createOfflineMatch(), { human: '甲席' });
  let session = $state.raw(initialSession);
  let view = $state.raw(initialSession.view);
  let selection = $state<GameSelection>(empty());
  let playerCount = $state(4);
  let seed = $state(42);
  let deckPreset = $state('standard:identity');
  const contentLibrary = new ContentLibrary(availablePackages);
  let libraryView = $state.raw(contentLibrary.view);
  const enabledPackages = $derived(libraryView.enabled);
  const importedPackages = $derived(libraryView.modules.map((entry) => entry.package));
  const importBusy = $derived(!libraryView.ready || libraryView.busy);
  const contentLocked = $derived(importBusy || libraryView.recovery);
  let pendingContentChoice = $state<{ id: string; enabled: boolean } | null>(null);
  let contentInput = $state<HTMLInputElement | null>(null);
  const packages = $derived([...availablePackages, ...importedPackages]);
  const optionalPackages = $derived(packages.filter((entry) => entry.manifest.id !== 'standard'));
  const packageSelection = $derived.by(() => {
    try {
      return {
        content: resolvePackages(packages, ['standard', ...enabledPackages]),
        error: '',
      };
    } catch (error) {
      return {
        content: defaultContent,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const selectedContent = $derived(packageSelection.content);
  const generals = $derived(selectedContent.generals);
  const implementedCardCount = $derived(selectedContent.cards.length);
  let manualPractice = $state(false);
  let general = $state('standard:guanyu');
  let aiGeneral = $state('preset');
  let notice = $state('');
  let boardHost: HTMLDivElement;
  let board = $state.raw<BattleBoard | null>(null);
  let tableLayout = $state<TableLayout | null>(null);
  let inspectedCard = $state<CardView | null>(null);
  let rendererReady = $state(false);
  let rendererError = $state('');
  let labOpen = $state(false);
  let logOpen = $state(false);
  let skillsOpen = $state(false);
  let animations = $state(true);
  let visible = $state(true);
  let unsubscribe = () => {};
  let decisionKey = '';
  const phases = [
    ['prepare', '准备'],
    ['judge', '判定'],
    ['draw', '摸牌'],
    ['play', '出牌'],
    ['discard', '弃牌'],
    ['finish', '结束'],
  ];
  const preview = $derived(session.inspect(view.decision?.id, view.decision?.token, selection));
  const targetOptions = $derived(
    preview.targetCount.max === 1
      ? session.inspect(view.decision?.id, view.decision?.token, { ...selection, targets: [] })
          .targets
      : preview.targets,
  );
  const offers = $derived(view.decision && 'offers' in view.decision ? view.decision.offers : []);
  const selectedOffer = $derived(offers.find((offer) => offer.id === selection.offer));
  const fixedTargets = $derived(
    view.decision?.kind === 'play-action'
      ? preview.fixedTargets
      : view.decision && 'fixedTargets' in view.decision
        ? view.decision.fixedTargets
        : [],
  );
  const displayedTargets = $derived(fixedTargets.length ? fixedTargets : selection.targets);
  const selectedCards = $derived(selectedOffer?.cardId ? [selectedOffer.cardId] : selection.cards);
  const materials = $derived([
    ...view.hand,
    ...(view.players.find((player) => player.self)?.equipment ?? []),
  ]);
  const phaseName = $derived(phases.find(([kind]) => kind === view.phase)?.[1] ?? '等待');
  const ownSeat = $derived(view.players.find((player) => player.self));
  $effect(() => {
    if (!selectedContent.decks.some((deck) => deck.id === deckPreset))
      deckPreset = 'standard:identity';
    if (!generals.some((item) => item.id === general)) general = 'standard:guanyu';
    if (aiGeneral !== 'preset' && !generals.some((item) => item.id === aiGeneral))
      aiGeneral = 'preset';
  });
  const hasPrivatePool = $derived(view.pools.some((pool) => pool.visibility === 'private'));
  const poolCardHeight = $derived(
    Math.max(32, Math.min(122, (tableLayout?.arena.height ?? 154) - (hasPrivatePool ? 28 : 12))),
  );
  const poolCenter = $derived.by(() => {
    const layout = tableLayout;
    return layout
      ? cardPoolCenter(
          layout,
          view.pools.reduce((count, pool) => count + pool.cards.length, 0),
          poolCardHeight,
          hasPrivatePool,
          view.players.flatMap((player, index) => {
            const seat = layout.seats[index];
            return seat &&
              targetOptions.some((target) => target.id === player.id && target.selectable)
              ? [seat]
              : [];
          }),
        )
      : 0;
  });

  function subscribe() {
    unsubscribe();
    unsubscribe = session.subscribe((next) => {
      const key = next.decision ? `${next.decision.id}:${next.decision.token}` : '';
      if (next.viewer !== view.viewer || key !== decisionKey) {
        selection = empty();
        inspectedCard = null;
        skillsOpen = false;
        notice = '';
      }
      decisionKey = key;
      view = next;
    });
  }
  onMount(() => {
    subscribe();
    const offContent = contentLibrary.subscribe((value) => {
      libraryView = value;
    });
    contentLibrary.restore().catch((error: unknown) => {
      notice = String(error);
    });
    const instance = new BattleBoard();
    board = instance;
    instance
      .mount(boardHost, (layout) => {
        tableLayout = layout;
      })
      .then(() => {
        rendererReady = true;
      })
      .catch((error: unknown) => {
        rendererError = String(error);
      });
    const offVisibility = observeVisibility((active) => {
      visible = active;
      if (!active) {
        inspectedCard = null;
        session.hide();
      }
    });
    return () => {
      offContent();
      contentLibrary.dispose();
      unsubscribe();
      session.dispose();
      offVisibility();
      instance.destroy();
    };
  });
  $effect(() => {
    board?.update(
      view,
      { ...selection, targets: displayedTargets },
      { ...preview, targets: targetOptions },
    );
  });
  $effect(() => {
    board?.setActive(!labOpen && visible);
  });

  const regionStyle = (region: TableRegion | undefined) =>
    region
      ? `left:${region.left}px;top:${region.top}px;width:${region.width}px;height:${region.height}px`
      : 'visibility:hidden';
  async function importFiles(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length || contentLocked || view.status !== 'idle') return;
    notice = '';
    await contentLibrary.import(files);
  }
  async function togglePackage(id: string, input: HTMLInputElement) {
    const enabled = input.checked;
    if (view.status !== 'idle') return;
    notice = '';
    // 开关是待保存的输入草稿；目录和开局资格仍等待事务提交，失败后恢复旧值。
    pendingContentChoice = { id, enabled };
    try {
      await contentLibrary.toggle(id, enabled);
    } finally {
      pendingContentChoice = null;
    }
  }
  async function removePackage(id: string) {
    if (view.status !== 'idle') return;
    notice = '';
    await contentLibrary.remove(id);
  }
  async function restoreContent() {
    notice = '';
    await contentLibrary.restore();
  }
  async function clearContent() {
    notice = '';
    await contentLibrary.clear();
  }
  function replace(start: boolean) {
    if (importBusy) return;
    if (packageSelection.error) {
      notice = packageSelection.error;
      return;
    }
    if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) {
      notice = '牌局种子需为 1 至 4294967295 的整数';
      return;
    }
    let next: LocalSession;
    try {
      next = new LocalSession(
        createOfflineMatch(
          playerCount,
          seed,
          deckPreset,
          manualPractice
            ? null
            : Array.from({ length: playerCount }, (_, i) =>
                i === 0
                  ? general
                  : aiGeneral === 'preset'
                    ? generals[i % generals.length]!.id
                    : aiGeneral,
              ),
          selectedContent,
        ),
        manualPractice ? {} : { human: '甲席' },
      );
    } catch (error) {
      notice = `内容装配失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    session.dispose();
    session = next;
    subscribe();
    selection = empty();
    if (start) session.start();
  }
  function selectCard(id: string) {
    const decision = view.decision;
    if (!decision) return;
    if (decision.kind === 'cards-targets') {
      if (!preview.cards.some((item) => item.id === id && item.selectable)) return;
      selection = {
        ...selection,
        cards: selection.cards.includes(id)
          ? selection.cards.filter((card) => card !== id)
          : [...selection.cards, id],
      };
    } else if (selectedOffer?.kind === 'viewAs') {
      if (!selectedOffer.cards.includes(id)) {
        notice = '此牌不能作为当前技能的材料';
        return;
      }
      const adding = !selection.cards.includes(id);
      const cards = adding
        ? [...selection.cards, id]
        : selection.cards.filter((card) => card !== id);
      const max = selectedOffer.count.max;
      selection = {
        ...selection,
        cards:
          max === 1
            ? adding
              ? [id]
              : []
            : max === 'all' || cards.length <= max
              ? cards
              : selection.cards,
        targets: [],
      };
    } else {
      const offer = offers.find((offer) => offer.cardId === id);
      if (!offer) {
        notice = '此牌当前不能使用，可右键或长按查看说明';
        return;
      }
      const next = {
        offer: selection.offer === offer.id ? null : offer.id,
        cards: [],
        targets: selection.targets,
      };
      const feedback = session.inspect(decision.id, decision.token, { ...next, targets: [] });
      selection = {
        ...next,
        targets: next.targets.filter((target) =>
          feedback.targets.some((item) => item.id === target && item.selectable),
        ),
      };
    }
    notice = '';
  }
  function selectTarget(id: string) {
    if (!targetOptions.some((item) => item.id === id && item.selectable)) return;
    selection = {
      ...selection,
      targets: selection.targets.includes(id)
        ? selection.targets.filter((target) => target !== id)
        : preview.targetCount.max === 1
          ? [id]
          : [...selection.targets, id],
    };
    notice = '';
  }
  function reply(value?: unknown) {
    const decision = view.decision;
    if (!decision) return;
    const result =
      value === undefined
        ? session.reply(decision.id, decision.token, selection)
        : session.answer(decision.id, decision.token, value);
    if (result.kind === 'rejected') notice = result.message;
  }
  function cancel() {
    const decision = view.decision;
    if (!decision) return;
    const result = session.cancel(decision.id, decision.token);
    if (result.kind === 'rejected') notice = result.message;
  }
  function available(id: string): boolean {
    if (view.decision?.kind === 'cards-targets')
      return preview.cards.some((item) => item.id === id && item.selectable);
    return selectedOffer?.kind === 'viewAs'
      ? selectedOffer.cards.includes(id)
      : offers.some((offer) => offer.cardId === id);
  }
  function keydown(event: KeyboardEvent) {
    if (logOpen) {
      if (event.key === 'Escape') {
        logOpen = false;
        event.preventDefault();
      }
      return;
    }
    if (
      labOpen ||
      inspectedCard ||
      skillsOpen ||
      view.handoff ||
      view.paused ||
      view.decision?.kind === 'arrange' ||
      !acceptsGameShortcut(event)
    )
      return;
    if (event.key === 'Escape') {
      selection = empty();
      notice = '';
    }
    if (event.key === 'Enter' && preview.valid) {
      event.preventDefault();
      reply();
    }
    const id =
      view.decision?.kind === 'cards-targets'
        ? view.decision.cards[Number(event.key) - 1]?.id
        : view.hand[Number(event.key) - 1]?.id;
    if (id) selectCard(id);
  }
</script>

<svelte:window onkeydown={keydown} />

<div class="app-shell" class:motion-off={!animations} class:setup={view.status === 'idle'}>
  <header class="app-header">
    <a href="/" class="brand" aria-label="弈 三国杀新章"
      ><span class="brand-seal">弈</span>
      <div><strong>三国杀<span>新章</span></strong><small>SANGUOSHA / NEXT</small></div></a
    >
    <nav class="phase-track" aria-label="当前阶段">
      {#each phases as [kind, name] (kind)}<span class:current={view.phase === kind}>{name}</span
        >{/each}
    </nav>
    <div class="header-actions">
      <span class="room-tag">{session.human ? '单机 · 基础 AI' : '手动演练'}</span><button
        class="subtle-button"
        onclick={() => {
          labOpen = true;
        }}>动画验证 ↗</button
      >
    </div>
  </header>
  <main class="game-layout">
    <section class="table-column" aria-label="对局战场">
      <div class="table-topline">
        <span><b>演武场</b><em>{view.players.length} 人身份局 · {view.deckName}</em></span><span
          class="turn-label"
          >第 {view.turn}
          {view.extraTurn ? '额外回合' : '回合'} ／ {view.result
            ? '对局结束'
            : view.error
              ? '本局中止'
              : (view.active ?? (view.turn > 0 ? '回合衔接' : '尚未开局'))} · {phaseName}</span
        >
      </div>
      <div class="table-surface">
        <div class="board-canvas" bind:this={boardHost} data-testid="battle-canvas"></div>
        <div class="target-overlays">
          {#each view.players as player, i (player.id)}
            {@const seat = tableLayout?.seats[i]}
            {@const selectable = targetOptions.some(
              (target) => target.id === player.id && target.selectable,
            )}
            <button
              class="target-hitbox"
              class:self={player.self}
              class:selected={displayedTargets.includes(player.id)}
              class:available={selectable}
              class:unavailable={!selectable && Boolean(selection.offer)}
              style={seat
                ? `left:${seat.x}px;top:${seat.y}px;width:${seat.width}px;height:${seat.height}px`
                : 'visibility:hidden'}
              data-seat={i}
              data-testid={`target-${player.id}`}
              data-chained={player.chained}
              data-shield={player.shield}
              aria-label={`${player.name}${player.title ? `·${player.title}` : ''}，性别${player.gender}，${player.alive ? `体力${player.hp}/${player.maxHp}，手牌${player.handCount}，护盾${player.shield}` : '已阵亡'}，${player.role ?? '身份未知'}${player.alive && player.chained ? '，连环' : ''}${displayedTargets.includes(player.id) && preview.targetCount.max !== 1 ? `，选择顺序${displayedTargets.indexOf(player.id) + 1}` : ''}`}
              aria-pressed={displayedTargets.includes(player.id)}
              aria-disabled={!selectable}
              onclick={() => selectTarget(player.id)}
              ><span class="sr-only">{player.name} {player.hp}/{player.maxHp} {player.role}</span
              >{#if selectable}<span class="target-state"
                  >{displayedTargets.includes(player.id)
                    ? preview.targetCount.max === 1
                      ? '已选'
                      : `已选 ${displayedTargets.indexOf(player.id) + 1}`
                    : '可选'}</span
                >{/if}</button
            >
          {/each}
        </div>
        <div
          class="battlefield"
          style={view.status === 'idle' || view.result || view.error
            ? 'inset:0;width:100%;height:100%'
            : regionStyle(tableLayout?.arena)}
        >
          {#if view.status === 'idle'}
            <section
              class="lobby"
              aria-label="开局设置"
              data-content-ready={libraryView.ready && !libraryView.busy}
            >
              <span class="eyebrow">OFFLINE / IDENTITY</span>
              <h1>落子，入局。</h1>
              <p>你执掌甲席，其余角色自动行动。<br />基础 AI 按公开信息与自己的手牌做出决策。</p>
              <div class="lobby-fields">
                <label
                  >AI 武将 <select
                    bind:value={aiGeneral}
                    disabled={manualPractice}
                    title="应用于所有 AI 席位"
                  >
                    <option value="preset">默认预设</option>
                    {#each generals as item (item.id)}<option value={item.id}>{item.name}</option
                      >{/each}
                  </select></label
                >
                <label
                  >你的武将 <select bind:value={general} disabled={manualPractice}>
                    {#each generals as item (item.id)}<option value={item.id}>{item.name}</option
                      >{/each}
                  </select></label
                >
                <label
                  >席位 <select bind:value={playerCount}
                    ><option value={2}>两人</option><option value={4}>四人</option><option value={6}
                      >六人</option
                    ><option value={8}>八人</option></select
                  ></label
                ><label
                  >牌组 <select bind:value={deckPreset}
                    >{#each selectedContent.decks as deck (deck.id)}<option value={deck.id}
                        >{deck.label}</option
                      >{/each}</select
                  ></label
                ><label
                  >牌局种子 <input
                    type="number"
                    min="1"
                    max="4294967295"
                    bind:value={seed}
                  /></label
                >
              </div>
              <div class="lobby-options">
                <input
                  class="content-file-input"
                  type="file"
                  accept=".sgs,.sgs.mjs,.mjs"
                  multiple
                  bind:this={contentInput}
                  aria-label="导入本地内容包"
                  onchange={(event) => importFiles(event.currentTarget)}
                />
                {#if optionalPackages.length}
                  <fieldset class="package-options">
                    <legend
                      >扩展内容
                      {#if importBusy || importedPackages.length || enabledPackages.length || libraryView.recovery}
                        <span
                          class="content-store-status"
                          data-testid="content-store-status"
                          role="status"
                          >{!libraryView.ready
                            ? '读取中'
                            : libraryView.busy
                              ? '保存中'
                              : libraryView.recovery
                                ? '需要处理'
                                : '已保存'}</span
                        >
                      {/if}
                      {#if libraryView.recovery}<button
                          class="content-action"
                          aria-label="重新载入内容"
                          disabled={importBusy}
                          onclick={restoreContent}>重载</button
                        >{/if}
                      {#if importedPackages.length || enabledPackages.length || libraryView.recovery}<button
                          class="content-action"
                          aria-label="清空已保存内容"
                          title="清空已保存的模块和启用选择"
                          disabled={importBusy}
                          onclick={clearContent}>清空</button
                        >{/if}
                    </legend>
                    {#each optionalPackages as entry (entry.manifest.id)}
                      <span class="package-item"
                        ><label class="practice-toggle"
                          ><input
                            type="checkbox"
                            checked={pendingContentChoice?.id === entry.manifest.id
                              ? pendingContentChoice.enabled
                              : selectedContent.packages.some(
                                  (item) => item.id === entry.manifest.id,
                                )}
                            disabled={contentLocked}
                            onchange={(event) =>
                              togglePackage(entry.manifest.id, event.currentTarget)}
                          />{entry.manifest.name}</label
                        >{#if importedPackages.some((item) => item.manifest.id === entry.manifest.id)}<button
                            class="package-remove"
                            aria-label={`移除${entry.manifest.name}`}
                            disabled={contentLocked}
                            onclick={() => removePackage(entry.manifest.id)}>×</button
                          >{/if}</span
                      >
                    {/each}
                    <button
                      class="content-import"
                      disabled={contentLocked}
                      onclick={() => contentInput?.click()}>导入内容包</button
                    >
                  </fieldset>
                {/if}
                <label class="practice-toggle"
                  ><input
                    type="checkbox"
                    bind:checked={manualPractice}
                  />手动演练（内容调试）</label
                >
              </div>
              {#if notice || libraryView.error || packageSelection.error}<p role="alert">
                  {notice || libraryView.error || packageSelection.error}
                </p>{/if}
              <button
                class="confirm-button"
                disabled={importBusy || !!packageSelection.error}
                onclick={() => replace(true)}>开始单机对局 →</button
              ><small
                >当前 {implementedCardCount} 种牌与 {generals.length} 名武将。{selectedContent.versions
                  .map((entry) => `${entry.id}@${entry.version}`)
                  .join(' · ')}。手动演练用于内容调试。</small
              >
            </section>
          {:else if view.error}
            <section class="lobby" aria-label="对局中止">
              <span class="eyebrow">GAME STOPPED</span>
              <h1>本局已中止</h1>
              <p>{view.error}</p>
              <button class="confirm-button" onclick={() => replace(false)}>重新开局 →</button>
            </section>
          {:else if view.result}
            <section class="lobby end-result" aria-label="对局结果">
              <span class="eyebrow">THE GAME IS SETTLED</span>
              <h1>胜负已定</h1>
              <p>{view.result.winners.join('、')} 获胜</p>
              <div class="result-seats" aria-label="身份揭示">
                {#each view.players as player (player.id)}<span
                    class:winner={view.result.winners.includes(player.id)}
                    >{player.name} · {player.role} {player.alive ? '' : '· 阵亡'}</span
                  >{/each}
              </div>
              <button class="confirm-button" onclick={() => replace(false)}>再开一局 →</button>
            </section>
          {:else if view.decision?.kind !== 'arrange' && view.pools.some((pool) => pool.cards.length)}
            <div
              class="public-pools"
              style={`--pool-card-height:${poolCardHeight}px;left:${poolCenter}px`}
              role="group"
              aria-label={hasPrivatePool ? '仅本人可见的牌池' : '公开牌池'}
            >
              {#if hasPrivatePool}<span class="pool-privacy">私有牌池 · 仅你可见</span>{/if}
              <div class="pool-items">
                {#each view.pools as pool (pool.zone)}{#each pool.cards as item, i (item.id)}<div
                      class="pool-card"
                    >
                      <HandCard
                        card={item}
                        index={i}
                        selected={selection.cards.includes(item.id)}
                        available={preview.cards.some(
                          (candidate) => candidate.id === item.id && candidate.selectable,
                        )}
                        onselect={() => selectCard(item.id)}
                        oninspect={() => {
                          inspectedCard = item;
                        }}
                      />{#if pool.visibility === 'private'}<span
                          class="private-card-marker"
                          aria-hidden="true">私</span
                        >{/if}
                    </div>{/each}{/each}
              </div>
            </div>
          {:else if view.actions.length}
            <div class="table-cards" aria-label="公开用牌" data-testid="table-cards">
              <span class="table-cards-label"
                >{view.actions.some((action) => action.processing) ? '结算中' : '最近用牌'}</span
              >{#each view.actions as action (`${action.seq}:${action.card.id}`)}<div
                  class="played-entry"
                  role="group"
                  aria-label={`${action.actor} · ${action.card.name}${action.targets.length ? ` → ${action.targets.join('、')}` : ''}`}
                >
                  <div class="playing-card table-card" class:red={action.card.color === 'red'}>
                    <CardFace card={action.card} />
                  </div>
                  <span
                    >{action.actor} · {{
                      use: '使用',
                      response: '响应',
                      judgment: '判定',
                      delayed: '生效',
                      reveal: '展示',
                    }[action.kind]}</span
                  >
                </div>{/each}
            </div>
          {/if}
          <div class="board-status">
            <span class:ready={rendererReady}></span>{rendererError ||
              (rendererReady ? 'WebGL 战场已就绪' : '正在准备战场')}
          </div>
          <span class="pile-count">牌堆 {view.drawCount} ／ 弃牌 {view.discardCount}</span>
        </div>
        {#if view.players.some((player) => player.equipment.length || player.judgment.length)}
          <div class="equipment-shelf" role="group" aria-label="公开装备与判定区">
            {#each view.players.filter((player) => player.equipment.length || player.judgment.length) as player (player.id)}
              <div
                class="equipment-holder"
                class:own-gear={view.players.indexOf(player) === tableLayout?.focus}
                style={regionStyle(tableLayout?.equipment[view.players.indexOf(player)])}
              >
                <span>{player.name}</span>
                <div class="equipment-items" data-testid={`equipment-${player.id}`}>
                  {#if player.equipment.length}<span>装备</span>{/if}
                  {#each player.equipment as item, i (item.id)}
                    <HandCard
                      card={item}
                      index={player.self ? view.hand.length + i : -1}
                      compact
                      selected={player.self && selectedCards.includes(item.id)}
                      available={!player.self || available(item.id)}
                      onselect={() => {
                        if (player.self && available(item.id)) selectCard(item.id);
                        else inspectedCard = item;
                      }}
                      oninspect={() => {
                        inspectedCard = item;
                      }}
                    />
                  {/each}
                </div>
                {#if player.judgment.length}<div
                    class="equipment-items"
                    role="group"
                    aria-label={`${player.name}的判定区`}
                    data-testid={`judgment-${player.id}`}
                  >
                    <span>判定</span>
                    {#each player.judgment as item (item.id)}
                      <HandCard
                        card={item}
                        index={-1}
                        compact
                        selected={false}
                        onselect={() => {
                          inspectedCard = item;
                        }}
                        oninspect={() => {
                          inspectedCard = item;
                        }}
                      />
                    {/each}
                  </div>{/if}
              </div>
            {/each}
          </div>
        {/if}

        <div class="skills-dock" aria-label="当前席位技能" style={regionStyle(tableLayout?.skills)}>
          {#if offers.some((offer) => offer.kind !== 'physical')}<div class="recipe-bar">
              <span>技能</span
              >{#each offers.filter((offer) => offer.kind !== 'physical') as offer (offer.id)}<button
                  class:active={selection.offer === offer.id}
                  aria-pressed={selection.offer === offer.id}
                  title={offer.description}
                  onclick={() => {
                    selection =
                      selection.offer === offer.id
                        ? empty()
                        : { offer: offer.id, cards: [], targets: [] };
                    notice = '';
                  }}
                  >{offer.label}{selection.offer === offer.id
                    ? offer.kind === 'active'
                      ? ' · 确认发动'
                      : offer.count.max === 0
                        ? view.decision?.kind === 'card-response'
                          ? ' · 确认打出'
                          : preview.targetCount.max === 0
                            ? ' · 确认用牌'
                            : ' · 选择目标'
                        : ' · 选择材料'
                    : ''}</button
                >{/each}
            </div>{/if}
        </div>
        <section style={regionStyle(tableLayout?.hand)} class="hand-zone" aria-label="当前席位手牌">
          <div class="hand-meta">
            <div>
              <span class="eyebrow">{view.viewer ? 'YOUR HAND' : 'PRIVATE HAND'}</span>
              <h1>{view.viewer ? `${view.viewer} · 手牌` : '静候落子'}</h1>
            </div>
            <span
              >{#if view.viewer}<b class="own-role" data-testid="own-role"
                  >{view.players.find((player) => player.self)?.role}</b
                >
                · {view.hand.length} 张
                {#if ownSeat?.skills.length}<button
                    class="text-button skill-help"
                    aria-label="查看武将技能说明"
                    onclick={() => {
                      skillsOpen = true;
                    }}>技能说明</button
                  >{/if}
              {/if}</span
            >
          </div>
          <div class="hand-cards" data-testid="hand-cards">
            {#each view.hand as item, i (item.id)}<HandCard
                card={item}
                index={i}
                selected={selectedCards.includes(item.id)}
                available={available(item.id)}
                onselect={() => selectCard(item.id)}
                oninspect={() => {
                  inspectedCard = item;
                }}
              />{/each}{#if !view.hand.length}<p class="empty-hand">
                {view.viewer ? '当前没有手牌' : '私有内容在席位确认后显示'}
              </p>{/if}
          </div>
        </section>
        {#if view.decision?.kind === 'cards-targets'}<div
            class="choice-options"
            style={regionStyle(tableLayout?.choices)}
          >
            {#each view.decision.cards.filter((item) => !materials.some((card) => card.id === item.id) && !view.pools.some( (pool) => pool.cards.some((card) => card.id === item.id), )) as item (item.id)}<button
                class="subtle-button"
                aria-pressed={selection.cards.includes(item.id)}
                disabled={!preview.cards.some(
                  (candidate) => candidate.id === item.id && candidate.selectable,
                )}
                onclick={() => selectCard(item.id)}>{item.label}</button
              >{/each}
          </div>{/if}

        <div
          class="decision-bar"
          style={regionStyle(tableLayout?.decision)}
          data-decision-kind={view.decision?.kind ?? ''}
        >
          <div class="decision-copy" aria-live="polite">
            <span class="decision-index">{view.decision ? '弈' : '·'}</span>
            <div>
              <strong data-testid="decision-hint"
                >{view.error ||
                  notice ||
                  (selectedOffer && !preview.valid ? preview.reason : '') ||
                  selectedOffer?.description ||
                  view.decision?.prompt ||
                  (view.status === 'idle'
                    ? '设置席位，开始本地对局'
                    : view.paused
                      ? '对局已暂停'
                      : view.result
                        ? '对局已结束'
                        : view.automated
                          ? `${view.automated} 正在思考…`
                          : '正在结算…')}</strong
              ><small
                >{view.decision ? preview.reason : '公开记录随结算更新 · 右键或长按查看牌面'}</small
              >
            </div>
          </div>
          <div class="decision-actions">
            {#if view.decision?.kind === 'invoke'}<button
                class="confirm-button"
                onclick={() => reply(true)}>发动</button
              ><button class="cancel-button" onclick={() => reply(false)}>不发动</button>
            {:else if view.decision?.kind === 'trigger-order' || view.decision?.kind === 'choose-option'}{#each view.decision.options as option (option.id)}<button
                  class="subtle-button"
                  disabled={!option.selectable}
                  onclick={() => reply(option.id)}>{option.label}</button
                >{/each}
              {#if view.decision.optional}<button class="cancel-button" onclick={cancel}
                  >{view.decision.cancelLabel ?? '取消'}</button
                >{/if}
            {:else if view.decision?.kind === 'arrange'}<span>请在排序面板确认</span>
            {:else if view.decision?.kind === 'unsupported'}<span
                >尚无此类选择面板：{view.decision.original}</span
              >
            {:else}<button
                class="confirm-button"
                aria-label="确认当前选择"
                disabled={!preview.valid}
                onclick={() => reply()}>确认 <span>↵</span></button
              ><button class="cancel-button" disabled={!view.decision?.optional} onclick={cancel}
                >{view.decision?.cancelLabel ??
                  (view.decision?.kind === 'play-action'
                    ? '结束出牌'
                    : view.decision?.kind === 'use-card'
                      ? view.decision.purpose === 'counter'
                        ? '放弃反制'
                        : view.decision.purpose === 'rescue'
                          ? '放弃救援'
                          : '放弃使用'
                      : '放弃响应')}</button
              >{/if}
          </div>
        </div>
        <nav class="table-tools" aria-label="牌桌工具">
          <button
            aria-label="结算记录"
            onclick={() => {
              logOpen = !logOpen;
            }}>记录</button
          ><button
            aria-label={session.human ? '暂停对局' : '隐藏手牌'}
            disabled={!view.viewer || view.status !== 'running'}
            onclick={() => session.hide()}>{session.human ? '暂停' : '藏牌'}</button
          >
        </nav>
      </div>
    </section>
    <aside class="journal" class:open={logOpen} aria-label="结算记录">
      <button
        class="journal-close subtle-button"
        onclick={() => {
          logOpen = false;
        }}>关闭记录</button
      >
      <header>
        <div>
          <span class="eyebrow">CHRONICLE</span>
          <h2>局中记</h2>
        </div>
        <span class="journal-count">{view.log.length}</span>
      </header>
      <div class="journal-body" data-testid="journal">
        {#each view.log.slice().reverse() as fact (fact.seq)}<div class="journal-entry">
            <span class="event-dot"></span><small>#{fact.seq}</small>
            <p>{fact.text}</p>
          </div>{/each}{#if !view.log.length}<div class="journal-entry opening">
            <span class="event-dot"></span><small>初局</small>
            <p>风起，落子。</p>
            <span>用同一副牌，写不同的局。</span>
          </div>{/if}
      </div>
      <footer>
        <span class="eyebrow">{implementedCardCount} 种牌 · 基础身份规则</span>
        <p>标准＋EX 牌组已接入；完整武将与复杂技能仍在开发。</p>
      </footer>
    </aside>
  </main>
  <footer class="app-footer">
    <span>本地运行 · 无需网络</span><span class="footer-center">SGS_NG ／ 自由落子</span>
    <div>
      <button
        class="text-button"
        onclick={() => {
          animations = !animations;
        }}>动画{animations ? '开启' : '关闭'}</button
      ><button
        class="text-button mobile-log"
        onclick={() => {
          logOpen = !logOpen;
        }}>{logOpen ? '收起记录' : '结算记录'}</button
      ><span class="version">v0.1.0</span>
    </div>
  </footer>
</div>
{#if skillsOpen && ownSeat}<SkillInspector
    name={ownSeat.title || ownSeat.name}
    skills={ownSeat.skills}
    onclose={() => {
      skillsOpen = false;
    }}
  />{/if}
{#if view.decision?.kind === 'arrange'}
  {#key `${view.decision.id}:${view.decision.token}`}
    <ArrangePanel
      decision={view.decision}
      cards={view.pools.flatMap((pool) => pool.cards)}
      onpreview={(choice) =>
        view.decision
          ? session.inspectAnswer(view.decision.id, view.decision.token, choice)
          : { valid: false, reason: '选择已结束' }}
      onconfirm={(choice) => reply(choice)}
      onpause={() => session.hide()}
      oncancel={cancel}
      privateContent={hasPrivatePool}
    />
  {/key}
{/if}
{#if view.paused}<PauseCurtain onresume={() => session.resume()} />{/if}
{#if view.handoff}{#key view.handoff.key}<SeatCurtain
      name={view.handoff.name}
      turn={view.handoff.turn}
      extra={view.handoff.extra}
      onconfirm={() => {
        if (view.handoff) session.confirmSeat(view.handoff.key);
      }}
    />{/key}{/if}
{#if labOpen}<SpinePanel
    onclose={() => {
      labOpen = false;
    }}
  />{/if}
{#if inspectedCard}<CardInspector
    card={inspectedCard}
    onclose={() => {
      inspectedCard = null;
    }}
  />{/if}
