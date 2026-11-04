import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// node scripts/assets/import-freekill-media.mjs ../freekill
// 参考目录只读；运行程序只依赖复制到本项目的资源。
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(process.argv[2] ?? resolve(project, '../freekill'));
const target = resolve(project, 'src/assets/freekill');
const entries = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function copy(from, to) {
  const input = resolve(source, from);
  const output = resolve(target, to);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(input, output);
  const bytes = readFileSync(input);
  if (hash(readFileSync(output)) !== hash(bytes)) throw new Error('Resource copy mismatch: ' + to);
  entries.push({ source: 'freekill/' + from, file: to, bytes: bytes.length, sha256: hash(bytes) });
}
function directory(from, to, accept = () => true) {
  for (const name of readdirSync(resolve(source, from)).sort())
    if (accept(name)) copy(from + '/' + name, to + '/' + name);
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
directory('packages/standard_cards/image/card', 'cards', (name) => name.endsWith('.png'));
directory('image/card/suit', 'cards/suit', (name) => name.endsWith('.png'));
for (const color of ['red', 'black'])
  directory('image/card/number/' + color, 'cards/number/' + color, (name) => name.endsWith('.png'));
for (const kind of ['playing', 'selected', 'selectable'])
  directory('image/anim/' + kind, 'ui/animation/' + kind, (name) => name.endsWith('.png'));
directory('packages/standard_cards/image/card/equipIcon', 'icons', (name) => name.endsWith('.png'));
directory('packages/standard_cards/image/card/delayedTrick', 'marks', (name) =>
  name.endsWith('.png'),
);
directory(
  'packages/standard/audio/skill',
  'audio/skill',
  (name) => name.endsWith('.mp3') && !name.startsWith('fastchat_'),
);
directory('packages/standard/audio/death', 'audio/death', (name) => name.endsWith('.mp3'));
for (const gender of ['male', 'female'])
  directory('packages/standard_cards/audio/card/' + gender, 'audio/card/' + gender, (name) =>
    name.endsWith('.mp3'),
  );
for (const equipment of ['weapon', 'armor', 'horse'])
  copy('audio/card/common/' + equipment + '.mp3', 'audio/card/common/' + equipment + '.mp3');
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

// 标准立绘沿用唯一目录，替换旧参考图，不留下两份运行时皮肤。
const portraitRoot = resolve(project, 'src/content/standard/portraits');
const previous = JSON.parse(readFileSync(resolve(portraitRoot, 'provenance.json'), 'utf8'));
const images = previous.images.map(({ id, file }) => {
  const from = 'packages/standard/image/generals/' + file;
  const input = resolve(source, from);
  const bytes = readFileSync(input);
  copyFileSync(input, resolve(portraitRoot, file));
  if (hash(readFileSync(resolve(portraitRoot, file))) !== hash(bytes))
    throw new Error('Portrait copy mismatch: ' + file);
  return { id, source: 'freekill/' + from, file, bytes: bytes.length, sha256: hash(bytes) };
});
writeFileSync(
  resolve(portraitRoot, 'provenance.json'),
  JSON.stringify(
    {
      usage:
        'User-supplied local FreeKill portraits; original bytes retained for this private project.',
      images,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  resolve(target, 'provenance.json'),
  JSON.stringify(
    {
      usage:
        'User-supplied local FreeKill resources for this private project. Original bytes and source attribution retained; no redistribution permission asserted.',
      resources: entries,
      portraits: images,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    resources: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    target,
  }),
);
