// 网页包只含界面与素材（P2）：构建后扫描 dist 的脚本，规则、内容或主持端代码混入即失败。
// 标记取自压缩后仍保留的字符串（类名与报错文本），每条注明来源以便定位。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const markers = [
  ['Unknown card definition', 'src/rules/skills/skills.ts'],
  ['Ability source is no longer available', 'src/rules/cards/use.ts'],
  ['Unknown skill definition', 'src/rules/skills/skills.ts'],
  ['Seed must be a nonzero uint32', 'src/core/runtime/random.ts'],
  ['Unawaited child operation', 'src/core/runtime/room.ts'],
  ['freekill/packages', 'src/content/standard/assets.json'],
];

const dist = process.argv[2] ?? 'dist';
function scripts(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return scripts(path);
    return /\.m?js$/.test(name) ? [path] : [];
  });
}

let files;
try {
  files = scripts(dist);
} catch {
  console.error(`check-web-bundle: 找不到 ${dist}，请先 vite build。`);
  process.exit(1);
}
if (!files.length) {
  console.error(`check-web-bundle: ${dist} 中没有脚本。`);
  process.exit(1);
}
const leaks = [];
let bytes = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  bytes += text.length;
  for (const [marker, source] of markers)
    if (text.includes(marker)) leaks.push(`${file}: “${marker}”（来自 ${source}）`);
}
if (leaks.length) {
  console.error('check-web-bundle: 网页包混入了只应在主持端运行的代码：');
  for (const leak of leaks) console.error(`  ${leak}`);
  process.exit(1);
}
console.log(`check-web-bundle: ${files.length} 个脚本、${bytes} 字节，未发现主持端标记。`);
