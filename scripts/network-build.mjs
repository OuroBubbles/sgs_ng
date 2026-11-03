import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/** 页面与两种主持入口使用同一份输入；不依赖 Git、构建时间或目标平台。 */
export function networkBuild(root = projectRoot) {
  const files = [];
  function collect(directory) {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) collect(name);
      else if (entry.isFile() && !entry.name.endsWith('.test.ts')) files.push(name);
    }
  }
  collect('src');
  collect('public');
  files.push(
    'index.html',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'svelte.config.js',
    'vite.config.ts',
    'scripts/network-build.mjs',
    'scripts/build-server.mjs',
    'scripts/build-desktop-host.mjs',
  );
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const bytes = readFileSync(resolve(root, file));
    // 文本换行不随 Git 的工作树设置变化；美术与媒体保留原始字节。
    const content = /\.(?:ts|js|mjs|svelte|css|html|json|yaml)$/.test(file)
      ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
      : bytes;
    hash.update(`${file}:${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}
