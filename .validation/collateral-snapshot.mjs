import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { zipSync } from 'fflate';

const files = execFileSync('rg', ['--files', 'src', 'tests', 'scripts', 'docs'], { encoding: 'utf8' }).trim().split(/\r?\n/);
const entries = Object.fromEntries(files.map((path) => [path.replaceAll('\\', '/'), readFileSync(path)]));
for (const path of ['.artifacts/validation/interaction-delivery.json', '.artifacts/builds/local-client-manifest.json']) entries[path] = readFileSync(path);
writeFileSync('.validation/collateral-before.zip', zipSync(entries));
console.log(`Saved ${Object.keys(entries).length} current files.`);
