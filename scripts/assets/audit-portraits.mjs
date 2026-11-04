import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await read('src/content/standard/assets.json'));
const images = [];
for (const image of manifest.portraits) {
  // 素材清单中的来源相对工作区；参考项目与本项目同级。
  const original = await read(`../${image.source}`);
  const copied = await read(`public/standard/${image.file}`);
  assert.equal(original.length, image.bytes);
  assert.equal(copied.length, image.bytes);
  assert.equal(hash(original), image.sha256);
  assert.equal(hash(copied), image.sha256);
  // public/standard 原样复制到 dist，URL 稳定为 /standard/<file>。
  assert.equal(hash(await read(`dist/standard/${image.file}`)), image.sha256);
  images.push({
    ...image,
    emitted: `dist/standard/${image.file}`,
    originalAndEmittedBytesMatch: true,
  });
}
assert.equal(images.length, 25);

const guest = await read('examples/content/harbor/guest.jpg');
assert.deepEqual(guest, await read('../noname/resources/app/image/character/lingtong.jpg'));
const moduleSource = (await read('.artifacts/content/harbor.sgs.mjs')).toString('utf8');
const inline = [...moduleSource.matchAll(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/g)];
assert.equal(inline.length, 1);
assert.deepEqual(Buffer.from(inline[0][1], 'base64'), guest);

const report = {
  capturedAt: new Date().toISOString(),
  images,
  totalBytes: images.reduce((sum, image) => sum + image.bytes, 0),
  guest: { sha256: hash(guest), bytes: guest.length, originalAndInlineBytesMatch: true },
  moduleSha256: hash(Buffer.from(moduleSource)),
};
const destination = new URL('.artifacts/validation/portrait-assets.json', root);
await mkdir(new URL('.artifacts/validation/', root), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
console.log(
  `25 portraits: source, copied and emitted hashes match; guest inline bytes match.\n${fileURLToPath(destination)}`,
);
