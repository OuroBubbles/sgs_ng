import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function collectFiles(root, directory, files) {
  const abs = resolve(root, directory);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collectFiles(root, name, files);
    else if (entry.isFile() && !entry.name.endsWith('.test.ts')) files.push(name);
  }
}

function hashFiles(root, files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
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

/**
 * 协议契约哈希：`src/protocol` + 客户端输入契约脚本自身。
 * 变化则双端必须同时升级；强制相等只看此项。
 */
export function protocolHash(root = projectRoot) {
  const files = [];
  collectFiles(root, 'src/protocol', files);
  files.push('scripts/network-build.mjs');
  return hashFiles(root, files);
}

/**
 * 内容树哈希：已启用内容源码（脚手架；未完全接入回放头/大厅提示）。
 * 记入 hello，客户端不强求持有同内容代码。
 */
export function contentHash(root = projectRoot) {
  const files = [];
  collectFiles(root, 'src/content', files);
  return hashFiles(root, files);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  console.log(
    JSON.stringify(
      {
        protocolHash: protocolHash(),
        contentHash: contentHash(),
      },
      null,
      2,
    ),
  );
}
