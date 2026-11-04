import { createContent } from '../../src/content/catalog';
import standard from '../../src/content/standard';
import harbor from '../../examples/content/harbor';
import gallery from '../../examples/content/gallery';
import { afterEach, expect, it, vi } from 'vitest';
import { createGameServer } from '../../src/server/server';
import { RemoteSession } from '../../src/app/session';
import { observeAgent } from '../../src/host/agent-observation';
import { decideBasic } from '../../src/host/basic-agent';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { inspectSelection } from '../../src/host/selection';
import { createRoomOptions } from '../../src/host/setup';
import { defaultRoomSetup, type RoomSetup } from '../../src/protocol';
import type { RoleMatch } from '../../src/host/role-match';
import { NetworkRoom } from '../../src/host/room';
import type { NetworkRoomOptions, RoomPlayer } from '../../src/host/room';
import type { LobbyView, ServerMessage } from '../../src/protocol/wire';
import { finishGame } from '../../src/rules/game/end';
import { WebSocketServer } from 'ws';
import { protocolHash, contentHash, buildMismatch } from '../../src/protocol/build';
import { readFile } from 'node:fs/promises';
import { defaultContent, practiceContent } from '../../src/host/content';
import { Match } from '../../src/host/role-match';
import { Game } from '../../src/sdk';

const cleanup: (() => void | Promise<void>)[] = [];

it('日常主持直接选择内置源码，与单机共享目录而无需外部模块或版本清单', async () => {
  for (const practice of [false, true]) {
    const options = createRoomOptions({
      ...defaultRoomSetup,
      practice,
      preset: practice ? 'workshop:showcase' : 'standard:identity',
      lineup: [practice ? 'workshop:guest' : 'standard:guanyu', 'standard:caocao'],
    });
    const match = options.createMatch(options.players, options.seed);
    await match.prepare();
    expect(match.content).toBe(practice ? practiceContent : defaultContent);
    expect(match.room.world.snapshot.players).toHaveLength(2);
    expect(match.room.world.snapshot.cards).toHaveLength(practice ? 44 : 108);
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
  }
});
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

it('创建草稿和选项后续修改不改变房间目录、种子或实际建局，玩家仍可正常选将', async () => {
  const setup = {
    ...defaultRoomSetup,
    seed: 17,
    lineup: defaultRoomSetup.lineup.slice(0, 2),
  };
  const plan = createRoomOptions(setup);
  const matches: RoleMatch[] = [];
  class Options implements NetworkRoomOptions {
    seed = plan.seed;
    deckName = plan.deckName;
    players = plan.players;
    generals = plan.generals.map((general) => ({ ...general }));
    #create = plan.createMatch;

    createMatch(players: readonly RoomPlayer[], seed: number) {
      const match = this.#create(players, seed);
      matches.push(match);
      return match;
    }
  }
  const options = new Options();
  const room = new NetworkRoom(options, 0);
  cleanup.push(() => room.dispose());
  const originalName = options.generals[0]!.name;
  const originalGeneral = options.generals[0]!.id;
  setup.preset = 'missing:deck';
  setup.lineup[0] = 'standard:zhangfei';
  options.seed = 99;
  options.deckName = '改写牌组';
  options.generals[0]!.name = '改写武将';
  options.createMatch = () => {
    throw new Error('Changed factory must not run.');
  };

  type Frame = Extract<ServerMessage, { kind: 'view' }> & { readonly lobby: LobbyView };
  let view: Frame | undefined;
  const a = room.join((frame) => {
    if (frame.kind === 'view') view = frame as Frame;
  })!;
  const b = room.join(() => {})!;
  await vi.waitFor(() => expect(view?.lobby.seed).toBe(17));
  expect(view!.lobby.deckName).toBe(plan.deckName);
  expect(view!.lobby.generals.find((general) => general.id === originalGeneral)?.name).toBe(
    originalName,
  );
  expect(view!.lobby.lineup[0]!.generalId).toBe('standard:guanyu');
  expect(a.command(0, { kind: 'choose-general', general: 'standard:zhenji' })).toEqual({
    kind: 'accepted',
  });
  expect(a.command(0, { kind: 'ready', enabled: true })).toEqual({ kind: 'accepted' });
  expect(b.command(0, { kind: 'ready', enabled: true })).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(matches).toHaveLength(1));
  expect(matches[0]!.deckName).toBe(plan.deckName);
  expect(matches[0]!.initial.cards).toHaveLength(108);
  expect(matches[0]!.content).toBe(defaultContent);
  await vi.waitFor(() => expect(view?.lobby.round).toBe(1));
  expect(view!.lobby.seed).toBe(17);
  expect(view!.lobby.lineup[0]!.generalId).toBe('standard:zhenji');
});

it('传输断开与重连保留同一规则实例、原请求和手牌；旧 socket 不覆盖恢复结果，断线可明确结束', async () => {
  const NativeSocket = globalThis.WebSocket;
  const sockets: WebSocket[] = [];
  const frames: ServerMessage[] = [];
  vi.stubGlobal(
    'WebSocket',
    class extends NativeSocket {
      constructor(address: string | URL, protocols?: string | string[]) {
        super(address, protocols);
        sockets.push(this);
        this.addEventListener('message', (event: MessageEvent<string>) =>
          frames.push(JSON.parse(event.data) as ServerMessage),
        );
      }
    },
  );
  cleanup.push(() => {
    vi.unstubAllGlobals();
  });
  const { clients, start, rounds } = await connect(0, undefined, {
    ...defaultRoomSetup,
    seed: 2,
    lineup: defaultRoomSetup.lineup.slice(0, 2),
  });
  const match = await start();
  const self = clients[0]!,
    peer = clients[1]!;
  await vi.waitFor(() => expect(self.view.decision?.kind).toBe('play-action'));
  const request = match.room.decisions.pending[0]!;
  const world = match.room.world.snapshot;
  const hand = self.view.hand.map((card) => card.id);
  expect(hand.length).toBeGreaterThan(0);
  expect(await peer.endRound()).toMatchObject({ kind: 'rejected' });
  const previous = frames.find(
    (frame) => frame.kind === 'view' && frame.view?.decision?.kind === 'play-action',
  )!;
  const socket = sockets[0]!;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
  cleanup.push(() => {
    clock.mockRestore();
  });
  await vi.waitFor(() => expect(clients.every((client) => client.reconnectable)).toBe(true), {
    timeout: 2000,
  });
  clock.mockRestore();
  expect(match.room.decisions.pending[0]).toBe(request);
  expect(match.room.world.snapshot).toBe(world);
  expect(self.view.hand).toEqual([]);
  expect(self.view.decision).toBeNull();
  expect(self.view.players.find((player) => player.self)?.role).toBeNull();
  for (const client of clients) client.reconnect();
  await vi.waitFor(() => expect(clients.every((client) => client.connected)).toBe(true));
  expect(rounds).toEqual([match]);
  expect(self.epoch).toBe(2);
  expect(self.view.hand.map((card) => card.id)).toEqual(hand);
  expect(self.view.decision).toMatchObject({ id: `1:${request.id}`, token: request.token });
  expect(match.room.decisions.pending[0]).toBe(request);
  expect(match.room.world.snapshot).toBe(world);
  const recovered = self.view;
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(previous) }));
  expect(self.view).toBe(recovered);
  for (const client of clients)
    expect(await client.setDelegated(true)).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(clients.every((client) => client.view.result)).toBe(true), {
    timeout: 15_000,
  });
  for (const client of clients) {
    await client.prepare();
  }
  const next = await start();
  sockets[2]!.close();
  await vi.waitFor(() => expect(self.reconnectable).toBe(true));
  await vi.waitFor(() => expect(peer.lobby?.seats[0]?.connected).toBe(false));
  expect(await peer.endRound()).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(peer.lobby?.phase).toBe('finished'));
  self.reconnect();
  await vi.waitFor(() => expect(self.connected).toBe(true));
  expect(self.view.error).toContain('结束本局');
  expect(rounds).toHaveLength(2);
  expect(next.room.decisions.pending).toEqual([]);
  expect(rebuildWorld(next.initial, next.room.history.facts())).toEqual(next.room.world.snapshot);
}, 35_000);

it('主持端组合普通多文件源码，客户端收到二进制立绘与真实决策，离开释放 URL', async () => {
  const image = await readFile('examples/content/harbor/guest.jpg');
  const resource = {
    url: 'sgs-resource:portrait',
    type: 'image/jpeg',
    data: image.toString('base64'),
  };
  const withPortrait = (definition: typeof harbor | typeof gallery) => ({
    ...definition,
    generalViews: definition.generalViews.map((view) => ({ ...view, portrait: resource.url })),
  });
  const content = createContent(standard, withPortrait(harbor), withPortrait(gallery));
  const assets = [resource];
  const plan = createRoomOptions(
    { seed: 2, preset: 'harbor:crossing', humans: 2, lineup: ['gallery:guest', 'standard:guanyu'] },
    content,
  );
  const rounds: RoleMatch[] = [];
  const server = createGameServer(
    {
      ...plan,
      createMatch: (players, seed) => {
        const match = plan.createMatch(players, seed);
        match.room.on(Match.prepared, {
          id: 'resource-looking-option',
          owner: null,
          eligible: () => true,
          async run(ctx) {
            const id = assets[0]!.url;
            await ctx.ask({
              player: '甲席',
              kind: 'choose-option',
              prompt: id,
              optional: false,
              data: { options: [{ id, label: id, selectable: true }] },
              validate: (value) =>
                value === id ? { ok: true, value } : { ok: false, reason: 'Opaque ID changed.' },
            });
          },
        });
        rounds.push(match);
        return match;
      },
    },
    { assets: assets, aiDelayMs: 0 },
  );
  cleanup.push(() => server.close());
  const port = await server.listen(0);
  const clients = [new RemoteSession(`127.0.0.1:${port}`), new RemoteSession(`127.0.0.1:${port}`)];
  cleanup.push(() => clients.forEach((client) => client.dispose()));
  await vi.waitFor(() =>
    expect(clients.every((client) => client.lobby?.seats.every((seat) => seat.connected))).toBe(
      true,
    ),
  );
  expect(clients[1]!.lobby?.lineup.map((entry) => entry.generalId)).toEqual([
    'gallery:guest',
    'standard:guanyu',
  ]);
  for (const client of clients) expect(await client.setReady(true)).toEqual({ kind: 'accepted' });
  const self = clients[0]!;
  await vi.waitFor(() => expect(self.view.decision?.kind).toBe('choose-option'));
  const opaque = self.view.decision!;
  expect(opaque.prompt).toBe(assets[0]!.url);
  if (opaque.kind !== 'choose-option') throw new Error('Missing opaque option.');
  expect(opaque.options[0]!.id).toBe(assets[0]!.url);
  expect(await self.answer(opaque.id, opaque.token, opaque.options[0]!.id)).toEqual({
    kind: 'accepted',
  });
  await vi.waitFor(() => expect(self.view.decision?.kind).toBe('play-action'));
  const urls = clients.map((client) => client.view.players[0]!.portrait!);
  expect(new Set(urls).size).toBe(2);
  for (const url of urls) {
    expect(url).toMatch(/^blob:/);
    expect(Buffer.from(await (await fetch(url)).arrayBuffer())).toEqual(image);
  }
  const request = self.view.decision!;
  if (request.kind !== 'play-action') throw new Error('Missing play request.');
  const offer = request.offers.find((offer) => offer.cardId === 'harbor-card-6')!;
  const selection = { offer: offer.id, cards: [], targets: ['甲席'] };
  const before = self.view.hand.length;
  expect(await self.reply(request.id, request.token, selection)).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(self.view.decision?.kind).toBe('invoke'));
  expect(self.view.decision!.prompt).toContain('潮声');
  expect(await self.answer(self.view.decision!.id, self.view.decision!.token, true)).toEqual({
    kind: 'accepted',
  });
  await vi.waitFor(() => expect(self.view.decision?.kind).toBe('play-action'));
  expect(self.view.hand).toHaveLength(before + 3);
  for (const client of clients)
    expect(await client.setDelegated(true)).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(clients.every((client) => client.view.result)).toBe(true), {
    timeout: 20_000,
  });
  expect(rebuildWorld(rounds[0]!.initial, rounds[0]!.room.history.facts())).toEqual(
    rounds[0]!.room.world.snapshot,
  );
  for (const client of clients) {
    expect(await client.prepare()).toEqual({ kind: 'accepted' });
    expect(await client.setReady(true)).toEqual({ kind: 'accepted' });
  }
  await vi.waitFor(() => expect(clients.every((client) => client.lobby?.round === 2)).toBe(true));
  expect(clients.map((client) => client.view.players[0]!.portrait)).toEqual(urls);
  for (const client of clients) client.dispose();
  for (const url of urls) await expect(fetch(url)).rejects.toThrow();
}, 35_000);

it('构建不同或省略核对的连接不入席、不接收视图，也不影响正在运行的玩家', async () => {
  const { clients, port, start } = await connect();
  const match = await start();
  for (const first of [
    { kind: 'hello', protocol: 'different-rules-with-the-same-version', content: 'x' },
    // 旧客户端只发 build 字段；该别名已删除，不再被当作协议哈希。
    { kind: 'hello', content: 'x', build: protocolHash },
    { sequence: 1, round: 1, command: { kind: 'ready', enabled: true } },
    null,
  ]) {
    const frames: ServerMessage[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/game`);
    cleanup.push(() => socket.close());
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const frame = JSON.parse(event.data) as ServerMessage;
      frames.push(frame);
      if (frame.kind === 'hello') socket.send(JSON.stringify(first));
    });
    await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));
    expect(frames).toEqual([
      {
        kind: 'hello',
        protocol: protocolHash,
        content: contentHash,
        assets: [],
      },
      { kind: 'error', message: first === null ? '消息格式错误。' : buildMismatch },
    ]);
    expect(match.room.status).toBe('running');
    expect(clients.every((client) => client.connected && !client.view.error)).toBe(true);
  }
});

it('客户端拒绝不同构建和旧主持端的视图，在读取手牌或建立席位前结束连接', async () => {
  for (const greeting of [
    { kind: 'hello', protocol: 'other-content', content: 'x' },
    { kind: 'view', lobby: { seat: '甲席' }, view: { hand: ['old-private-card'] } },
  ]) {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const received: unknown[] = [];
    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : data;
        received.push(JSON.parse(bytes.toString('utf8')) as unknown);
      });
      socket.send(JSON.stringify(greeting));
    });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener.');
    const client = new RemoteSession(`127.0.0.1:${address.port}`);
    cleanup.push(() => client.dispose());
    await vi.waitFor(() => expect(client.view.error).toBe(buildMismatch));
    expect(client.connected).toBe(false);
    expect(client.lobby).toBeNull();
    expect(client.view.hand).toEqual([]);
    expect(received).toEqual([]);
  }
});

it('端口冲突正常拒绝，监听失败的主持实例仍可关闭', async () => {
  const first = createGameServer(createRoomOptions(defaultRoomSetup));
  cleanup.push(() => first.close());
  const port = await first.listen(0);
  const second = createGameServer(createRoomOptions(defaultRoomSetup));
  cleanup.push(() => second.close());
  await expect(second.listen(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
});

async function connect(
  aiDelayMs = 0,
  configure?: (match: RoleMatch) => void,
  setup: RoomSetup = defaultRoomSetup,
) {
  const plan = createRoomOptions(setup);
  const rounds: RoleMatch[] = [];
  const host = createGameServer(
    {
      ...plan,
      createMatch: (players, seed) => {
        const match = plan.createMatch(players, seed);
        configure?.(match);
        rounds.push(match);
        return match;
      },
    },
    { aiDelayMs },
  );
  const port = await host.listen(0);
  cleanup.push(() => host.close());
  const clients = plan.players
    .filter((player) => player.human)
    .map(() => new RemoteSession('ws://127.0.0.1:' + port + '/game'));
  cleanup.push(() => clients.forEach((client) => client.dispose()));
  await vi.waitFor(() => {
    expect(clients.every((client) => client.lobby?.seats.every((seat) => seat.connected))).toBe(
      true,
    );
  });
  return {
    clients,
    port,
    rounds,
    start: async () => {
      const previous = rounds.length;
      for (const client of clients)
        expect(await client.setReady(true)).toEqual({ kind: 'accepted' });
      await vi.waitFor(() => expect(rounds).toHaveLength(previous + 1));
      await vi.waitFor(() =>
        expect(
          clients.every((client) => client.lobby?.round === previous + 1 && !client.lobby.editing),
        ).toBe(true),
      );
      return rounds.at(-1)!;
    },
  };
}

it.each([
  [2, 2],
  [6, 3],
  [8, 8],
])(
  '%i 席、%i 位玩家按创建阵容入席，全部准备后复用真实规则至胜负',
  async (count, humans) => {
    const lineup = Array.from({ length: count }, (_, i) =>
      i === 0 ? 'standard:zhenji' : defaultRoomSetup.lineup[i % defaultRoomSetup.lineup.length]!,
    );
    const setup = { ...defaultRoomSetup, seed: 2, lineup, humans };
    const { clients, rounds } = await connect(0, undefined, setup);
    for (const client of clients) {
      expect(client.lobby?.lineup).toHaveLength(count);
      expect(client.lobby?.lineup[0]).toEqual({
        id: '甲席',
        generalId: 'standard:zhenji',
        general: '甄姬',
        portrait: defaultContent.generalViews['standard:zhenji']!.portrait,
      });
      expect(client.view.hand).toEqual([]);
      expect(client.view.decision).toBeNull();
    }
    await Promise.all(clients.slice(0, -1).map((client) => client.setReady(true)));
    await vi.waitFor(() => {
      expect(
        clients.every(
          (client) => client.lobby?.seats.filter((seat) => seat.ready).length === humans - 1,
        ),
      ).toBe(true);
    });
    expect(rounds).toHaveLength(0);
    expect(await clients.at(-1)!.setReady(true)).toEqual({ kind: 'accepted' });
    await vi.waitFor(() => expect(rounds).toHaveLength(1));
    const match = rounds[0]!;
    await vi.waitFor(() => expect(match.progress).not.toBeNull());
    await vi.waitFor(() => expect(clients.every((client) => client.lobby?.round === 1)).toBe(true));
    for (const client of clients)
      expect(await client.setDelegated(true)).toEqual({ kind: 'accepted' });
    await vi.waitFor(() => expect(clients.every((client) => client.view.result)).toBe(true), {
      timeout: 20_000,
      interval: 10,
    });
    expect(match.result).not.toBeNull();
    expect(match.room.decisions.pending).toEqual([]);
    for (const [i, client] of clients.entries()) {
      expect(client.view.viewer).toBe(clients[i]!.human);
      expect(client.view.hand.map((card) => card.id)).toEqual([
        ...match.room.world.zone(`${client.human}:hand`).cards,
      ]);
      expect(client.view.result).toEqual(clients[0]!.view.result);
      expect(client.view.error).toBe('');
    }
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
  },
  30_000,
);

it('托管仅作用于绑定席位；拒绝迟到手动答案，隐藏期间可收回且原请求保持', async () => {
  const { clients, start } = await connect(500, (match) => {
    match.room.on(Match.prepared, {
      id: 'controller-choice',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        await ctx.ask({
          player: '甲席',
          kind: 'choose-option',
          prompt: '控制权',
          data: { options: [{ id: 'ok', label: '确认', selectable: true }] },
          optional: false,
          validate: (input) =>
            input === 'ok' ? { ok: true, value: input } : { ok: false, reason: 'invalid' },
        });
      },
    });
  });
  const match = await start();
  const self = clients[0]!,
    other = clients[1]!;
  await vi.waitFor(() => expect(self.view.decision?.kind).toBe('choose-option'));
  const request = self.view.decision!;
  const before = match.room.world.snapshot;
  expect(await self.setDelegated(true)).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(self.view.control?.delegated).toBe(true));
  expect(other.view.control?.delegated).toBe(false);
  expect(self.view.decision).toBeNull();
  expect(await self.answer(request.id, request.token, 'ok')).toMatchObject({ kind: 'rejected' });
  self.hide();
  expect(await self.setDelegated(false)).toEqual({ kind: 'accepted' });
  self.resume();
  await vi.waitFor(() => expect(self.view.decision?.id).toBe(request.id));
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(match.room.world.snapshot).toEqual(before);
  expect(self.view.decision).toMatchObject({ id: request.id, token: request.token });
  expect(await self.answer(request.id, request.token, 'ok')).toEqual({ kind: 'accepted' });
});

it('同一组 WebSocket 连接完成两局，返回准备页不泄露旧手牌，旧答案不能命中新局', async () => {
  const { clients, start, rounds } = await connect();
  let oldTicket: { id: string; token: number } | null = null;
  for (let round = 1; round <= 2; round++) {
    const match = await start();
    await vi.waitFor(() => expect(clients.some((client) => client.view.decision)).toBe(true));
    expect(clients.every((client) => !client.view.control?.delegated)).toBe(true);
    const ticket = clients.find((client) => client.view.decision)!.view.decision!;
    if (oldTicket) {
      const before = match.room.world.snapshot;
      expect(await clients[0]!.answer(oldTicket.id, oldTicket.token, null)).toMatchObject({
        kind: 'rejected',
      });
      expect(match.room.world.snapshot).toEqual(before);
      expect(ticket.id).not.toBe(oldTicket.id);
    } else oldTicket = ticket;
    for (const client of clients)
      expect(await client.setDelegated(true)).toEqual({ kind: 'accepted' });
    await vi.waitFor(() => expect(match.result).not.toBeNull(), { timeout: 15_000, interval: 10 });
    await vi.waitFor(() =>
      expect(
        clients.every((client) => client.view.result && client.lobby?.phase === 'finished'),
      ).toBe(true),
    );
    expect(clients.map((client) => client.view.viewer)).toEqual(['甲席', '乙席']);
    expect(clients.every((client) => client.lobby?.round === round && !client.view.decision)).toBe(
      true,
    );
    expect(match.room.decisions.pending).toEqual([]);
    expect(match.room.world.snapshot.cards).toHaveLength(108);
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
    if (round === 1) {
      expect(await clients[0]!.prepare()).toEqual({ kind: 'accepted' });
      await vi.waitFor(() => expect(clients[0]!.lobby?.editing).toBe(true));
      expect(clients[0]!.view.players).toEqual([]);
      expect(clients[0]!.view.hand).toEqual([]);
      expect(clients[1]!.view.result).toEqual(match.result);
      expect(await clients[0]!.chooseGeneral('standard:zhenji')).toEqual({ kind: 'accepted' });
      expect(await clients[1]!.prepare()).toEqual({ kind: 'accepted' });
      await vi.waitFor(() => expect(clients.every((client) => client.lobby?.editing)).toBe(true));
    }
  }
  expect(rounds).toHaveLength(2);
  expect(rounds[0]).not.toBe(rounds[1]);
}, 40_000);

it('两个真实 WebSocket 客户端绑定不同席位，复用预览并完整结算身份局', async () => {
  // 回复帧可以先于合并发布的视图到达；用真实传输保留这个时序差。
  const join = Object.getOwnPropertyDescriptor(NetworkRoom.prototype, 'join')!
    .value as NetworkRoom['join'];
  const publications = new Set<ReturnType<typeof setTimeout>>();
  const delayed = vi.spyOn(NetworkRoom.prototype, 'join').mockImplementation(function (
    this: NetworkRoom,
    send,
    resume,
  ) {
    return join.call(
      this,
      (message) => {
        if (message.kind !== 'view') return send(message);
        const timer = setTimeout(() => {
          publications.delete(timer);
          send(message);
        }, 10);
        publications.add(timer);
      },
      resume,
    );
  });
  cleanup.push(() => {
    delayed.mockRestore();
    for (const timer of publications) clearTimeout(timer);
  });
  const { clients, start } = await connect();
  expect(clients.map((client) => client.human)).toEqual(['甲席', '乙席']);
  const match = await start();
  const currentDecision = () => {
    const request = match.room.decisions.pending[0];
    const client = clients.find((client) => client.human === request?.player);
    const decision = client?.view.decision;
    if (
      !request ||
      !client ||
      !decision ||
      decision.id !== `${client.lobby?.round}:${request.id}` ||
      decision.token !== request.token
    )
      return null;
    return { client, decision, request };
  };
  let decisions = 0;
  let previewed = false;
  const acted = new Set<string>();
  while (!match.result) {
    await vi.waitFor(
      () => {
        expect(match.room.status).not.toBe('faulted');
        const current = currentDecision();
        expect(
          match.result ||
            (current &&
              clients.every(
                (client) =>
                  client.view.revision === match.room.world.snapshot.revision &&
                  (client === current.client || client.view.decision === null),
              )),
        ).toBeTruthy();
      },
      { timeout: 10_000, interval: 1 },
    );
    if (match.result) break;
    const { client, decision, request } = currentDecision()!;
    const other = clients.find((item) => item !== client)!;
    // 每席只收到自己的手牌与决策，原始请求中的 choice/闭包未进入协议。
    expect(other.view.decision).toBeNull();
    for (const viewer of clients) {
      expect(viewer.view.handoff).toBeNull();
      expect(viewer.view.hand.map((card) => card.id)).toEqual([
        ...match.room.world.zone(`${viewer.human}:hand`).cards,
      ]);
      expect(JSON.stringify(viewer.view)).not.toContain('"choice":');
      expect(
        viewer.view.pools.every(
          (pool) => pool.visibility !== 'private' || pool.zone.startsWith(viewer.human!),
        ),
      ).toBe(true);
    }
    expect(await other.cancel(decision.id, decision.token)).toMatchObject({
      kind: 'rejected',
      reason: 'closed',
    });
    expect(await client.cancel(decision.id, decision.token + 1)).toMatchObject({
      kind: 'rejected',
    });
    if (!previewed && 'offers' in decision && decision.offers.length) {
      const selection = { offer: decision.offers[0]!.id, cards: [], targets: [] };
      const expected = inspectSelection(match, request, selection);
      await vi.waitFor(
        () =>
          expect(client.inspect(decision.id, decision.token, selection).reason).not.toBe(
            '正在核对选择…',
          ),
        { interval: 1 },
      );
      expect(client.inspect(decision.id, decision.token, selection)).toEqual(expected);
      previewed = true;
    }
    // 测试操作者通过真实网络回答；正式客户端不会取得这里的主持端观察。
    const answer = decideBasic(observeAgent(match, request.player), request, (value) =>
      match.room.decisions.preview(request.id, value),
    );
    if (answer.kind === 'unsupported') throw new Error(answer.reason);
    const reply = await (answer.kind === 'cancel'
      ? client.cancel(decision.id, decision.token)
      : client.answer(decision.id, decision.token, answer.value));
    expect(reply, `View ${decision.id}; pending ${request.id}`).toEqual({ kind: 'accepted' });
    acted.add(client.human!);
    expect(await client.cancel(decision.id, decision.token)).toMatchObject({ kind: 'rejected' });
    if (++decisions > 1800) throw new Error('Network game decision budget exhausted.');
  }
  await vi.waitFor(() => expect(clients.every((client) => client.view.result)).toBe(true), {
    interval: 1,
  });
  expect(acted).toEqual(new Set(['甲席', '乙席']));
  expect(previewed).toBe(true);
  expect(clients[0]!.view.result).toEqual(clients[1]!.view.result);
  expect(match.room.decisions.pending).toEqual([]);
  expect(match.room.world.snapshot.cards).toHaveLength(108);
  expect(match.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(match.room.history.facts(Game.finished)).toHaveLength(1);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
}, 30_000);

it('开局前和终局后可补位；新连接不能接管活跃局或上一连接的私有视图', async () => {
  const { clients, port, rounds } = await connect();
  clients[1]!.dispose();
  await vi.waitFor(() => expect(clients[0]!.lobby?.seats[1]?.connected).toBe(false));
  const replacement = new RemoteSession('ws://127.0.0.1:' + port + '/game');
  cleanup.push(() => replacement.dispose());
  await vi.waitFor(() => expect(replacement.human).toBe('乙席'));
  expect(await clients[0]!.setReady(true)).toEqual({ kind: 'accepted' });
  expect(await replacement.setReady(true)).toEqual({ kind: 'accepted' });
  const match = rounds[0]!;
  await vi.waitFor(() => expect(match.progress).not.toBeNull());
  const late = new RemoteSession('ws://127.0.0.1:' + port + '/game');
  cleanup.push(() => late.dispose());
  await vi.waitFor(() => expect(late.view.error).toContain('房间已满或已经开局'));
  expect(late.human).toBeNull();
  replacement.dispose();
  await vi.waitFor(() => {
    expect(clients[0]!.view.error).toContain('乙席 已离开');
    expect(clients[0]!.lobby?.phase).toBe('finished');
  });
  expect(match.room.decisions.pending).toEqual([]);
  const next = new RemoteSession('ws://127.0.0.1:' + port + '/game');
  cleanup.push(() => next.dispose());
  await vi.waitFor(() => expect(next.human).toBe('乙席'));
  expect(next.view.status).toBe('idle');
  expect(next.view.players).toEqual([]);
  expect(next.view.hand).toEqual([]);
  expect(next.view.decision).toBeNull();
  expect(next.lobby?.editing).toBe(true);
});

it('作者校验异常向两端报告原始故障，不误报客户端消息格式错误', async () => {
  const { clients, start } = await connect(0, (match) => {
    match.room.on(Match.prepared, {
      id: 'author-validation',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        await ctx.ask({
          player: '甲席',
          kind: 'choose-option',
          prompt: '作者校验',
          optional: false,
          data: { options: [{ id: 'inspect', label: '核对', selectable: true }] },
          validate() {
            throw new Error('作者校验故障');
          },
        });
      },
    });
  });
  const match = await start();
  await vi.waitFor(() => expect(clients[0]!.view.decision?.kind).toBe('choose-option'));
  const before = match.room.world.snapshot;
  const request = clients[0]!.view.decision!;
  clients[0]!.inspectAnswer(request.id, request.token, 'inspect');
  await vi.waitFor(() => {
    for (const client of clients) {
      expect(client.view.status).toBe('faulted');
      expect(client.view.error).toBe('作者校验故障');
      expect(client.lobby?.seats.every((seat) => seat.connected)).toBe(true);
    }
  });
  expect(match.room.decisions.pending).toEqual([]);
  expect(match.room.world.snapshot).toEqual(before);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(before);
});

it('房间草稿在规则实例外；跨局号、重复内核决策 ID 与旧连接均不能写入新局', async () => {
  const plan = createRoomOptions({
    ...defaultRoomSetup,
    seed: 0xffffffff,
    lineup: defaultRoomSetup.lineup.slice(0, 2),
  });
  const matches: RoleMatch[] = [];
  const seeds: number[] = [];
  const room = new NetworkRoom(
    {
      ...plan,
      createMatch(players, seed) {
        const match = plan.createMatch(players, seed);
        seeds.push(seed);
        matches.push(match);
        match.room.on(Match.prepared, {
          id: 'round-gate',
          owner: null,
          eligible: () => true,
          async run(ctx) {
            await ctx.ask({
              player: '甲席',
              kind: 'choose-option',
              prompt: '本局结束门',
              optional: false,
              data: { options: [{ id: 'ok', label: '完成', selectable: true }] },
              validate: (value) =>
                value === 'ok' ? { ok: true, value } : { ok: false, reason: 'invalid' },
            });
            await finishGame(ctx, { winners: ['甲席'], reason: 'room-lifecycle-fixture' });
          },
        });
        return match;
      },
    },
    0,
  );
  cleanup.push(() => room.dispose());
  type Frame = Extract<ServerMessage, { kind: 'view' }> & { readonly lobby: LobbyView };
  let aView: Frame | undefined;
  let bView: Frame | undefined;
  const sendA = (frame: ServerMessage) => {
    if (frame.kind === 'view') aView = frame as Frame;
  };
  let a = room.join(sendA)!;
  const sendB = (frame: ServerMessage) => {
    if (frame.kind === 'view') bView = frame as Frame;
  };
  const oldB = room.join(sendB)!;
  await vi.waitFor(() => expect(aView?.view).toBeNull());
  expect(matches).toHaveLength(0);
  expect(a.command(0, { kind: 'ready', enabled: true })).toEqual({ kind: 'accepted' });
  expect(a.command(0, { kind: 'choose-general', general: 'missing:general' })).toMatchObject({
    kind: 'rejected',
  });
  expect(a.command(0, { kind: 'choose-general', general: 'standard:zhenji' })).toEqual({
    kind: 'accepted',
  });
  expect(oldB.command(0, { kind: 'ready', enabled: true })).toEqual({ kind: 'accepted' });
  await vi.waitFor(() =>
    expect(bView?.lobby.seats.map((seat) => seat.ready)).toEqual([false, true]),
  );
  expect(matches).toHaveLength(0);
  expect(a.command(0, { kind: 'ready', enabled: false })).toEqual({ kind: 'accepted' });
  expect(a.command(0, { kind: 'ready', enabled: true })).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(aView?.view?.decision?.kind).toBe('choose-option'));
  const firstTicket = aView!.view!.decision!;
  const rawId = matches[0]!.room.decisions.pending[0]!.id;
  const originalA = a;
  const worldBeforeReconnect = matches[0]!.room.world.snapshot;
  const pendingBeforeReconnect = matches[0]!.room.decisions.pending[0];
  originalA.disconnect();
  expect(room.join(sendA)).toBeNull();
  expect(room.join(sendA, 'not-a-seat')).toBeNull();
  a = room.join(sendA, originalA.key)!;
  expect(a.seat).toBe('甲席');
  expect(matches[0]!.room.decisions.pending[0]).toBe(pendingBeforeReconnect);
  expect(matches[0]!.room.world.snapshot).toBe(worldBeforeReconnect);
  expect(
    originalA.command(1, {
      kind: 'answer',
      id: firstTicket.id,
      token: firstTicket.token,
      value: 'ok',
    }),
  ).toMatchObject({ kind: 'rejected' });
  originalA.leave();
  expect(
    a.command(1, { kind: 'answer', id: firstTicket.id, token: firstTicket.token, value: 'ok' }),
  ).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(aView?.lobby.phase).toBe('finished'));
  const firstWorld = matches[0]!.room.world.snapshot;
  oldB.leave();
  const b = room.join(sendB)!;
  oldB.leave();
  expect(oldB.command(1, { kind: 'choose-general', general: 'standard:liubei' })).toMatchObject({
    kind: 'rejected',
    message: '连接已关闭。',
  });
  await vi.waitFor(() => expect(bView?.view).toBeNull());
  expect(bView!.lobby.seats.every((seat) => seat.connected)).toBe(true);
  expect(aView!.view!.result).not.toBeNull();
  expect(b.command(1, { kind: 'ready', enabled: true })).toEqual({ kind: 'accepted' });
  expect(a.command(1, { kind: 'prepare' })).toEqual({ kind: 'accepted' });
  expect(a.command(1, { kind: 'ready', enabled: true })).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(aView?.lobby.round).toBe(2));
  await vi.waitFor(() => expect(aView?.view?.decision?.kind).toBe('choose-option'));
  const secondTicket = aView!.view!.decision!;
  expect(matches[1]!.room.decisions.pending[0]!.id).toBe(rawId);
  expect(secondTicket.id).not.toBe(firstTicket.id);
  const secondWorld = matches[1]!.room.world.snapshot;
  expect(a.command(1, { kind: 'choose-general', general: 'standard:liubei' })).toMatchObject({
    kind: 'rejected',
  });
  expect(
    a.command(1, { kind: 'answer', id: firstTicket.id, token: firstTicket.token, value: 'ok' }),
  ).toMatchObject({ kind: 'rejected' });
  expect(
    a.command(2, { kind: 'answer', id: firstTicket.id, token: firstTicket.token, value: 'ok' }),
  ).toMatchObject({ kind: 'rejected' });
  expect(matches[1]!.room.world.snapshot).toEqual(secondWorld);
  expect(matches[0]!.room.world.snapshot).toEqual(firstWorld);
  expect(
    a.command(2, { kind: 'answer', id: secondTicket.id, token: secondTicket.token, value: 'ok' }),
  ).toEqual({ kind: 'accepted' });
  await vi.waitFor(() => expect(aView?.lobby.phase).toBe('finished'));
  expect(seeds).toEqual([0xffffffff, 1]);
  expect(matches).toHaveLength(2);
});
