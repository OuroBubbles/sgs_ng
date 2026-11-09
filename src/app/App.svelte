<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { RemoteSession, rememberedRoom, waitingView, type RememberedRoom } from './session';
  import {
    defaultRoomSetup,
    emptyPreview,
    type CardView,
    type ContentSummary,
    type GameSelection,
    type HostCatalog,
    type LobbyView,
    type ReplyResult,
    type RoomSetup,
    type SoloSetup,
  } from '../protocol';
  import type { BattleBoard } from '../client/table/board';
  import type { TableLayout, TableRegion } from '../client/table/layout';
  import { cardPoolCenter } from '../client/table/layout';
  import { acceptsGameShortcut, selectForcedTargets } from '../client/interaction/selection';
  import HandCard from '../client/panels/HandCard.svelte';
  import OwnedCardPicker from '../client/panels/OwnedCardPicker.svelte';
  import PlayerPanel from '../client/panels/PlayerPanel.svelte';
  import SkillArea from '../client/panels/SkillArea.svelte';
  import TargetLines from '../client/table/TargetLines.svelte';
  import CardFace from '../client/panels/CardFace.svelte';
  import CardInspector from '../client/panels/CardInspector.svelte';
  import SkillInspector from '../client/panels/SkillInspector.svelte';
  import SeatCurtain from '../client/panels/SeatCurtain.svelte';
  import PauseCurtain from '../client/panels/PauseCurtain.svelte';
  import SpinePanel from '../client/panels/SpinePanel.svelte';
  import ArrangePanel from '../client/panels/ArrangePanel.svelte';
  import { observeVisibility } from '../platform/lifecycle';
  import { GameAudio } from '../client/presentation/audio';
  import NetworkSetup from '../client/panels/NetworkSetup.svelte';
  import HostedRoomInfo from '../client/panels/HostedRoomInfo.svelte';
  import RoomLobby from '../client/panels/RoomLobby.svelte';
  import LobbyShell from '../client/panels/LobbyShell.svelte';
  import GeneralGallery from '../client/panels/GeneralGallery.svelte';
  import { skinImage } from '../client/presentation/skin';
  import {
    observeHosting,
    createDesktopRoom,
    closeDesktopRoom,
    unavailableHosting,
    type HostingState,
  } from '../platform/hosting';

  type LobbyPage = 'home' | 'solo' | 'network' | 'content';
  const empty = (): GameSelection => ({ offer: null, cards: [], targets: [] });
  // 大厅阶段没有会话；单机与联机都是经 /game 协议连接主持端的同一种会话。
  let session = $state.raw<RemoteSession | null>(null);
  const online = $derived(session?.online ?? false);
  const manualSession = $derived(Boolean(session?.solo && !session.solo.lineup));
  let catalog = $state.raw<HostCatalog | null>(null);
  const noContent: ContentSummary = { cards: 0, decks: [], generals: [] };
  let remoteLobby = $state.raw<LobbyView | null>(null);
  let savedRoom = $state.raw<RememberedRoom | null>(null);
  let remoteState = $state<RemoteSession['connectionState'] | null>(null);
  let remoteEpoch = $state(0);
  let remoteBaseline = $state(0);
  let remoteRetryable = $state(false);
  const disconnected = $derived(
    remoteLobby?.seats.filter((seat) => !seat.connected).map((seat) => seat.id) ?? [],
  );
  let hosting = $state.raw<HostingState>(unavailableHosting);
  let lastRoomSetup = $state.raw<RoomSetup>(defaultRoomSetup);
  let lastRoomPort = $state(1422);
  let lobbyPage = $state<LobbyPage>('home');
  let view = $state.raw(waitingView());
  const tableOpen = $derived(view.status !== 'idle' && view.players.length > 0);
  let selection = $state<GameSelection>(empty());
  let autoTargetEnabled = $state(true);
  let playerCount = $state(4);
  let seed = $state(42);
  let deckPreset = $state('standard:identity');
  let enablePractice = $state(false);
  const selectedContent = $derived(
    catalog ? (enablePractice ? catalog.practice : catalog.standard) : noContent,
  );
  const seatNames = $derived(catalog?.seats ?? []);
  const generals = $derived(selectedContent.generals);
  const portraitOf = (id: string) => generals.find((item) => item.id === id)?.portrait;
  const implementedCardCount = $derived(selectedContent.cards);
  let manualPractice = $state(false);
  let practiceOptionsOpen = $state(false);
  let general = $state('standard:guanyu');
  const selectedGeneral = $derived(generals.find((item) => item.id === general));
  // 技能说明随主持端目录送达，取自实际内容装配；客户端不另维护一份技能文案。
  const selectedGeneralSkills = $derived(selectedGeneral?.skills ?? []);
  let failedPortrait = $state<string | null>(null);
  let aiGeneral = $state('preset');
  // 预览与开局共享同一份阵容草稿，不在表现层另外推算一套席位。
  const localLineup = $derived(
    Array.from({ length: playerCount }, (_, i) =>
      i === 0
        ? general
        : aiGeneral === 'preset'
          ? (generals[i % generals.length]?.id ?? '')
          : aiGeneral,
    ),
  );
  const lobbySeats = $derived(
    localLineup.slice(0, seatNames.length).map((id, i) => ({
      seat: seatNames[i]!,
      name: manualPractice
        ? '自由演练'
        : (generals.find((item) => item.id === id)?.name ?? '待选将'),
      portrait: manualPractice
        ? skinImage('ui/photo/unknown.jpg')
        : (portraitOf(id) ?? skinImage('ui/photo/unknown.jpg')),
      controller: manualPractice ? '手动' : i === 0 ? '你' : 'AI',
    })),
  );
  const localDeckName = $derived(
    selectedContent.decks.find((deck) => deck.id === deckPreset)?.label ?? '',
  );
  const matchSummary = $derived(
    `${playerCount} 席 · ${manualPractice ? '手动演练' : `${selectedGeneral?.name ?? '待选将'}领衔`} · ${localDeckName}`,
  );
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
  let soundEnabled = $state(true);
  let audio = $state.raw<GameAudio | null>(null);
  let visible = $state(true);
  let unsubscribe = () => {};
  /** 主持端预览全部到达；未到达时界面标注 aria-busy。 */
  let settled = $state(true);
  let decisionKey = '';
  const phases = [
    ['prepare', '准备'],
    ['judge', '判定'],
    ['draw', '摸牌'],
    ['play', '出牌'],
    ['discard', '弃牌'],
    ['finish', '结束'],
  ];
  /** 选择预览只来自主持端；结果到达前为空预览。 */
  const inspect = (draft: GameSelection) =>
    session?.inspect(view.decision?.id, view.decision?.token, draft) ?? emptyPreview();
  const preview = $derived(inspect(selection));
  const targetOptions = $derived(
    preview.targetCount.max === 1
      ? inspect({ ...selection, targets: [] }).targets
      : preview.targets,
  );
  const offers = $derived(view.decision && 'offers' in view.decision ? view.decision.offers : []);
  const selectedOffer = $derived(offers.find((offer) => offer.id === selection.offer));
  const cardOptions = $derived(
    (selectedOffer?.kind === 'active' && selectedOffer.count.max === 1) ||
      (view.decision?.kind === 'cards-targets' && view.decision.cardCount.max === 1)
      ? inspect({ ...selection, cards: [] }).cards
      : preview.cards,
  );
  const ownedCardGroups = $derived(
    view.decision?.kind === 'cards-targets' ? view.decision.cardGroups : undefined,
  );
  $effect(() => {
    if (!autoTargetEnabled || !view.decision) return;
    const next = selectForcedTargets(selection, inspect);
    if (next !== selection) selection = next;
  });
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
  const decisionHint = $derived.by(() => {
    if (view.error) return view.error;
    if (notice) return notice;
    if (preview.prompt) return preview.prompt;
    if (selectedOffer && !preview.valid && preview.reason)
      return `${selectedOffer.label}：${preview.reason}`;
    if (selectedOffer?.description) return `${selectedOffer.label}：${selectedOffer.description}`;
    if (view.decision?.prompt) return view.decision.prompt;
    if (view.status === 'idle') return '设置席位，开始本地对局';
    if (view.paused) return '对局已暂停';
    if (view.result) return '对局已结束';
    if (view.automated) {
      if (view.control?.delegated && view.automated === view.viewer) return '托管 AI 正在代你操作…';
      return `${view.automated} 正在思考…`;
    }
    if (remoteLobby?.waitingFor) return `等待 ${remoteLobby.waitingFor} 选择`;
    return '正在结算…';
  });
  const decisionDetail = $derived.by(() => {
    if (view.control?.reason) return view.control.reason;
    if (selectedOffer && selectedOffer.kind !== 'physical') {
      const count = selectedOffer.count;
      return `材料 ${selection.cards.length} / ${count.min}${count.max === count.min ? '' : `–${count.max === 'all' ? selectedOffer.cards.length : count.max}`} · 目标 ${selection.targets.length} / ${preview.targetCount.min} · ${preview.reason}`;
    }
    if (view.decision) return preview.reason;
    if (view.control?.delegated) return '已托管 · 可随时收回操作';
    if (remoteLobby?.waitingFor) return '对方选择后继续结算';
    return '公开记录随结算更新 · 右键或长按查看牌面';
  });
  $effect(() => {
    if (!catalog) return;
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
    const current = session;
    settled = true;
    if (!current) {
      unsubscribe = () => {};
      remoteLobby = null;
      remoteState = null;
      remoteEpoch = 0;
      remoteBaseline = 0;
      remoteRetryable = false;
      decisionKey = '';
      view = waitingView();
      return;
    }
    const unwatch = current.watchSettled((next) => {
      if (session === current) settled = next;
    });
    const unlisten = current.subscribe((next) => {
      // 单机在开局前失败（装配失败、主持端未运行）时回到大厅并提示，而非停在空桌。
      if (current.solo && next.error && !next.players.length) {
        queueMicrotask(() => {
          if (session === current) useSession(null, next.error);
        });
        return;
      }
      const previousRound = remoteLobby?.round;
      const previousEditing = remoteLobby?.editing;
      const previousEpoch = remoteEpoch;
      remoteLobby = current.lobby;
      remoteState = current.connectionState;
      remoteEpoch = current.epoch;
      remoteBaseline = current.actionBaseline;
      remoteRetryable = current.reconnectable;
      const scopeChanged =
        previousRound !== remoteLobby?.round || previousEditing !== remoteLobby?.editing;
      if (previousRound !== remoteLobby?.round) audio?.reset();
      if (remoteEpoch !== previousEpoch) audio?.update(next, false);
      // 藏牌投影暂时省略请求；恢复同一请求时保留草稿，换局或请求变化仍清空。
      const key =
        next.paused && !scopeChanged
          ? decisionKey
          : next.decision
            ? `${next.decision.id}:${next.decision.token}`
            : '';
      const viewerChanged = !next.paused && !view.paused && next.viewer !== view.viewer;
      if (scopeChanged || viewerChanged || key !== decisionKey) {
        selection = empty();
        autoTargetEnabled = true;
        inspectedCard = null;
        skillsOpen = false;
        notice = '';
      }
      if (next.paused) {
        inspectedCard = null;
        skillsOpen = false;
      }
      decisionKey = key;
      view = next;
    });
    unsubscribe = () => {
      unwatch();
      unlisten();
    };
  }
  onMount(() => {
    let mounted = true;
    let offHosting = () => {};
    observeHosting((next) => {
      if (mounted) hosting = next;
    })
      .then((off) => {
        if (mounted) offHosting = off;
        else off();
      })
      .catch((error: unknown) => {
        if (mounted) notice = String(error);
      });
    const playback = new GameAudio();
    audio = playback;
    // 主持端可能与页面同时启动；短暂重试后再提示。
    (async () => {
      for (let attempt = 0; mounted && attempt < 20; attempt++) {
        try {
          const response = await fetch('/catalog');
          if (response.ok) {
            const next = (await response.json()) as HostCatalog;
            if (mounted) catalog = next;
            return;
          }
        } catch {
          /* 主持端尚未就绪。 */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (mounted) notice = '无法读取本机主持端的内容目录；请用 pnpm dev 或 pnpm online 启动。';
    })().catch(() => {});
    savedRoom = rememberedRoom();
    if (
      new URL(location.href).searchParams.has('online') &&
      (!savedRoom || new URL(savedRoom.address).host !== location.host)
    ) {
      connectOnline(location.href);
    }
    subscribe();
    const offVisibility = observeVisibility((active) => {
      visible = active;
      if (!active) {
        inspectedCard = null;
        session?.hide();
      }
    });
    return () => {
      mounted = false;
      offHosting();
      unsubscribe();
      session?.dispose(false);
      offVisibility();
      playback.destroy();
    };
  });
  $effect(() => {
    // 模块与 GPU 实例都属于本次对局，退出后不接纳迟到的模块或初始化。
    if (!tableOpen) return;
    const host = boardHost;
    let active = true;
    let instance: BattleBoard | null = null;
    rendererError = '';
    import('../client/table/board')
      .then(async ({ BattleBoard }) => {
        if (!active) return;
        const current = new BattleBoard();
        instance = current;
        board = current;
        await current.mount(host, (layout) => {
          if (active) tableLayout = layout;
        });
        if (active) rendererReady = true;
      })
      .catch((error: unknown) => {
        if (active) rendererError = String(error);
      });
    return () => {
      active = false;
      instance?.destroy();
      board = null;
      tableLayout = null;
      rendererReady = false;
    };
  });
  $effect(() => {
    board?.update(view);
  });
  $effect(() => {
    board?.setActive(!labOpen && visible);
  });
  $effect(() => {
    audio?.update(view, soundEnabled && visible && !labOpen);
  });

  // 选牌框按内容收缩，以区域中心定位；其余区域仍填满布局给出的矩形。
  const regionStyle = (region: TableRegion | undefined, fitContent = false) =>
    region
      ? `left:${region.left}px;top:${region.top + (fitContent ? region.height / 2 : 0)}px;width:${region.width}px;${fitContent ? 'max-height' : 'height'}:${region.height}px`
      : 'visibility:hidden';
  function useSession(next: RemoteSession | null, message = '') {
    audio?.reset();
    session?.dispose();
    session = next;
    subscribe();
    selection = empty();
    notice = message;
  }
  /** 回到开局页只结束会话；本地配置仍是草稿，等实际开局时再校验。 */
  async function returnToLobby() {
    if (hosting.room || hosting.busy) {
      try {
        await closeDesktopRoom();
      } catch (error) {
        notice = String(error);
        return;
      }
    }
    const wasOnline = online;
    useSession(null);
    savedRoom = rememberedRoom();
    lobbyPage = 'solo';
    if (wasOnline) history.replaceState(null, '', location.pathname);
  }
  function connectOnline(address: string, resume?: string) {
    let next: RemoteSession;
    try {
      next = new RemoteSession(address, resume ? { resume } : {});
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
      return;
    }
    useSession(next);
  }
  async function createRoom(port: number, setup: RoomSetup) {
    notice = '';
    lastRoomSetup = { ...setup, lineup: [...setup.lineup] };
    lastRoomPort = port;
    try {
      const room = await createDesktopRoom(port, { ...setup, practice: enablePractice });
      connectOnline(room.local);
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    }
  }
  function startLocalMatch() {
    if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) {
      practiceOptionsOpen = true;
      notice = '牌局种子需为 1 至 4294967295 的整数';
      return;
    }
    if (!catalog) return;
    // 只发送普通开局草稿；本机主持端装配内容并开局，失败时经协议报回。
    let aiGuide: SoloSetup['aiGuide'];
    try {
      const raw = sessionStorage.getItem('sgs.aiGuide');
      if (raw) aiGuide = JSON.parse(raw) as SoloSetup['aiGuide'];
    } catch {
      aiGuide = undefined;
    }
    const solo: SoloSetup = {
      seed,
      preset: deckPreset,
      ...(enablePractice ? { practice: true } : {}),
      ...(manualPractice ? { count: playerCount } : { lineup: localLineup }),
      ...(aiGuide ? { aiGuide } : {}),
    };
    useSession(new RemoteSession(location.href, { solo }));
  }
  async function chooseLobbyGeneral(id: string) {
    general = id;
    manualPractice = false;
    lobbyPage = 'solo';
    notice = '';
    await tick();
    document.querySelector<HTMLElement>('.lobby-heading h1')?.focus();
  }
  function selectCard(id: string) {
    const decision = view.decision;
    if (!decision) return;
    if (decision.kind === 'cards-targets') {
      if (!cardOptions.some((item) => item.id === id && item.selectable)) return;
      selection = {
        ...selection,
        cards: selection.cards.includes(id)
          ? selection.cards.filter((card) => card !== id)
          : decision.cardCount.max === 1
            ? [id]
            : [...selection.cards, id],
      };
    } else if (selectedOffer && selectedOffer.kind !== 'physical') {
      if (
        selectedOffer.kind === 'active'
          ? !cardOptions.some((card) => card.id === id && card.selectable)
          : !selectedOffer.cards.includes(id)
      ) {
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
      };
    } else {
      const offer = offers.find((offer) => offer.cardId === id);
      if (!offer) {
        notice = '此牌当前不能使用，可右键或长按查看说明';
        return;
      }
      selection = {
        offer: selection.offer === offer.id ? null : offer.id,
        cards: [],
        targets: selection.targets,
      };
    }
    autoTargetEnabled = true;
    retainTargets();
    notice = '';
  }
  /** 换牌或技能时保留仍可选的目标，逐项重查以保留有意义的次序。 */
  function retainTargets() {
    const decision = view.decision;
    if (!decision) return;
    const previous = selection.targets;
    let next = { ...selection, targets: [] as string[] };
    for (const id of previous) {
      const feedback = inspect(next);
      if (feedback.targets.some((target) => target.id === id && target.selectable))
        next = { ...next, targets: [...next.targets, id] };
    }
    selection = next;
  }
  function selectOffer(id: string) {
    const offer = offers.find((offer) => offer.id === id);
    if (!offer) return;
    if (selection.offer === id) selection = empty();
    else {
      const previous = selectedOffer?.cardId ? [selectedOffer.cardId] : selection.cards;
      const cards = previous.filter((card) => offer.cards.includes(card));
      selection = {
        offer: id,
        cards: offer.count.max === 'all' ? cards : cards.slice(0, offer.count.max),
        targets: selection.targets,
      };
      retainTargets();
    }
    autoTargetEnabled = true;
    notice = '';
  }
  function selectTarget(id: string) {
    if (!targetOptions.some((item) => item.id === id && item.selectable)) return;
    autoTargetEnabled = !selection.targets.includes(id);
    selection = {
      ...selection,
      targets: selection.targets.includes(id)
        ? selection.targets.filter((target) => target !== id)
        : preview.targetCount.max === 1
          ? [id]
          : [...selection.targets, id],
    };
    retainTargets();
    notice = '';
  }
  async function reply(value?: unknown) {
    const decision = view.decision;
    const current = session;
    if (!decision || !current) return;
    const key = decisionKey;
    const epoch = remoteEpoch;
    const result = await (value === undefined
      ? current.reply(decision.id, decision.token, selection)
      : current.answer(decision.id, decision.token, value));
    if (
      result.kind === 'rejected' &&
      current === session &&
      key === decisionKey &&
      epoch === remoteEpoch
    )
      notice = result.message;
  }
  async function cancel() {
    const decision = view.decision;
    const current = session;
    if (!decision || !current) return;
    const key = decisionKey;
    const epoch = remoteEpoch;
    const result = await current.cancel(decision.id, decision.token);
    if (
      result.kind === 'rejected' &&
      current === session &&
      key === decisionKey &&
      epoch === remoteEpoch
    )
      notice = result.message;
  }
  function cancelDraft() {
    if (view.decision?.kind === 'play-action' && selection.offer) {
      selection = empty();
      autoTargetEnabled = false;
      notice = '';
      return;
    }
    return cancel();
  }
  async function roomReply(action: (remote: RemoteSession) => Promise<ReplyResult>) {
    const current = session;
    if (!current?.online) return;
    const round = current.lobby?.round;
    notice = '';
    const result = await action(current);
    if (session === current && current.lobby?.round === round && result.kind === 'rejected')
      notice = result.message;
  }
  async function toggleDelegation() {
    const current = session;
    if (!view.control || !current) return;
    const round = remoteLobby?.round;
    const result = await current.setDelegated(!view.control.delegated);
    if (session === current && remoteLobby?.round === round && result.kind === 'rejected')
      notice = result.message;
  }
  function available(id: string): boolean {
    if (view.decision?.kind === 'cards-targets')
      return cardOptions.some((item) => item.id === id && item.selectable);
    if (selectedOffer?.kind === 'active')
      return cardOptions.some((card) => card.id === id && card.selectable);
    return selectedOffer?.kind === 'viewAs'
      ? selectedOffer.cards.includes(id)
      : offers.some((offer) => offer.cardId === id);
  }
  async function keydown(event: KeyboardEvent) {
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
      autoTargetEnabled = false;
      notice = '';
    }
    if (event.key === 'Enter' && preview.valid) {
      event.preventDefault();
      await reply();
    }
    const id =
      view.decision?.kind === 'cards-targets'
        ? view.decision.cards[Number(event.key) - 1]?.id
        : view.hand[Number(event.key) - 1]?.id;
    if (id) selectCard(id);
  }
</script>

<svelte:window onkeydown={keydown} />

<div
  class="app-shell"
  class:motion-off={!animations}
  class:setup={view.status === 'idle'}
  aria-busy={!settled}
>
  <header class="app-header">
    <a
      href="/"
      class="brand"
      aria-label="弈 三国杀新章"
      onclick={async (event) => {
        if (view.status !== 'idle' || online) return;
        event.preventDefault();
        lobbyPage = 'home';
        notice = '';
        await tick();
        document.querySelector<HTMLElement>('.lobby-shell')?.scrollTo({ top: 0 });
        document.querySelector<HTMLElement>('.launch-title h1')?.focus({ preventScroll: true });
      }}
      ><span class="brand-seal">弈</span>
      <div><strong>三国杀<span>新章</span></strong><small>SANGUOSHA / NEXT</small></div></a
    >
    <nav class="phase-track" aria-label="当前阶段">
      {#each phases as [kind, name] (kind)}<span class:current={view.phase === kind}>{name}</span
        >{/each}
    </nav>
    <div class="header-actions">
      {#if hosting.room}<HostedRoomInfo
          room={hosting.room}
          busy={hosting.busy}
          open={view.status === 'idle'}
          onclose={returnToLobby}
        />{/if}
      <span class="room-tag"
        >{online
          ? `联机 · ${remoteLobby?.seat ?? '连接中'}`
          : manualSession
            ? '手动演练'
            : '单机 · 托管 AI'}</span
      >{#if online}<button
          class="subtle-button"
          data-back-action={view.status === 'idle' ? '' : undefined}
          onclick={returnToLobby}>离开联机</button
        >{/if}{#if view.status !== 'idle' || lobbyPage === 'content'}<button
          class="subtle-button"
          onclick={() => {
            labOpen = true;
          }}>动画验证 ↗</button
        >{/if}
    </div>
  </header>

  {#if view.status === 'idle'}
    <LobbyShell
      page={online ? 'room' : lobbyPage}
      ready={catalog !== null}
      summary={implementedCardCount + ' 种牌 · ' + generals.length + ' 名武将'}
      {matchSummary}
      seats={lobbySeats}
      message={notice}
      onstart={startLocalMatch}
      oncount={(count: number) => {
        playerCount = count;
      }}
      resumeSeat={savedRoom?.seat}
      onpage={(page: LobbyPage) => {
        lobbyPage = page;
        notice = '';
      }}
      onresume={() => {
        if (savedRoom) connectOnline(savedRoom.address, savedRoom.key);
      }}
    >
      {#if online}
        <RoomLobby
          lobby={remoteLobby}
          message={notice}
          onready={(enabled: boolean) => roomReply((remote) => remote.setReady(enabled))}
          ongeneral={(id: string) => roomReply((remote) => remote.chooseGeneral(id))}
        />
      {:else}
        <section
          class="lobby-panel setup-panel"
          aria-label="开局设置"
          hidden={lobbyPage !== 'solo'}
        >
          <div class="solo-preview" aria-label="所选武将预览">
            <div class="solo-portrait">
              {#key general}
                <img
                  src={(manualPractice || failedPortrait === general
                    ? undefined
                    : portraitOf(general)) ?? skinImage('ui/photo/unknown.jpg')}
                  alt=""
                  onerror={() => {
                    failedPortrait = general;
                  }}
                />
              {/key}
              {#if !manualPractice && selectedGeneral}<span>{selectedGeneral.kingdom}</span>{/if}
            </div>
            <div>
              <span class="solo-caption">{manualPractice ? '手动演练' : '甲席 · 你的武将'}</span>
              <h2>{manualPractice ? '自由演练' : (selectedGeneral?.name ?? '选择武将')}</h2>
              {#if !manualPractice && selectedGeneral}
                <div class="solo-general-info" aria-label="所选武将资料">
                  <span>{selectedGeneral.kingdom}势力</span>
                  <span>体力上限 <strong>{selectedGeneral.maxHp}</strong></span>
                </div>
              {/if}
              <p>
                {manualPractice
                  ? '逐席操作，检验技能与结算。'
                  : '你执掌甲席，其余角色由托管 AI 行动。'}
              </p>
            </div>
            <button
              class="solo-browse"
              aria-label="浏览武将一览"
              onclick={async () => {
                lobbyPage = 'content';
                await tick();
                document.querySelector<HTMLElement>('.lobby-heading h1')?.focus();
              }}>武将一览 <span aria-hidden="true">↗</span></button
            >
          </div>
          <fieldset class="lobby-fields solo-settings">
            <legend>牌局设置</legend>
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
            >
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
            ><label
              >牌组 <select bind:value={deckPreset}
                >{#each selectedContent.decks as deck (deck.id)}<option value={deck.id}
                    >{deck.label}</option
                  >{/each}</select
              ></label
            >
          </fieldset>
          <section class="solo-roster" aria-label="本局阵容预览">
            <header>
              <h3>本局席位</h3>
              <span>{manualPractice ? '全部手动控制' : `你与 ${playerCount - 1} 位托管 AI`}</span>
            </header>
            <ol>
              {#each lobbySeats as seat (seat.seat)}
                <li class:human={seat.controller === '你'}>
                  <img src={seat.portrait} alt="" />
                  <div>
                    <strong>{seat.name}</strong>
                    <span>{seat.seat} · {seat.controller}</span>
                  </div>
                </li>
              {/each}
            </ol>
          </section>
          <details class="solo-options" bind:open={practiceOptionsOpen}>
            <summary
              ><span>演练与复现</span><small
                >{manualPractice ? '全部手动' : '托管 AI'} · 种子 {seed}</small
              ></summary
            >
            <div class="lobby-fields">
              <div class="seed-option">
                <label
                  >牌局种子 <input
                    type="number"
                    min="1"
                    max="4294967295"
                    bind:value={seed}
                    aria-describedby="practice-seed-help"
                  /></label
                >
                <small id="practice-seed-help">相同种子与配置可复现开局。</small>
              </div>
              <label class="practice-toggle"
                ><input type="checkbox" bind:checked={manualPractice} />手动演练（内容调试）</label
              >
            </div>
          </details>
          {#if notice}<p role="alert">
              {notice}
            </p>{/if}
          <div class="solo-start">
            <div><strong>准备就绪</strong><small>{matchSummary}</small></div>
            <button class="confirm-button" onclick={startLocalMatch}>开始单机对局 →</button>
          </div>
        </section>
        <section
          class="lobby-panel network-panel"
          aria-label="联机入口"
          hidden={lobbyPage !== 'network'}
        >
          <NetworkSetup
            {hosting}
            generals={selectedContent.generals}
            decks={selectedContent.decks}
            seats={seatNames}
            initialSetup={lastRoomSetup}
            initialPort={lastRoomPort}
            onconnect={connectOnline}
            oncreate={createRoom}
          />
          {#if notice}<p role="alert">{notice}</p>{/if}
        </section>
        <aside
          class="lobby-panel lobby-content"
          aria-label="内置内容选择"
          hidden={lobbyPage === 'home'}
        >
          {#if lobbyPage === 'solo' && !manualPractice && selectedGeneral}
            <section class="lobby-general-skills" aria-label="所选武将技能">
              <span class="lobby-section-caption">甲席 · 你的武将</span>
              <h2>{selectedGeneral.name} · 技能</h2>
              <dl>
                {#each selectedGeneralSkills as skill (skill.id)}
                  <div>
                    <dt>{skill.name}{skill.lord ? ' · 主公技' : ''}</dt>
                    <dd>{skill.description || '当前内容尚未提供技能说明。'}</dd>
                  </div>
                {/each}
              </dl>
              {#if selectedGeneralSkills.length === 0}<p>该武将未配置技能。</p>{/if}
            </section>
          {/if}
          <h2>{lobbyPage === 'content' ? '内置内容' : '本局内容'}</h2>
          <p>标准与 EX 牌组就绪。机制演武提供额外武将，用于复杂技能的自由演练。</p>
          <div class="content-stats" aria-label="可用内容统计">
            <div><strong>{generals.length}</strong><span>名武将</span></div>
            <div><strong>{implementedCardCount}</strong><span>种牌</span></div>
          </div>
          <fieldset class="content-options">
            <legend>内置内容</legend>
            <span class="content-choice"
              ><label class="practice-toggle"
                ><input type="checkbox" bind:checked={enablePractice} />机制演武</label
              ></span
            >
          </fieldset>
          <small
            >当前 {implementedCardCount} 种牌 · {generals.length} 名武将。选择用于单机与创建房间，加入房间时使用主持端内容。</small
          >
        </aside>
        {#if lobbyPage === 'content'}
          <GeneralGallery
            entries={generals.map((item) => ({
              id: item.id,
              name: item.name,
              kingdom: item.kingdom,
              maxHp: item.maxHp,
              portrait: item.portrait,
            }))}
            selected={general}
            onselect={chooseLobbyGeneral}
          />
        {/if}
      {/if}
    </LobbyShell>
  {/if}
  <main
    class="game-layout"
    class:lobby-hidden={view.status === 'idle'}
    inert={view.status === 'idle'}
    aria-hidden={view.status === 'idle'}
  >
    <section class="table-column" aria-label="对局战场">
      <div class="table-topline">
        <span
          ><b>{online && view.status === 'idle' ? '房间' : '演武场'}</b><em
            >{online && view.status === 'idle'
              ? remoteLobby
                ? `${remoteLobby.lineup.length} 席 · ${remoteLobby.deckName}`
                : '正在连接主持端'
              : `${view.players.length} 人身份局 · ${view.deckName}`}</em
          ></span
        >
        <div class="table-state">
          {#if online && view.status === 'idle'}<span>等待玩家准备</span
            >{:else if online && remoteState === 'connected' && remoteLobby?.phase === 'playing' && disconnected.length}
            <span role="status" aria-label="断线玩家"
              >{disconnected.join('、')} 已断开，等待重连</span
            >
            <button class="subtle-button" onclick={() => roomReply((remote) => remote.endRound())}
              >结束本局</button
            >
          {:else}
            <span class="pile-count">牌堆 {view.drawCount} ／ 弃牌 {view.discardCount}</span><span
              class="turn-label"
              >第 {view.turn}
              {view.extraTurn ? '额外回合' : '回合'} ／ {view.error
                ? '本局中止'
                : view.result
                  ? '对局结束'
                  : (view.active ?? (view.turn > 0 ? '回合衔接' : '尚未开局'))} · {phaseName}</span
            >
          {/if}
        </div>
      </div>
      <div class="table-surface">
        <div class="board-canvas" bind:this={boardHost} data-testid="battle-canvas"></div>
        {#key session}{#key (remoteLobby?.round ?? 0) + ':' + Boolean(remoteLobby?.editing) + ':' + remoteEpoch}<TargetLines
              {view}
              layout={tableLayout}
              targets={displayedTargets}
              baseline={remoteBaseline}
              active={animations &&
                visible &&
                !view.paused &&
                !labOpen &&
                (!online || remoteState === 'connected')}
            />{/key}{/key}
        <div class="target-overlays">
          {#each view.players as player, i (player.id)}
            {@const seat = tableLayout?.seats[i]}
            {@const selectable = targetOptions.some(
              (target) => target.id === player.id && target.selectable,
            )}
            {#if seat}<PlayerPanel
                {player}
                {seat}
                index={i}
                selected={displayedTargets.includes(player.id)}
                {selectable}
                choosing={Boolean(selection.offer) ||
                  targetOptions.some((target) => target.selectable)}
                order={displayedTargets.includes(player.id) && preview.targetCount.max !== 1
                  ? displayedTargets.indexOf(player.id) + 1
                  : undefined}
                active={view.active === player.id && view.status === 'running'}
                animated={animations && visible && !view.paused && !labOpen}
                {selectedCards}
                handCount={view.hand.length}
                {available}
                onselect={() => selectTarget(player.id)}
                oncard={(card: CardView) => {
                  if (player.self && available(card.id)) selectCard(card.id);
                  else inspectedCard = card;
                }}
                oninspect={(card: CardView) => {
                  inspectedCard = card;
                }}
              />{/if}
          {/each}
        </div>
        <div
          class="battlefield"
          style={view.status === 'idle' || view.result || view.error
            ? 'inset:0;width:100%;height:100%'
            : regionStyle(tableLayout?.arena)}
        >
          {#if view.error}
            <section
              class="lobby"
              aria-label={online && remoteState !== 'connected' ? '联机连接' : '对局中止'}
            >
              <span class="eyebrow"
                >{online && remoteState !== 'connected' ? 'CONNECTION' : 'GAME STOPPED'}</span
              >
              <h1>
                {online && remoteState !== 'connected'
                  ? remoteState === 'connecting'
                    ? '正在重连'
                    : '连接已断开'
                  : '本局已中止'}
              </h1>
              <p>{view.error}</p>
              {#if remoteRetryable}<button
                  class="confirm-button"
                  onclick={() => {
                    session?.reconnect();
                  }}>重连原席位 →</button
                >{/if}
              {#if online && session?.connected}
                <button
                  class="confirm-button"
                  disabled={remoteLobby?.phase !== 'finished'}
                  onclick={() => roomReply((remote) => remote.prepare())}>返回房间 →</button
                >
              {/if}
              <button class="confirm-button" data-back-action onclick={returnToLobby}
                >{online ? '返回单机 →' : '重新开局 →'}</button
              >
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
              {#if online && session?.connected}
                <button
                  class="confirm-button"
                  disabled={remoteLobby?.phase !== 'finished'}
                  onclick={() => roomReply((remote) => remote.prepare())}>准备下一局 →</button
                >
              {/if}
              <button class="confirm-button" data-back-action onclick={returnToLobby}
                >{online ? '返回单机 →' : '再开一局 →'}</button
              >
            </section>
          {:else if view.decision?.kind !== 'arrange' && view.pools.some((pool) => pool.cards.length)}
            <div
              class="public-pools"
              data-selection-input
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
        </div>
        <div class="skills-dock" aria-label="当前席位技能" style={regionStyle(tableLayout?.skills)}>
          {#if ownSeat}<SkillArea
              skills={ownSeat.skills}
              {offers}
              selected={selection.offer}
              onselect={selectOffer}
              oninspect={() => {
                skillsOpen = true;
              }}
            />{/if}
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
          <div class="hand-cards" data-selection-input data-testid="hand-cards">
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
        {#if view.decision?.kind === 'cards-targets' || selectedOffer?.kind === 'active'}<div
            class="choice-options"
            data-selection-input
            class:owned-card-options={Boolean(ownedCardGroups)}
            style={regionStyle(
              ownedCardGroups ? tableLayout?.ownedChoices : tableLayout?.choices,
              Boolean(ownedCardGroups),
            )}
          >
            {#if ownedCardGroups}<OwnedCardPicker
                groups={ownedCardGroups}
                cards={cardOptions}
                selected={selection.cards}
                onselect={selectCard}
                oninspect={(card: CardView) => {
                  inspectedCard = card;
                }}
              />{:else}{#each cardOptions.filter((item) => !materials.some((card) => card.id === item.id) && !view.pools.some( (pool) => pool.cards.some((card) => card.id === item.id), )) as item (item.id)}<button
                  class="subtle-button"
                  aria-pressed={selection.cards.includes(item.id)}
                  disabled={!cardOptions.some(
                    (candidate) => candidate.id === item.id && candidate.selectable,
                  )}
                  onclick={() => selectCard(item.id)}>{item.label}</button
                >{/each}{/if}
          </div>{/if}

        <div
          class="decision-bar"
          class:waiting={!view.decision}
          style={regionStyle(tableLayout?.decision)}
          data-decision-kind={view.decision?.kind ?? ''}
          data-decision-key={view.decision ? `${view.decision.id}:${view.decision.token}` : ''}
        >
          <div class="decision-copy" aria-live="polite">
            <span class="decision-index">{view.decision ? '弈' : '·'}</span>
            <div>
              <strong data-testid="decision-hint">{decisionHint}</strong><small
                >{decisionDetail}</small
              >
            </div>
          </div>
          {#if view.decision}<div class="decision-actions">
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
                ><button
                  class="cancel-button"
                  disabled={!view.decision?.optional}
                  onclick={cancelDraft}
                  >{view.decision?.kind === 'play-action' && selection.offer
                    ? '取消选择'
                    : (view.decision?.cancelLabel ??
                      (view.decision?.kind === 'play-action'
                        ? '结束出牌'
                        : view.decision?.kind === 'use-card'
                          ? view.decision.purpose === 'counter'
                            ? '放弃反制'
                            : view.decision.purpose === 'rescue'
                              ? '放弃救援'
                              : '放弃使用'
                          : '放弃响应'))}</button
                >{/if}
            </div>{/if}
        </div>
        <nav class="table-tools" aria-label="牌桌工具">
          {#if view.control}<button
              aria-label={view.control.delegated ? '收回操作' : 'AI 托管'}
              aria-pressed={view.control.delegated}
              disabled={view.status !== 'running' || view.paused}
              onclick={toggleDelegation}>{view.control.delegated ? '收回' : '托管'}</button
            >{/if}
          <button
            aria-label="结算记录"
            onclick={() => {
              logOpen = !logOpen;
            }}>记录</button
          ><button
            aria-label={online ? '隐藏联机手牌' : manualSession ? '隐藏手牌' : '暂停对局'}
            data-back-action={view.status === 'running' && !view.paused && !logOpen
              ? ''
              : undefined}
            disabled={!view.viewer || view.status !== 'running'}
            onclick={() => session?.hide()}>{online || manualSession ? '藏牌' : '暂停'}</button
          >
        </nav>
      </div>
    </section>
    <aside class="journal" class:open={logOpen} aria-label="结算记录">
      <button
        class="journal-close subtle-button"
        data-back-action={logOpen ? '' : undefined}
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
    <span>{online ? '联机运行 · 主持端结算' : '单机运行 · 本机主持端结算'}</span><span
      class="footer-center">SGS_NG ／ 自由落子</span
    >
    <div>
      <button
        class="text-button"
        aria-label="音效与语音"
        aria-pressed={soundEnabled}
        onclick={() => {
          soundEnabled = !soundEnabled;
        }}>声音{soundEnabled ? '开启' : '关闭'}</button
      >
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
          ? (session?.inspectAnswer(view.decision.id, view.decision.token, choice) ?? {
              valid: false,
              reason: '当前不可操作',
            })
          : { valid: false, reason: '选择已结束' }}
      onconfirm={(choice) => reply(choice)}
      onpause={() => session?.hide()}
      oncancel={cancel}
      privateContent={hasPrivatePool}
    />
  {/key}
{/if}
{#if view.paused}<PauseCurtain
    onexit={returnToLobby}
    {online}
    delegated={view.control?.delegated ?? false}
    onresume={() => session?.resume()}
  />{/if}
{#if view.handoff}{#key view.handoff.key}<SeatCurtain
      name={view.handoff.name}
      turn={view.handoff.turn}
      extra={view.handoff.extra}
      onconfirm={() => {
        if (view.handoff) session?.confirmSeat(view.handoff.key);
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
