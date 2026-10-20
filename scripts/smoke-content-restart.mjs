import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { resourceBundleRecord, playResourceGuest } from './resource-bundle-proof.mjs';

const buildKind = process.env.SGS_NATIVE_BUILD;
const executable = process.env.SGS_NATIVE_EXE;
if (!['debug', 'release'].includes(buildKind) || !executable)
  throw new Error('Missing native restart context.');
const first = JSON.parse(await readFile(`.artifacts/ui/native-smoke-${buildKind}.json`, 'utf8'));
const processId = Number(process.env.SGS_NATIVE_PID);
assert.notEqual(processId, first.processId, 'Restart must use a different native process.');
assert.ok(first.restartSeed.installed);
assert.equal(first.verificationProfile, process.env.SGS_NATIVE_PROFILE);
const browser = await chromium.connectOverCDP(process.env.SGS_NATIVE_CDP);
const page = browser
  .contexts()[0]
  ?.pages()
  .find((page) => page.url().includes('tauri.localhost'));
if (!page) throw new Error('Native restart page is missing.');
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const ready = () => page.locator('[data-content-ready="true"]').waitFor();
await page.getByText('WebGL 战场已就绪').waitFor({ state: 'attached' });
await ready();
assert.ok(await page.getByRole('checkbox', { name: '渡口', exact: true }).isChecked());
assert.ok(await page.getByRole('checkbox', { name: '画阁', exact: true }).isChecked());
const resourceBundle = await resourceBundleRecord(page);
assert.equal(resourceBundle.sha256, first.externalResourceBundle.sha256);
assert.equal(resourceBundle.sourceSha256, first.externalResourceBundle.sourceSha256);
assert.equal(resourceBundle.imageSha256, first.externalResourceBundle.imageSha256);
// 本进程未调用文件选择；源码确实来自持久记录，字节与首次安装一致。
const storedSource = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('sgs-ng-content', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('loadout').objectStore('loadout').get('current');
      request.onsuccess = () =>
        resolve(request.result.modules.find((module) => module.id === 'harbor').source);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
});
const sourceHash = createHash('sha256').update(storedSource).digest('hex');
assert.equal(sourceHash, first.externalModule.sha256);
await page.getByRole('combobox', { name: '你的武将', exact: true }).selectOption('harbor:guest');
await page.getByRole('combobox', { name: 'AI 武将', exact: true }).selectOption('standard:guanyu');
await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption('harbor:crossing');
await page.getByRole('spinbutton').fill('2');
await page.getByRole('button', { name: '开始单机对局' }).click();
await page.locator('[data-decision-kind="play-action"]').waitFor();
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="battle-canvas"] canvas')?.dataset.portraits ===
    '甲席,乙席',
);
const hand = page.getByTestId('hand-cards').locator('button');
const before = await hand.count();
await page.getByTestId('card-harbor-card-6').click();
await page.getByTestId('target-甲席').click();
await page.getByRole('button', { name: '确认当前选择', exact: true }).click();
await page.waitForFunction(() =>
  document.querySelector('[data-testid="decision-hint"]')?.textContent?.includes('潮声'),
);
await page.getByRole('button', { name: '发动', exact: true }).click();
await page.locator('[data-decision-kind="play-action"]').waitFor();
assert.equal(await hand.count(), before + 2);
assert.equal(await page.getByTestId('hand-cards').getByTestId('card-harbor-card-6').count(), 0);
assert.match(await page.getByTestId('journal').textContent(), /甲席发动【潮声】/);
await page.screenshot({
  path: `.artifacts/ui/native-content-restart-${buildKind}.png`,
  fullPage: true,
});
await page.reload();
await ready();
await playResourceGuest(page);
await page.screenshot({
  path: `.artifacts/ui/native-content-bundle-${buildKind}.png`,
  fullPage: true,
});
await page.reload();
await ready();
await page.getByRole('button', { name: '清空已保存内容', exact: true }).click();
await ready();
await page.reload();
await ready();
assert.equal(await page.getByRole('checkbox', { name: '渡口', exact: true }).count(), 0);
assert.equal(await page.getByRole('checkbox', { name: '画阁', exact: true }).count(), 0);
assert.deepEqual(errors, []);
const executableSha256 = createHash('sha256')
  .update(await readFile(executable))
  .digest('hex');
assert.equal(executableSha256, first.executableSha256);
await writeFile(
  `.artifacts/ui/native-content-restart-${buildKind}.json`,
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      buildKind,
      executableSha256,
      initialProcessId: first.processId,
      restoredProcessId: processId,
      moduleSha256: sourceHash,
      resourceBundleSha256: resourceBundle.sha256,
      resourceSourceSha256: resourceBundle.sourceSha256,
      resourceImageSha256: resourceBundle.imageSha256,
      restoredResourceBlob: true,
      resourceGuestRealHostSkillAndPortrait: true,
      verificationProfile: process.env.SGS_NATIVE_PROFILE,
      restoredWithoutFileSelection: true,
      realHostSkillAndMaterials: true,
      restoredPortraitRendered: true,
      clearedAfterReload: true,
      consoleErrors: errors,
    },
    null,
    2,
  )}\n`,
);
await browser.close();
console.log('Native process restart content proof passed.');
