import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// node scripts/assets/import-freekill-media.mjs ../freekill
// 参考目录只读；运行程序只依赖复制到本项目的资源。
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(process.argv[2] ?? resolve(project, '../freekill'));
// 客户端皮肤随 Vite 打包；标准包媒体以稳定 URL 原样提供，宿主与各客户端解析同一路径。
const skin = { root: resolve(project, 'src/assets/freekill'), entries: [] };
const pack = { root: resolve(project, 'public/standard'), entries: [] };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function copy(from, to, { root, entries } = skin) {
  const input = resolve(source, from);
  const output = resolve(root, to);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(input, output);
  const bytes = readFileSync(input);
  if (hash(readFileSync(output)) !== hash(bytes)) throw new Error('Resource copy mismatch: ' + to);
  entries.push({ source: 'freekill/' + from, file: to, bytes: bytes.length, sha256: hash(bytes) });
}
function directory(from, to, accept = () => true, target = skin) {
  for (const name of readdirSync(resolve(source, from)).sort())
    if (accept(name)) copy(from + '/' + name, to + '/' + name, target);
}

for (const state of ['normal', 'pressed', 'disabled'])
  copy('image/button/skill/active/' + state + '.png', 'ui/skill/' + state + '.png');
copy('image/button/skill/locked.png', 'ui/skill/locked.png');
for (const kingdom of ['wei', 'shu', 'wu', 'qun', 'unknown'])
  copy('image/photo/back/' + kingdom + '.png', 'ui/frames/' + kingdom + '.png');
copy('image/photo/equipbg.png', 'ui/equipment.png');
for (const hp of ['0', '1', '2', '3'])
  copy('image/photo/magatama/' + hp + '.png', 'ui/hp/' + hp + '.png');
copy('image/photo/magatama/shield.png', 'ui/hp/shield.png');
for (const name of ['handcard', 'chain', 'disable'])
  copy('image/photo/' + name + '.png', 'ui/photo/' + name + '.png');
for (const role of ['lord', 'loyalist', 'rebel', 'renegade', 'unknown']) {
  copy('image/photo/role/' + role + '.png', 'ui/role/' + role + '.png');
  copy(
    'image/photo/death/' + (role === 'unknown' ? 'hidden' : role) + '.png',
    'ui/death/' + role + '.png',
  );
}
copy('image/gamebg.jpg', 'ui/gamebg.jpg');
copy('image/lady.png', 'ui/lobby/hero.png');
for (const [name, file] of [
  ['start_game', 'start'],
  ['create_room', 'room'],
  ['general_overview', 'content'],
])
  copy('image/button/tileicon/' + name + '.png', 'ui/lobby/' + file + '.png');
copy('image/generals/0.jpg', 'ui/photo/unknown.jpg');
for (const font of ['FZLBGBK', 'FZLE']) copy('fonts/' + font + '.ttf', 'fonts/' + font + '.ttf');
for (const name of ['card-back', 'chosen', 'unknown'])
  copy('image/card/' + name + '.png', 'cards/' + name + '.png');
directory('packages/standard_cards/image/card', 'cards', (name) => name.endsWith('.png'), pack);
directory('image/card/suit', 'cards/suit', (name) => name.endsWith('.png'));
for (const color of ['red', 'black'])
  directory('image/card/number/' + color, 'cards/number/' + color, (name) => name.endsWith('.png'));
for (const kind of ['playing', 'selected', 'selectable'])
  directory('image/anim/' + kind, 'ui/animation/' + kind, (name) => name.endsWith('.png'));
const png = (name) => name.endsWith('.png');
const mp3 = (name) => name.endsWith('.mp3');
directory('packages/standard_cards/image/card/equipIcon', 'icons', png, pack);
directory('packages/standard_cards/image/card/delayedTrick', 'marks', png, pack);
directory(
  'packages/standard/audio/skill',
  'audio/skill',
  (name) => mp3(name) && !name.startsWith('fastchat_'),
  pack,
);
directory('packages/standard/audio/death', 'audio/death', mp3, pack);
for (const gender of ['male', 'female'])
  directory('packages/standard_cards/audio/card/' + gender, 'audio/card/' + gender, mp3, pack);
for (const equipment of ['weapon', 'armor', 'horse'])
  copy('audio/card/common/' + equipment + '.mp3', 'audio/card/common/' + equipment + '.mp3', pack);
for (const effect of [
  'gamestart',
  'draw',
  'normal_damage',
  'fire_damage',
  'thunder_damage',
  'losehp',
  'chain',
  'win',
  'lose',
])
  copy('audio/system/' + effect + '.mp3', 'audio/system/' + effect + '.mp3');
copy('LICENSE', 'SOURCE-LICENSE.txt');
copyFileSync(resolve(skin.root, 'SOURCE-LICENSE.txt'), resolve(pack.root, 'SOURCE-LICENSE.txt'));

// 标准立绘沿用唯一目录与清单，替换旧参考图，不留下两份运行时皮肤。
const manifestPath = resolve(project, 'src/content/standard/assets.json');
const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
const portraits = previous.portraits.map(({ id, file }) => {
  const from = 'packages/standard/image/generals/' + file.slice('portraits/'.length);
  const input = resolve(source, from);
  const output = resolve(pack.root, file);
  const bytes = readFileSync(input);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(input, output);
  if (hash(readFileSync(output)) !== hash(bytes))
    throw new Error('Portrait copy mismatch: ' + file);
  return { id, source: 'freekill/' + from, file, bytes: bytes.length, sha256: hash(bytes) };
});
const usage = (what) =>
  `User-supplied local FreeKill resources ${what}. Original bytes and source attribution retained; no redistribution permission asserted.`;
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      usage: usage('for the standard pack, served verbatim from public/standard'),
      resources: pack.entries,
      portraits,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  resolve(skin.root, 'provenance.json'),
  JSON.stringify({ usage: usage('for this private project'), resources: skin.entries }, null, 2) +
    '\n',
);
const all = [...skin.entries, ...pack.entries, ...portraits];
console.log(
  JSON.stringify({
    resources: all.length,
    bytes: all.reduce((sum, entry) => sum + entry.bytes, 0),
    targets: [skin.root, pack.root],
  }),
);
