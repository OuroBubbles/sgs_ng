import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ContentTree } from './load-content';

const slash = (path: string) => path.replaceAll('\\', '/');

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => slash(relative(root, join(entry.parentPath, entry.name))))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 磁盘上的内容树：每次调用重新列目录，新增或删除的 .ts 在主持端重启后即生效。 */
export async function directoryTree(root: string, mediaRoot: string): Promise<ContentTree> {
  const [files, media] = await Promise.all([listFiles(root), listFiles(mediaRoot)]);
  const display = (path: string) => slash(relative(process.cwd(), path)) || '.';
  return {
    root: display(root),
    mediaRoot: display(mediaRoot),
    files,
    media,
    read: (file) => readFile(join(root, file), 'utf8'),
    load: (file) => import(pathToFileURL(join(root, file)).href),
  };
}

/**
 * 主持端的内容树：`src/content` 与 `public`（相对本文件定位，与工作目录无关）。
 * 桌面随包主持端（Node 产物，P8 前）由 scripts/build-desktop-host.mjs 把本模块换成预链接表。
 */
export const contentTree = () =>
  directoryTree(
    fileURLToPath(new URL('../content/', import.meta.url)),
    fileURLToPath(new URL('../../public/', import.meta.url)),
  );
