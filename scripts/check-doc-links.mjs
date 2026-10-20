import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 仅检查项目文档指向的本地文件；不抓取外网，也不把设计描述当交付证明。
const root = fileURLToPath(new URL('../', import.meta.url));
const docs = await readdir(resolve(root, 'docs'), { recursive: true });
const files = [
  'README.md',
  ...docs.filter((file) => file.endsWith('.md')).map((file) => `docs/${file}`),
];
const failures = [];
let checked = 0;
for (const name of files) {
  const file = resolve(root, name);
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
    const target = match[1] ?? match[2];
    if (!target || /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    try {
      await access(fileURLToPath(new URL(target, pathToFileURL(file))));
      checked++;
    } catch {
      failures.push(`${relative(root, file)}:${line}: ${target}`);
    }
  }
}
if (failures.length) {
  console.error(`Broken local documentation links:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else
  console.log(`Documentation links: ${checked} local targets verified in ${files.length} files.`);
