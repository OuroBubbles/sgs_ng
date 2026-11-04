import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// 固定官方仓库提交；资源与运行时都属于 Spine 4.2。
const commit = 'e7dc1435fa4a0083ab431f1b28e083c14a1f5c68';
const root = `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/${commit}`;
const directory = new URL('../../public/spine/', import.meta.url);
const assets = [
  ['spineboy-pro.skel', 'examples/spineboy/export/spineboy-pro.skel'],
  ['spineboy.atlas', 'examples/spineboy/export/spineboy.atlas'],
  ['spineboy.png', 'examples/spineboy/export/spineboy.png'],
  ['LICENSE', 'LICENSE'],
];

await mkdir(directory, { recursive: true });
const files = [];

for (const [filename, source] of assets) {
  const response = await fetch(`${root}/${source}`);
  if (!response.ok) throw new Error(`资源下载失败：${source} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(filename, directory), bytes);
  files.push({
    filename,
    source: `${root}/${source}`,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

await writeFile(
  new URL('manifest.json', directory),
  `${JSON.stringify({ purpose: 'P0 runtime evaluation fixture, not final game artwork', editorVersion: '4.2', commit, files }, null, 2)}\n`,
);
console.log(`Downloaded ${files.length} pinned Spine evaluation files.`);
