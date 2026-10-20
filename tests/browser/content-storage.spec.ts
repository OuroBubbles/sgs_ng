import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import config from '../../src-tauri/tauri.conf.json' with { type: 'json' };

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, context }) => {
  const found: string[] = [];
  errors.set(page, found);
  const watch = (surface: Page) => {
    surface.on('pageerror', (error) => found.push(error.message));
    surface.on('console', (message) => {
      if (message.type() === 'error') found.push(message.text());
    });
  };
  watch(page);
  context.on('page', watch);
  await context.route('http://127.0.0.1:1420/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'Content-Security-Policy': config.app.security.csp },
    });
  });
  await page.goto('/');
  await ready(page);
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
const ready = (page: Page) => expect(page.locator('[data-content-ready="true"]')).toBeVisible();
const harbor = (page: Page) => page.getByRole('checkbox', { name: '渡口', exact: true });
const importHarbor = async (page: Page) => {
  await page
    .getByLabel('导入本地内容包', { exact: true })
    .setInputFiles('.artifacts/content/harbor.sgs.mjs');
  await expect(harbor(page)).toBeChecked();
  await ready(page);
};
async function stored(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sgs-ng-content', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Storage request failed.'));
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction('loadout');
        const request = tx.objectStore('loadout').get('current');
        request.onsuccess = () => {
          const value: unknown = request.result;
          resolve(value);
        };
        request.onerror = () => reject(request.error ?? new Error('Storage request failed.'));
      });
    } finally {
      db.close();
    }
  });
}
async function seedStored(page: Page, value: unknown) {
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sgs-ng-content', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Storage request failed.'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('loadout', 'readwrite');
        tx.objectStore('loadout').put(value, 'current');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('Storage transaction failed.'));
      });
    } finally {
      db.close();
    }
  }, value);
}

test('真实 IndexedDB 保存源码，刷新后无需原文件即可恢复并再次发动宿主技能', async ({
  page,
}, info) => {
  await importHarbor(page);
  const code = await readFile('.artifacts/content/harbor.sgs.mjs', 'utf8');
  expect(await stored(page)).toMatchObject({
    revision: 1,
    modules: [{ id: 'harbor', source: code }],
    enabled: ['harbor'],
  });
  await page.reload();
  await ready(page);
  await expect(harbor(page)).toBeChecked();
  await expect(page.getByTestId('content-store-status')).toHaveText('已保存');
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
  const hand = page.getByTestId('hand-cards').locator('button');
  const before = await hand.count();
  await page.getByTestId('card-harbor-card-6').click();
  await page.getByTestId('target-甲席').click();
  await page.getByRole('button', { name: '确认当前选择', exact: true }).click();
  await expect(page.getByTestId('decision-hint')).toContainText('潮声');
  await page.getByRole('button', { name: '发动', exact: true }).click();
  await expect(hand).toHaveCount(before + 2);
  await page.screenshot({
    path: `.artifacts/ui/restored-content-${info.project.name}.png`,
    fullPage: true,
  });
});

test('停用和级联移除均持久化，刷新不复活已移除模块', async ({ page }, info) => {
  const code = await readFile('.artifacts/content/harbor.sgs.mjs');
  await page.getByLabel('导入本地内容包', { exact: true }).setInputFiles([
    {
      name: 'pilot.sgs.mjs',
      mimeType: 'text/javascript',
      buffer: Buffer.from(
        'export const format="sgs-content/1";export default sdk=>sdk.definePackage({manifest:{id:"pilot",name:"领航",version:"1",requires:[{id:"harbor"}]}});',
      ),
    },
    { name: 'harbor.sgs.mjs', mimeType: 'text/javascript', buffer: code },
  ]);
  await expect(harbor(page)).toBeChecked();
  await ready(page);
  await harbor(page).uncheck();
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(harbor(page)).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '领航', exact: true })).not.toBeChecked();
  await page.screenshot({
    path: `.artifacts/ui/saved-content-lobby-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '移除渡口', exact: true }).click();
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(harbor(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '领航', exact: true })).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ modules: [], enabled: [] });
});

test('真实事务中止时不显示半安装，旧内容字节保留，重载后恢复', async ({ page }) => {
  await page.getByRole('checkbox', { name: '作者演武', exact: true }).check();
  await ready(page);
  const before = await stored(page);
  // 只注入存储故障；不修改任何规则状态或对局回复。
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Receiver is preserved with apply and restored after the probe.
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'sgs-ng-content') {
        IDBObjectStore.prototype.put = original;
        this.transaction.abort();
        throw new DOMException('Storage failure probe', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  await page
    .getByLabel('导入本地内容包', { exact: true })
    .setInputFiles('.artifacts/content/harbor.sgs.mjs');
  await expect(page.getByRole('alert')).toContainText('Storage failure probe');
  await expect(harbor(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '作者演武', exact: true })).toBeChecked();
  expect(await stored(page)).toEqual(before);
  await page.getByRole('button', { name: '重新载入内容', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await importHarbor(page);
});

test('两个窗口的旧版本不能覆盖新目录，显式重载后采用新记录', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('/');
  await ready(other);
  await importHarbor(page);
  await other.getByRole('checkbox', { name: '作者演武', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('其他窗口');
  await expect(other.getByRole('checkbox', { name: '作者演武', exact: true })).not.toBeChecked();
  expect(await stored(page)).toMatchObject({ enabled: ['harbor'] });
  await other.getByRole('button', { name: '重新载入内容', exact: true }).click();
  await ready(other);
  await expect(harbor(other)).toBeChecked();
  await other.close();
});

test('已保存代码失效不自动删除记录，默认对局仍可开始，清空后不再反复报错', async ({
  page,
}, info) => {
  const bad = {
    format: 'sgs-content-store/1',
    revision: 4,
    modules: [
      {
        id: 'broken',
        name: 'Broken',
        version: '1',
        fileName: 'broken.sgs.mjs',
        source:
          'export const format="sgs-content/1";export default()=>{throw new Error("Stored source failed");};',
      },
    ],
    enabled: ['broken'],
  };
  await seedStored(page, bad);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('alert')).toContainText('Stored source failed');
  await expect(page.getByRole('button', { name: '开始单机对局' })).toBeEnabled();
  expect(await stored(page)).toEqual(bad);
  await page.screenshot({
    path: `.artifacts/ui/content-recovery-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '清空已保存内容', exact: true }).click();
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ modules: [], enabled: [] });
});

test('损坏格式保留至用户清空，正常的新记录不会被错误恢复路径擦除', async ({ page }) => {
  await seedStored(page, { invalid: true });
  await page.reload();
  await ready(page);
  await expect(page.getByRole('alert')).toContainText('格式不正确');
  expect(await stored(page)).toEqual({ invalid: true });
  // 另一个窗口此时修复了数据；旧窗口的强制恢复分支必须拒绝删除有效新记录。
  const repaired = {
    format: 'sgs-content-store/1',
    revision: 7,
    modules: [],
    enabled: ['workshop'],
  };
  await seedStored(page, repaired);
  await page.getByRole('button', { name: '清空已保存内容', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('其他窗口');
  expect(await stored(page)).toEqual(repaired);
  await page.getByRole('button', { name: '重新载入内容', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('checkbox', { name: '作者演武', exact: true })).toBeChecked();
});
