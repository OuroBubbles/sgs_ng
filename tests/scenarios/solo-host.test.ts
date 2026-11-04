import { afterEach, expect, it, vi } from 'vitest';
import { createGameServer } from '../../src/server/server';
import { createRoomOptions } from '../../src/host/setup';
import { RemoteSession } from '../../src/app/session';
import { defaultRoomSetup, type HostCatalog, type SoloSetup } from '../../src/protocol';
import { defaultContent, practiceContent } from '../../src/host/content';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function host() {
  const server = createGameServer(createRoomOptions(defaultRoomSetup), { aiDelayMs: 0 });
  const port = await server.listen(0);
  cleanup.push(() => server.close());
  return port;
}
function solo(port: number, setup: SoloSetup) {
  const session = new RemoteSession(`127.0.0.1:${port}`, { solo: setup });
  cleanup.push(() => session.dispose());
  return session;
}

it('主持端以普通数据提供大厅目录，技能说明来自实际装配', async () => {
  const port = await host();
  const catalog = (await (await fetch(`http://127.0.0.1:${port}/catalog`)).json()) as HostCatalog;
  expect(catalog.seats[0]).toBe('甲席');
  expect(catalog.standard.generals.map((general) => general.id)).toEqual(
    defaultContent.generals.map((general) => general.id),
  );
  expect(catalog.practice.generals).toHaveLength(practiceContent.generals.length);
  expect(catalog.standard.cards).toBe(defaultContent.cards.length);
  const guanyu = catalog.standard.generals.find((general) => general.id === 'standard:guanyu')!;
  expect(guanyu.portrait).toBe(defaultContent.generalViews['standard:guanyu']!.portrait);
  expect(guanyu.skills[0]).toMatchObject({ id: 'standard:wusheng', name: '武圣', lord: false });
  expect(guanyu.skills[0]!.description).not.toBe('');
});

it('单机经同一协议由主持端开局：甲席收到自己的投影，暂停让主持端停下 AI', async () => {
  const port = await host();
  const session = solo(port, {
    seed: 42,
    preset: 'standard:identity',
    lineup: ['standard:guanyu', 'standard:caocao'],
  });
  await vi.waitFor(() => expect(session.view.status).toBe('running'));
  expect(session.online).toBe(false);
  expect(session.lobby).toBeNull();
  expect(session.view.players.map((player) => player.id)).toEqual(['甲席', '乙席']);
  expect(session.view.players.find((player) => player.self)?.id).toBe('甲席');
  await vi.waitFor(() => expect(session.view.decision?.kind).toBe('play-action'), {
    timeout: 10_000,
  });
  const decision = session.view.decision!;
  expect(
    session.inspect(decision.id, decision.token, { offer: null, cards: [], targets: [] }),
  ).toMatchObject({ reason: '正在核对选择…' });
  await vi.waitFor(() =>
    expect(
      session.inspect(decision.id, decision.token, { offer: null, cards: [], targets: [] }).reason,
    ).not.toBe('正在核对选择…'),
  );
  session.hide();
  await vi.waitFor(() => expect(session.view.paused).toBe(true));
  expect(session.view.hand).toEqual([]);
  session.resume();
  await vi.waitFor(() => expect(session.view.paused).toBe(false));
  expect(session.view.hand.length).toBeGreaterThan(0);
}, 20_000);

it('手动演练由主持端热坐交接，客户端只转交钥匙', async () => {
  const port = await host();
  const session = solo(port, { seed: 42, preset: 'standard:identity', count: 2 });
  await vi.waitFor(() => expect(session.view.handoff).not.toBeNull());
  expect(session.view.viewer).toBeNull();
  const handoff = session.view.handoff!;
  session.confirmSeat(handoff.key);
  await vi.waitFor(() => expect(session.view.viewer).toBe(handoff.player));
});

it('装配失败与非法草稿只结束这条连接，主持端继续服务', async () => {
  const port = await host();
  const broken = solo(port, {
    seed: 42,
    preset: 'standard:identity',
    lineup: ['standard:guanyu', 'missing:general'],
  });
  await vi.waitFor(() => expect(broken.view.error).toContain('内容装配失败'));
  expect(broken.view.status).toBe('stopped');
  expect(broken.connected).toBe(false);
  const seedless = solo(port, { seed: 0, preset: 'standard:identity', count: 2 });
  await vi.waitFor(() => expect(seedless.view.error).toContain('牌局种子'));
  const next = solo(port, { seed: 9, preset: 'standard:identity', count: 2 });
  await vi.waitFor(() => expect(next.view.status).toBe('running'));
});
