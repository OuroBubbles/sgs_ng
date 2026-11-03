import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const read = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const sha = (data) => createHash('sha256').update(data).digest('hex');
const file = (path) => ({ path, bytes: statSync(path).size, sha256: sha(readFileSync(path)) });
const before = unzipSync(readFileSync('.validation/collateral-before.zip'));
const changes = read('.validation/collateral-source.json');
const changed = new Map(changes.map((item) => [item.path, item.sha256]));
const paths = execFileSync('rg', ['--files', 'src', 'tests', 'scripts', 'docs'], { encoding: 'utf8' }).trim().split(/\r?\n/).map((path) => path.replaceAll('\\', '/')).sort();
assert.deepEqual(paths, Object.keys(before).filter((path) => /^(src|tests|scripts|docs)\//.test(path)).sort());
const hashes = paths.map((path) => {
  const current = sha(readFileSync(path));
  if (path !== 'docs/STATUS.md') assert.equal(current, changed.get(path) ?? sha(before[path]), path);
  return [path, current];
});
const units = read('.artifacts/validation/units.json');
assert.equal(units.numFailedTests, 0);
assert.equal(units.numPassedTests, 1517);
assert.equal(units.numPendingTests, 0);
assert.equal(units.testResults.length, 86);
const browser = read('.artifacts/validation/browser.json');
assert.equal(browser.stats.unexpected, 0);
assert.equal(browser.stats.skipped, 0);
assert.equal(browser.stats.flaky, 0);
assert.equal(browser.stats.expected, 206);
const native = read('.artifacts/ui/native-smoke-release.json');
assert.equal(native.assertions.length, 74);
assert(native.assertions.includes('single-submit collateral and weapon transfer'));
assert.deepEqual(native.consoleErrors, []);
const manifest = read('.artifacts/builds/local-client-manifest.json');
assert.equal(sha(readFileSync(native.executable)), native.executableSha256);
assert.notEqual(native.executableSha256, '52f22b5a3092c62585d6a52a0702a7a2031a9cad3342a9848805c5a33f214001');
assert.equal(manifest.executableSha256, native.executableSha256);
assert.equal(sha(readFileSync(manifest.archive)), manifest.archiveSha256);
const members = unzipSync(readFileSync(manifest.archive));
assert.deepEqual(Object.keys(members).sort(), [...manifest.members].sort());
assert.equal(sha(members['sgs-ng.exe']), native.executableSha256);
const restart = read('.artifacts/ui/native-content-restart-release.json');
assert.equal(restart.executableSha256, native.executableSha256);
assert(restart.initialProcessId !== restart.restoredProcessId && restart.restoredWithoutFileSelection && restart.realHostSkillAndMaterials);
assert.deepEqual(restart.consoleErrors, []);
const network = read('.artifacts/validation/native-network-release.json');
assert.equal(network.executableSha256, native.executableSha256);
assert(network.returnedOffline && network.hiddenAndRestored && network.delegationHandoff && network.delegatedToEnd && network.result);
assert.deepEqual(network.consoleErrors, []);
const resource = read('.artifacts/validation/collateral-resources.json');
assert(resource.ports.every((item) => !item.listening));
assert(resource.profiles.every((item) => !item.exists));
const index = readFileSync('dist/index.html', 'utf8').match(/src="(\/assets\/index-[^"]+\.js)"/)[1].slice(1);
assert(readFileSync(native.executable).includes(Buffer.from(index.split('/').at(-1))));
const android = file('.artifacts/builds/sgs-ng-0.1.0-android-arm64-debug.apk');
assert.equal(android.sha256, '7c10221b6fe9a91deab5c52d2bea55664b01c879d7dee82dcbbbc319ad6797d4');
const result = {
  time: new Date().toISOString(), passed: true,
  scope: 'Offline compound card selection: one play-action draft, normalized real targets and parameters; no new online or Android scope.',
  baseline: file('.validation/collateral-before.zip'),
  source: { treeSha256: sha(JSON.stringify(hashes)), changes, statusSha256: sha(readFileSync('docs/STATUS.md')) },
  units: { passed: units.numPassedTests, files: units.testResults.length, report: '.artifacts/validation/units.json', log: file('.artifacts/collateral-check.log') },
  browser: { ...browser.stats, report: '.artifacts/validation/browser.json', log: file('.artifacts/collateral-browser.log') },
  windows: { archive: file(manifest.archive), executableSha256: native.executableSha256, frontend: file(`dist/${index}`), assertions: native.assertions.length, singleSubmitCollateral: true, processRestart: true, existingNetworkRegression: true },
  android: { ...android, containsCurrentCompoundSelection: false, boundary: 'Previous active-skill interaction delivery; this additional collateral change has not been rebuilt or exercised in the APK. No physical device.' },
  resources: resource,
};
writeFileSync('.artifacts/validation/collateral-delivery.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: true, units: result.units.passed, browser: browser.stats.expected, archive: result.windows.archive, androidIncludesCollateral: false }, null, 2));
