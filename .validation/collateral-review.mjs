import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const before = unzipSync(readFileSync('.validation/collateral-before.zip'));
const changed = [];
for (const [path, data] of Object.entries(before)) {
  if (!/^(src|tests|scripts|docs)\//.test(path)) continue;
  const current = readFileSync(path);
  if (current.equals(Buffer.from(data))) continue;
  const baseline = resolve('.validation/collateral-before', path);
  mkdirSync(dirname(baseline), { recursive: true });
  writeFileSync(baseline, data);
  changed.push({ path, sha256: createHash('sha256').update(current).digest('hex') });
  if (process.argv[2] === path) {
    try { console.log(execFileSync('git', ['diff', '--no-index', '--', baseline, resolve(path)], { encoding: 'utf8' })); }
    catch (error) { if (error.status !== 1) throw error; console.log(error.stdout); }
  }
}
writeFileSync('.validation/collateral-source.json', JSON.stringify(changed, null, 2));
if (!process.argv[2]) console.log(changed.map((item) => item.path).join('\n'));
if (process.argv[2] === 'save-native-baseline') {
  const files = ['.artifacts/ui/native-smoke-release.json', '.artifacts/ui/native-content-restart-release.json', '.artifacts/ui/native-profile-release.json', '.artifacts/validation/native-network-release.json'];
  writeFileSync('.validation/collateral-before-native.zip', zipSync(Object.fromEntries(files.map((path) => [path, readFileSync(path)]))));
}
