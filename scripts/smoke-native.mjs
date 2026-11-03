import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { networkBuild } from './network-build.mjs';

const kind = process.env.SGS_NATIVE_BUILD;
const executable = process.env.SGS_NATIVE_EXE;
const profile = process.env.SGS_NATIVE_PROFILE;
const processId = Number(process.env.SGS_NATIVE_PID);
if (!['debug', 'release'].includes(kind) || !executable || !profile || !processId)
  throw new Error('Use verify-windows.ps1 with an owned process and isolated profile.');
const hash = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const browsers = [];
const pages = [];
const errors = [];
async function connect(endpoint) {
  const browser = await chromium.connectOverCDP(endpoint);
  browsers.push(browser);
  const page = browser
    .contexts()[0]
    ?.pages()
    .find((page) => page.url().includes('tauri.localhost'));
  if (!page) throw new Error('Native game page is missing.');
  pages.push(page);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return page;
}
async function home(page) {
  await expect(page.getByRole('region', { name: '启动界面', exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByTestId('battle-canvas').locator('canvas')).toHaveCount(0);
  await page.getByRole('button', { name: '单机演武', exact: true }).click();
}
async function delegate(page) {
  const button = page.getByRole('button', { name: 'AI 托管', exact: true });
  if ((await button.count()) && (await button.isEnabled())) await button.click();
}
async function finish(pages) {
  for (const page of pages) {
    if (await page.getByRole('region', { name: '对局结果', exact: true }).isVisible()) continue;
    await expect(page.getByRole('navigation', { name: '牌桌工具', exact: true })).toBeVisible();
    await delegate(page);
  }
  for (const page of pages)
    await expect(page.getByRole('region', { name: '对局结果', exact: true })).toBeVisible({
      timeout: 60_000,
    });
}
function ownedHost() {
  const value = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${processId}" | Where-Object Name -eq 'node.exe' | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress`,
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  const result = JSON.parse(value);
  assert.ok(!Array.isArray(result) && result.ProcessId && result.ParentProcessId === processId);
  return result;
}
async function local(page) {
  await home(page);
  const practice = page.getByRole('checkbox', { name: '机制演武', exact: true });
  await expect(practice).not.toBeChecked();
  await practice.check();
  await expect(
    page.getByRole('combobox', { name: '你的武将', exact: true }).locator('option'),
  ).toHaveCount(30);
  await practice.uncheck();
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('2');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  const canvas = page.getByTestId('battle-canvas').locator('canvas');
  await expect(canvas).toHaveAttribute('data-portraits', '甲席,乙席');
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  const pendingKey = await page.locator('[data-decision-key]').getAttribute('data-decision-key');
  const count = await page.getByTestId('hand-cards').getByRole('button').count();
  assert.ok(count > 0);
  await page.getByRole('button', { name: '暂停对局', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '对局已暂停', exact: true })).toBeVisible();
  await expect(page.getByTestId('hand-cards').getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: '继续对局', exact: true }).click();
  await expect(page.locator('[data-decision-key]')).toHaveAttribute(
    'data-decision-key',
    pendingKey,
  );
  await expect(page.getByTestId('hand-cards').getByRole('button')).toHaveCount(count);
  await finish([page]);
  await page.screenshot({ path: `.artifacts/ui/native-source-victory-${kind}.png` });
  await page.getByRole('button', { name: /^再开一局/ }).click();
  await expect(canvas).toHaveCount(0);
  await expect(page.getByTestId('hand-cards').getByRole('button')).toHaveCount(0);
  // 留下未持久化的演武草稿；下一原生进程须仍从标准源码开始。
  await practice.check();
  return {
    portraits: 2,
    pauseRetainsHand: true,
    aiVictory: true,
    rendererReleased: true,
    sourceSelection: true,
  };
}
async function network(owner) {
  const peer = await connect(process.env.SGS_NATIVE_PEER_CDP);
  for (const page of [owner, peer]) {
    await page.addInitScript(() => {
      window.nativeBuilds = [];
      const Socket = WebSocket;
      window.WebSocket = class extends Socket {
        constructor(url, protocols) {
          super(url, protocols);
          this.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.kind === 'hello') window.nativeBuilds.push(message.build);
          });
        }
      };
    });
    await page.reload();
    await home(page);
  }
  await owner.getByRole('checkbox', { name: '机制演武', exact: true }).check();
  for (const page of [owner, peer])
    await page.getByRole('button', { name: '联机房间', exact: true }).click();
  await owner.getByRole('combobox', { name: '联机席位', exact: true }).selectOption('2');
  await owner
    .getByRole('combobox', { name: '联机牌组', exact: true })
    .selectOption('workshop:showcase');
  await owner
    .getByRole('combobox', { name: '甲席武将', exact: true })
    .selectOption('workshop:guest');
  await owner
    .getByRole('combobox', { name: '乙席武将', exact: true })
    .selectOption('standard:guanyu');
  await owner.getByRole('spinbutton', { name: '对局种子', exact: true }).fill('2');
  await owner.getByRole('spinbutton', { name: '房间端口', exact: true }).fill('0');
  await owner.getByRole('button', { name: '创建房间', exact: false }).click();
  await expect(owner.getByRole('region', { name: '联机准备', exact: true })).toBeVisible();
  const address = await owner
    .getByRole('textbox', { name: '本机连接地址', exact: true })
    .inputValue();
  const port = Number(address.split(':').at(-1));
  await owner.locator('.hosted-room-menu summary').click();
  const firstHost = ownedHost();
  await peer.getByRole('spinbutton', { name: '房间端口', exact: true }).fill(String(port));
  await peer.getByRole('button', { name: '创建房间', exact: false }).click();
  await expect(peer.getByRole('alert').filter({ hasText: '端口已被占用' })).toBeVisible();
  assert.equal(ownedHost().ProcessId, firstHost.ProcessId);
  await peer.getByRole('textbox', { name: '主持端地址', exact: true }).fill(address);
  await peer.getByRole('button', { name: '连接主持端', exact: false }).click();
  for (const page of [owner, peer]) {
    await expect(page.locator('.preparation-portrait strong')).toHaveText(['演武客', '关羽']);
    await page.getByRole('button', { name: '准备对局', exact: false }).click();
  }
  await expect(owner.getByTestId('battle-canvas').locator('canvas')).toBeVisible();
  await expect(peer.getByTestId('battle-canvas').locator('canvas')).toBeVisible();
  const pending = await Promise.any(
    [owner, peer].map(async (page) => {
      await expect(page.locator('[data-decision-kind]:not([data-decision-kind=""])')).toBeVisible();
      return {
        page,
        key: await page.locator('[data-decision-key]').getAttribute('data-decision-key'),
      };
    }),
  );
  assert.ok(pending.key);
  await pending.page.reload();
  await pending.page.getByRole('button', { name: /^返回原房间/ }).click();
  await expect(pending.page.locator('[data-decision-key]')).toHaveAttribute(
    'data-decision-key',
    pending.key,
  );
  assert.equal(ownedHost().ProcessId, firstHost.ProcessId);
  for (const page of [owner, peer]) {
    const builds = await page.evaluate(() => window.nativeBuilds);
    assert.ok(builds.length > 0);
    assert.ok(builds.every((build) => build === networkBuild()));
  }
  await finish([owner, peer]);
  for (const page of [owner, peer]) await page.getByRole('button', { name: /^准备下一局/ }).click();
  for (const page of [owner, peer])
    await page.getByRole('button', { name: '准备对局', exact: false }).click();
  await finish([owner, peer]);
  assert.equal(ownedHost().ProcessId, firstHost.ProcessId);
  await owner.locator('.hosted-room-menu summary').click();
  await owner.getByRole('button', { name: '关闭房间', exact: true }).click();
  await expect(owner.getByRole('region', { name: '开局设置', exact: true })).toBeVisible();
  await expect(peer.getByRole('region', { name: '联机连接', exact: true })).toBeVisible();
  await owner.getByRole('button', { name: '联机房间', exact: true }).click();
  await owner.getByRole('spinbutton', { name: '房间端口', exact: true }).fill('0');
  await owner.getByRole('button', { name: '创建房间', exact: false }).click();
  await expect(owner.getByRole('region', { name: '联机准备', exact: true })).toBeVisible();
  const hosting = ownedHost();
  assert.notEqual(hosting.ProcessId, firstHost.ProcessId);
  const recreatedAddress = await owner
    .getByRole('textbox', { name: '本机连接地址', exact: true })
    .inputValue();
  return {
    hosting: { ...hosting, port: Number(recreatedAddress.split(':').at(-1)) },
    configuration: true,
    portConflictRejected: true,
    sameHostAcrossRounds: true,
    rounds: 2,
    reloadRetainsRequest: true,
    recreated: true,
    build: networkBuild(),
  };
}
await mkdir('.artifacts/validation', { recursive: true });
try {
  const owner = await connect(process.env.SGS_NATIVE_CDP);
  const isNetwork = process.argv.includes('--network');
  const result = isNetwork ? await network(owner) : await local(owner);
  assert.deepEqual(errors, []);
  const proof = {
    format: 'sgs-native/2',
    capturedAt: new Date().toISOString(),
    buildKind: kind,
    processId,
    verificationProfile: profile,
    executableSha256: await hash(executable),
    result,
    consoleErrors: errors,
  };
  if (isNetwork) {
    proof.hostFiles = {};
    for (const file of ['node.exe', 'main.mjs', 'LICENSE.txt'])
      proof.hostFiles[file] = await hash(join(dirname(executable), 'host', file));
  }
  let name = isNetwork ? 'native-source-network' : 'native-source-smoke';
  if (process.argv.includes('--restart')) {
    const initial = JSON.parse(
      await readFile(`.artifacts/validation/native-source-smoke-${kind}.json`, 'utf8'),
    );
    assert.notEqual(initial.processId, processId);
    assert.equal(initial.executableSha256, proof.executableSha256);
    assert.equal(initial.verificationProfile, profile);
    proof.initialProcessId = initial.processId;
    name = 'native-source-restart';
  }
  await writeFile(
    `.artifacts/validation/${name}-${kind}.json`,
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(`${name}: passed`);
} catch (error) {
  for (const [index, page] of pages.entries()) {
    const stem = `.artifacts/ui/native-source-failure-${kind}-${index}`;
    await page.screenshot({ path: stem + '.png' }).catch(() => {});
    await page
      .locator('body')
      .ariaSnapshot()
      .then((value) => writeFile(stem + '.txt', value))
      .catch(() => {});
  }
  throw error;
} finally {
  await Promise.all(browsers.map((browser) => browser.close()));
}
