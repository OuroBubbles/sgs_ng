import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';

const sha = (data) => createHash('sha256').update(data).digest('hex');
const files = [
  'collateral-snapshot.mjs', 'collateral-review.mjs', 'collateral-finalize.mjs',
  'collateral-archive.mjs', 'collateral-source.json', 'collateral-browser-red.json',
  'collateral-check-before-audit-update.log', 'collateral-dependent-count-red.log',
  'collateral-before-native.zip',
].map((path) => `.validation/${path}`);
const entries = Object.fromEntries(files.map((path) => [path, readFileSync(path)]));
const archive = '.validation/collateral-tools.zip';
writeFileSync(archive, zipSync(entries));
const restored = unzipSync(readFileSync(archive));
assert.deepEqual(Object.keys(restored).sort(), files.slice().sort());
for (const path of files) assert(Buffer.from(restored[path]).equals(entries[path]));
const before = unzipSync(readFileSync('.validation/collateral-before.zip'));
const extractedRoot = resolve('.validation/collateral-before');
const extracted = readdirSync(extractedRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => resolve(entry.parentPath, entry.name));
for (const path of extracted) {
  const key = relative(extractedRoot, path).replaceAll('\\', '/');
  assert(before[key], path);
  assert(readFileSync(path).equals(Buffer.from(before[key])), path);
}
const deliveryPath = '.artifacts/validation/collateral-delivery.json';
const delivery = JSON.parse(readFileSync(deliveryPath, 'utf8'));
delivery.tools = {
  archive: { path: archive, sha256: sha(readFileSync(archive)), members: files.length },
  sources: files.map((path) => ({ path, sha256: sha(entries[path]) })),
  extractedBaseline: { path: '.validation/collateral-before', verifiedFiles: extracted.length, source: '.validation/collateral-before.zip' },
};
writeFileSync(deliveryPath, JSON.stringify(delivery, null, 2));
console.log(JSON.stringify(delivery.tools.archive));
