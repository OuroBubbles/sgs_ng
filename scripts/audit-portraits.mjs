import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await read('src/content/standard/portraits/provenance.json'));
const emitted = await readdir(new URL('dist/assets/', root));
const images = [];
for (const image of manifest.images) {
  // 素材清单中的来源相对工作区；参考项目与本项目同级。
  const original = await read(`../${image.source}`);
  const copied = await read(`src/content/standard/portraits/${image.file}`);
  assert.equal(original.length, image.bytes);
  assert.equal(copied.length, image.bytes);
  assert.equal(hash(original), image.sha256);
  assert.equal(hash(copied), image.sha256);
  const prefix = `${image.file.slice(0, -4)}-`;
  const outputs = emitted.filter((name) => name.startsWith(prefix) && name.endsWith('.jpg'));
  assert.equal(outputs.length, 1, `Expected one emitted portrait: ${image.id}`);
  assert.equal(hash(await read(`dist/assets/${outputs[0]}`)), image.sha256);
  images.push({
    ...image,
    emitted: `dist/assets/${outputs[0]}`,
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
