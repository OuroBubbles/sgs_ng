import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import config from '../../src-tauri/tauri.conf.json' with { type: 'json' };

declare global {
  interface Window {
    bundleUrls: { url: string; type: string; revoked: boolean }[];
  }
}
const errors = new WeakMap<Page, string[]>();
const ready = (page: Page) => expect(page.locator('[data-content-ready="true"]')).toBeVisible();
test.beforeEach(async ({ page, context }) => {
  const found: string[] = [];
  errors.set(page, found);
  page.on('pageerror', (error) => found.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') found.push(message.text());
  });
  await context.route('http://127.0.0.1:1420/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'Content-Security-Policy': config.app.security.csp },
    });
  });
  await page.addInitScript(() => {
    window.bundleUrls = [];
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob) window.bundleUrls.push({ url, type: blob.type, revoked: false });
      return url;
    };
    URL.revokeObjectURL = (url) => {
      const entry = window.bundleUrls.find((entry) => entry.url === url);
      if (entry) entry.revoked = true;
      revoke(url);
    };
  });
  await page.goto('/');
  await ready(page);
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
const imageUrls = (page: Page) =>
  page.evaluate(() => window.bundleUrls.filter((entry) => entry.type === 'image/jpeg'));

test('二进制资源包保存与刷新恢复，真实 Blob 立绘和宿主技能正常运行', async ({ page }, info) => {
  await page
    .getByLabel('导入本地内容包', { exact: true })
    .setInputFiles('.artifacts/content/harbor.sgs');
  await expect(page.getByRole('checkbox', { name: '渡口', exact: true })).toBeChecked();
  await ready(page);
  const original = (await imageUrls(page))[0]!.url;
  const actual = await page.evaluate(async () => {
    const request = indexedDB.open('sgs-ng-content', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Cannot open content storage.'));
    });
    try {
      const record = await new Promise<{ modules: { source: string; assets: { blob: Blob }[] }[] }>(
        (resolve, reject) => {
          const read = db.transaction('loadout').objectStore('loadout').get('current');
          read.onsuccess = () =>
            resolve(read.result as { modules: { source: string; assets: { blob: Blob }[] }[] });
          read.onerror = () => reject(read.error ?? new Error('Cannot read stored resources.'));
        },
      );
      const module = record.modules[0]!,
        blob = module.assets[0]!.blob;
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
      );
      return {
        blob: blob instanceof Blob,
        bytes: blob.size,
        inlineImage: module.source.includes('data:image'),
        hash: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''),
      };
    } finally {
      db.close();
    }
  });
  expect(actual).toEqual({
    blob: true,
    bytes: 274000,
    inlineImage: false,
    hash: createHash('sha256')
      .update(await readFile('examples/content/harbor/guest.jpg'))
      .digest('hex'),
  });
  await page.reload();
  await ready(page);
  expect((await imageUrls(page))[0]!.url).not.toBe(original);
  await page.getByRole('combobox', { name: '你的武将', exact: true }).selectOption('harbor:guest');
  await page
    .getByRole('combobox', { name: 'AI 武将', exact: true })
    .selectOption('standard:guanyu');
  await page.getByRole('combobox', { name: '牌组', exact: true }).selectOption('harbor:crossing');
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('2');
  await page.getByRole('spinbutton').fill('2');
  await page.getByRole('button', { name: '开始单机对局' }).click();
  await expect(page.locator('[data-decision-kind="play-action"]')).toBeVisible();
  await expect(page.getByTestId('battle-canvas').locator('canvas')).toHaveAttribute(
    'data-portraits',
    info.project.name === 'touch' ? '甲席' : '甲席,乙席',
  );
  const hand = page.getByTestId('hand-cards').locator('button'),
    before = await hand.count();
  await page.getByTestId('card-harbor-card-6').click();
  await page.getByTestId('target-甲席').click();
  await page.getByRole('button', { name: '确认当前选择', exact: true }).click();
  await expect(page.getByTestId('decision-hint')).toContainText('潮声');
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(hand).toHaveCount(before + 2);
  await page.screenshot({
    path: `.artifacts/ui/content-bundle-${info.project.name}.png`,
    fullPage: true,
  });
});

test('同批错误模块不半安装并释放已创建的图片 URL，之后可正常导入与移除', async ({ page }) => {
  await page.getByLabel('导入本地内容包', { exact: true }).setInputFiles([
    {
      name: 'harbor.sgs',
      mimeType: 'application/zip',
      buffer: await readFile('.artifacts/content/harbor.sgs'),
    },
    {
      name: 'bad.sgs.mjs',
      mimeType: 'text/javascript',
      buffer: Buffer.from('export const format = "wrong"; export default () => ({});'),
    },
  ]);
  await expect(page.getByRole('alert')).toBeVisible();
  await ready(page);
  await expect(page.getByRole('checkbox', { name: '渡口', exact: true })).toHaveCount(0);
  const rejected = await imageUrls(page);
  expect(rejected).toHaveLength(1);
  expect(rejected.every((entry) => entry.revoked)).toBe(true);
  await page
    .getByLabel('导入本地内容包', { exact: true })
    .setInputFiles('.artifacts/content/harbor.sgs');
  await expect(page.getByRole('checkbox', { name: '渡口', exact: true })).toBeChecked();
  await ready(page);
  const live = (await imageUrls(page)).find((entry) => !entry.revoked)!;
  await page.getByRole('button', { name: '移除渡口', exact: true }).click();
  await ready(page);
  expect((await imageUrls(page)).find((entry) => entry.url === live.url)?.revoked).toBe(true);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('checkbox', { name: '渡口', exact: true })).toHaveCount(0);
});

test('真实资源事务中止不发布目录，释放本批资源，重载后可再次完整保存', async ({ page }) => {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 原始接收者经 apply 保留，并在探针后恢复。
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'sgs-ng-content') {
        IDBObjectStore.prototype.put = original;
        this.transaction.abort();
        throw new DOMException('Bundle transaction aborted', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  await page
    .getByLabel('导入本地内容包', { exact: true })
    .setInputFiles('.artifacts/content/harbor.sgs');
  await expect(page.getByRole('alert')).toContainText('Bundle transaction aborted');
  await ready(page);
  await expect(page.getByRole('checkbox', { name: '渡口', exact: true })).toHaveCount(0);
  expect((await imageUrls(page)).every((entry) => entry.revoked)).toBe(true);
  await page.getByRole('button', { name: '重新载入内容', exact: true }).click();
  await ready(page);
  await page
    .getByLabel('导入本地内容包', { exact: true })
    .setInputFiles('.artifacts/content/harbor.sgs');
  await expect(page.getByRole('checkbox', { name: '渡口', exact: true })).toBeChecked();
  await ready(page);
  expect((await imageUrls(page)).filter((entry) => !entry.revoked)).toHaveLength(1);
});
