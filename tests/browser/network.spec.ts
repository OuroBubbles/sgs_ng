import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

declare global {
  interface Window {
    networkAssetProof: { url: string; type: string; revoked: boolean }[];
    roomSocket: WebSocket | undefined;
  }
}

let host: ChildProcess;
let url = '';
// 宿主与真实部署相同：Bun 直接运行 TypeScript 源码；Playwright 自身仍在 Node。
async function startHost(extra: Record<string, string>, entry = 'src/server/main.ts') {
  const child = spawn('bun', [entry], {
    cwd: process.cwd(),
    env: { ...process.env, SGS_HOST: '127.0.0.1', SGS_PORT: '0', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const address = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Host did not start.')), 10_000);
    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      const found = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?online=1/);
      if (found) {
        clearTimeout(timeout);
        resolve(found[0]);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Host exited: ${code}`));
    });
  });
  return { host: child, url: address };
}
test.beforeAll(async () => {
  ({ host, url } = await startHost({ SGS_SEED: '2' }));
});

test('主持端普通源码组合画阁技能与二进制立绘，客户端使用真实决策且离开释放资源', async ({
  page,
  browser,
}, info) => {
  const author = await startHost({}, 'tests/fixtures/network-host.ts');
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
  });
  const peer = await context.newPage();
  const errors: string[] = [];
  try {
    for (const client of [page, peer]) {
      client.on('pageerror', (error) => errors.push(error.message));
      client.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await client.addInitScript(() => {
        const NativeSocket = WebSocket;
        globalThis.WebSocket = class extends NativeSocket {
          constructor(address: string | URL, protocols?: string | string[]) {
            super(address, protocols);
            window.roomSocket = this;
          }
        };
        window.networkAssetProof = [];
        const create = URL.createObjectURL.bind(URL),
          revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
          const url = create(blob);
          if (blob instanceof Blob)
            window.networkAssetProof.push({ url, type: blob.type, revoked: false });
          return url;
        };
        URL.revokeObjectURL = (url) => {
          const entry = window.networkAssetProof.find((entry) => entry.url === url);
          if (entry) entry.revoked = true;
          revoke(url);
        };
      });
      await client.goto('/');
      await client.getByRole('button', { name: '单机演武', exact: true }).click();
      await expect(client.locator('[data-content-ready="true"]')).toBeVisible();
      await expect(
        client
          .getByRole('combobox', { name: '你的武将', exact: true })
          .locator('option[value="gallery:guest"]'),
      ).toHaveCount(0);
      await client.getByText('联机房间', { exact: true }).click();
      await client.getByRole('textbox', { name: '主持端地址' }).fill(author.url);
      await client.getByRole('button', { name: '连接主持端' }).click();
      await expect(client.locator('.preparation-portrait strong')).toHaveText(['画阁客', '关羽']);
      await expect(client.locator('.preparation-portrait img').first()).toHaveAttribute(
        'src',
        /^blob:/,
      );
      await expect
        .poll(() =>
          client
            .locator('.preparation-portrait img')
            .first()
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    for (const client of [page, peer])
      await client.getByRole('button', { name: '准备对局' }).click();
    await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
    const hashes: string[] = [];
    for (const client of [page, peer]) {
      await expect(client.getByTestId('battle-canvas').locator('canvas')).toHaveAttribute(
        'data-portraits',
        '甲席,乙席',
      );
      hashes.push(
        await client.evaluate(async () => {
          const assets = window.networkAssetProof.filter((entry) => entry.type === 'image/jpeg');
          if (assets.length !== 1) throw new Error('Expected one room portrait resource.');
          const bytes = await (await fetch(assets[0]!.url)).arrayBuffer();
          return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
            value.toString(16).padStart(2, '0'),
          ).join('');
        }),
      );
    }
    const expected = createHash('sha256')
      .update(await readFile('examples/content/harbor/guest.jpg'))
      .digest('hex');
    expect(hashes).toEqual([expected, expected]);
    const hand = page.getByTestId('hand-cards').getByRole('button');
    const before = await hand.count();
    await page.getByTestId('card-harbor-card-6').click();
    await page.getByRole('button', { name: '确认当前选择', exact: true }).click();
    await expect(page.getByTestId('decision-hint')).toContainText('潮声');
    const suspended = await page.locator('[data-decision-key]').getAttribute('data-decision-key');
    await page.reload();
    await expect(peer.getByLabel('断线玩家', { exact: true })).toContainText('甲席');
    await expect(page.getByTestId('hand-cards').getByRole('button')).toHaveCount(0);
    // 恢复入口出现后，横屏大厅的导航与开局操作仍应完整可见。
    for (const name of [
      '返回原房间 · 甲席',
      '单机演武',
      '联机房间',
      '内容管理',
      '直接开始单机对局',
    ])
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: '返回原房间 · 甲席', exact: true }).click();
    await expect(page.getByTestId('decision-hint')).toContainText('潮声');
    await expect(page.locator('[data-decision-key]')).toHaveAttribute(
      'data-decision-key',
      suspended!,
    );
    await expect(page.locator('.target-lines .committed')).toHaveCount(0);
    await expect(peer.getByLabel('断线玩家', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.roomSocket!.close());
    await expect(page.getByRole('region', { name: '联机连接', exact: true })).toBeVisible();
    await expect(page.getByTestId('hand-cards').getByRole('button')).toHaveCount(0);
    await page.getByRole('button', { name: '重连原席位', exact: false }).click();
    await expect(page.getByTestId('decision-hint')).toContainText('潮声');
    await expect(page.locator('[data-decision-key]')).toHaveAttribute(
      'data-decision-key',
      suspended!,
    );
    await expect(page.locator('.target-lines .committed')).toHaveCount(0);
    await page.getByRole('button', { name: '发动', exact: true }).click();
    await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
    await expect(hand).toHaveCount(before + 3);
    for (const client of [page, peer]) {
      await client.getByRole('button', { name: '离开联机', exact: true }).click();
      await expect(client.getByRole('button', { name: '开始单机对局' })).toBeVisible();
      expect(
        await client.evaluate(() =>
          window.networkAssetProof
            .filter((entry) => entry.type === 'image/jpeg')
            .every((entry) => entry.revoked),
        ),
      ).toBe(true);
      await expect(client.getByRole('checkbox', { name: '画阁', exact: true })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    if (author.host.exitCode === null) {
      const ended = once(author.host, 'exit');
      author.host.kill();
      await ended;
    }
  }
});
test.afterAll(async () => {
  if (host && host.exitCode === null) {
    const ended = once(host, 'exit');
    host.kill();
    await ended;
  }
});

test('两个独立牌桌入席、托管交接、远端预览、藏牌和断线结束', async ({ page, browser }, info) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
    ...(info.project.use.userAgent ? { userAgent: info.project.use.userAgent } : {}),
  });
  const other = await context.newPage();
  const errors: string[] = [];
  for (const client of [page, other]) {
    client.on('pageerror', (error) => errors.push(error.message));
    client.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  }
  try {
    const incompatible = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    incompatible.on('connection', (socket) =>
      socket.send(
        JSON.stringify({
          kind: 'hello',
          protocol: 'different-content',
          content: 'x',
        }),
      ),
    );
    try {
      await new Promise<void>((resolve) => incompatible.once('listening', resolve));
      const address = incompatible.address();
      if (!address || typeof address === 'string') throw new Error('Missing listener.');
      await page.goto('/');
      await page.getByRole('button', { name: '单机演武', exact: true }).click();
      await page.getByText('联机房间', { exact: true }).click();
      await page.getByRole('textbox', { name: '主持端地址' }).fill(`127.0.0.1:${address.port}`);
      await page.getByRole('button', { name: '连接主持端' }).click();
      await expect(page.getByRole('region', { name: '联机连接' })).toContainText('构建不一致');
      await expect(page.locator('.target-hitbox')).toHaveCount(0);
      await expect(page.getByTestId('hand-cards').getByRole('button')).toHaveCount(0);
      await page.getByRole('button', { name: '离开联机', exact: true }).click();
      await expect(page.getByRole('button', { name: '开始单机对局' })).toBeVisible();
    } finally {
      for (const socket of incompatible.clients) socket.terminate();
      await new Promise<void>((resolve) => incompatible.close(() => resolve()));
    }
    // 客户端保留自己的来源，并使用实际原生 CSP 跨来源连接主持端。
    await page.goto('/');
    await page.getByRole('button', { name: '单机演武', exact: true }).click();
    await page.getByText('演练与复现', { exact: true }).click();
    await page.getByRole('spinbutton').fill('0');
    await page.getByText('联机房间', { exact: true }).click();
    await page.getByRole('textbox', { name: '主持端地址' }).fill('ftp://127.0.0.1');
    await page.getByRole('button', { name: '连接主持端' }).click();
    await expect(page.getByRole('alert')).toContainText('主持端地址无效');
    await expect(page.getByRole('textbox', { name: '主持端地址' })).toHaveValue('ftp://127.0.0.1');
    await page.getByRole('textbox', { name: '主持端地址' }).fill(url);
    await page.getByRole('button', { name: '连接主持端' }).click();
    await expect(page.locator('.room-tag')).toHaveText('联机 · 甲席');
    await other.goto(url);
    await expect(other.locator('.room-tag')).toHaveText('联机 · 乙席');
    for (const client of [page, other]) {
      await expect(client.getByRole('region', { name: '联机准备', exact: true })).toBeVisible();
      await expect(client.getByTestId('battle-canvas').locator('canvas')).toBeHidden();
      await expect(client.locator('.preparation-seat')).toHaveCount(4);
    }
    await page.getByRole('button', { name: '准备对局' }).click();
    await expect(page.getByRole('button', { name: '取消准备', exact: true })).toBeVisible();
    await expect(other.getByText('甲席 · 已准备')).toBeVisible();
    await other.getByRole('button', { name: '准备对局' }).click();
    // 种子 2 让甲席先手；原种子 42 的 AI 先手整局由网络场景验证。
    await expect
      .poll(
        async () =>
          (await page.locator('[data-decision-kind="play-action"]').count()) +
          (await other.locator('[data-decision-kind="play-action"]').count()),
      )
      .toBe(1);
    const actor = (await page.locator('[data-decision-kind="play-action"]').count()) ? page : other;
    const waiting = actor === page ? other : page;
    await actor.getByRole('button', { name: 'AI 托管', exact: true }).click();
    await expect(actor.getByRole('button', { name: '收回操作', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await actor.getByRole('button', { name: '收回操作', exact: true }).click();
    await expect(actor.getByRole('button', { name: 'AI 托管', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(actor.locator('[data-decision-kind="play-action"]')).toBeVisible();
    await expect(waiting.locator('[data-decision-kind]')).toHaveAttribute('data-decision-kind', '');
    await expect(waiting.locator('.decision-actions button')).toHaveCount(0);
    await expect(waiting.getByTestId('decision-hint')).toHaveText(/等待 .+ 选择/);
    await expect(actor.locator('.target-hitbox.self')).toHaveAttribute(
      'data-testid',
      actor === page ? 'target-甲席' : 'target-乙席',
    );
    const hand = actor.getByTestId('hand-cards').getByRole('button');
    const count = await hand.count();
    expect(count).toBeGreaterThan(0);
    await actor.getByRole('button', { name: '隐藏联机手牌', exact: true }).click();
    await expect(hand).toHaveCount(0);
    await actor.getByRole('button', { name: '恢复手牌', exact: true }).click();
    await expect(hand).toHaveCount(count);
    // 确认至少一张真实手牌经主持端预览变为合法；目标也来自远端反馈。
    const confirm = actor.getByRole('button', { name: '确认当前选择', exact: true });
    let chosen = false;
    let chosenCard = '';
    for (let index = 0; index < count; index++) {
      chosenCard = (await hand.nth(index).getAttribute('data-testid'))!;
      await hand.nth(index).click();
      await expect(actor.locator('.decision-copy small')).not.toContainText('正在核对');
      if (await confirm.isEnabled()) {
        chosen = true;
        break;
      }
      const targets = actor.locator('.target-hitbox[aria-disabled="false"]');
      if (await targets.count()) {
        await targets.first().click();
        await expect(actor.locator('.decision-copy small')).not.toContainText('正在核对');
        if (await confirm.isEnabled()) {
          chosen = true;
          break;
        }
      }
    }
    expect(chosen).toBe(true);
    await confirm.click();
    await expect(actor.getByTestId('hand-cards').getByTestId(chosenCard)).toHaveCount(0);
    await expect(actor.getByTestId('journal')).not.toBeEmpty();
    await page.screenshot({ path: `.artifacts/ui/network-${info.project.name}-甲.png` });
    await other.screenshot({ path: `.artifacts/ui/network-${info.project.name}-乙.png` });
    await other.close();
    await expect(page.getByLabel('断线玩家', { exact: true })).toContainText('乙席 已断开');
    await expect(page.getByRole('region', { name: '对局中止' })).toHaveCount(0);
    await page.getByRole('button', { name: '结束本局', exact: true }).click();
    await expect(page.getByRole('region', { name: '对局中止' })).toContainText('结束本局');
    await page.getByRole('button', { name: '返回房间', exact: false }).click();
    await expect(page.getByRole('region', { name: '联机准备', exact: true })).toBeVisible();
    await expect(page.locator('.target-hitbox')).toHaveCount(0);
    await expect(page.getByTestId('hand-cards').getByRole('button')).toHaveCount(0);
    await page
      .getByRole('combobox', { name: '我的武将', exact: true })
      .selectOption('standard:zhenji');
    await expect(page.getByRole('group', { name: '联机阵容', exact: true })).toContainText('甄姬');
    await expect(page.getByRole('group', { name: '联机阵容', exact: true })).toContainText(
      '乙席 · 等待加入',
    );
    await page.getByRole('button', { name: '离开联机', exact: true }).click();
    await expect(page.getByRole('button', { name: '开始单机对局' })).toBeVisible();
    await expect(page.getByRole('spinbutton')).toHaveValue('0');
    expect(page.url()).toBe('http://127.0.0.1:1420/');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
