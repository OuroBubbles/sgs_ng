import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** 从真实 IndexedDB 读取二进制与源码哈希，不以文件名或 Blob URL 冒充持久资源。 */
export async function resourceBundleRecord(page) {
  const actual = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sgs-ng-content', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const record = await new Promise((resolve, reject) => {
        const request = db.transaction('loadout').objectStore('loadout').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const module = record.modules.find((entry) => entry.id === 'gallery');
      const asset = module.assets[0];
      const digest = async (bytes) =>
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
      return {
        id: module.id,
        enabled: record.enabled.includes('gallery'),
        binary: asset.blob instanceof Blob,
        bytes: asset.blob.size,
        type: asset.blob.type,
        sourceHasInlineImage: module.source.includes('data:image'),
        sourceSha256: await digest(new TextEncoder().encode(module.source)),
        imageSha256: await digest(await asset.blob.arrayBuffer()),
      };
    } finally {
      db.close();
    }
  });
  assert.equal(actual.enabled, true);
  assert.equal(actual.binary, true);
  assert.equal(actual.sourceHasInlineImage, false);
  assert.equal(actual.bytes, 274000);
  assert.equal(actual.type, 'image/jpeg');
  assert.equal(
    actual.imageSha256,
    createHash('sha256')
      .update(await readFile('examples/content/harbor/guest.jpg'))
      .digest('hex'),
  );
  return {
    ...actual,
    file: '.artifacts/content/gallery.sgs',
    sha256: createHash('sha256')
      .update(await readFile('.artifacts/content/gallery.sgs'))
      .digest('hex'),
  };
}

export async function playResourceGuest(page) {
  await page.getByRole('combobox', { name: '你的武将', exact: true }).selectOption('gallery:guest');
  await page
    .getByRole('combobox', { name: 'AI 武将', exact: true })
    .selectOption('standard:guanyu');
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
  const hand = page.getByTestId('hand-cards').locator('button'),
    before = await hand.count();
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
}
