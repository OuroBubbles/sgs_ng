// 桌面随包主持端（Node 单文件产物）没有源码树可扫：构建时把 src/host/content-tree.ts
// 换成预链接的内容树——同一组文件、静态 import 与源码文本，加载器与校验不变。
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const list = (root) =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export function prelinkContent(project = process.cwd()) {
  const tree = resolve(project, 'src/host/content-tree.ts');
  const id = '\0sgs-content-tree';
  return {
    name: 'sgs-prelink-content',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || !source.endsWith('content-tree')) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      return resolved?.id === tree ? id : null;
    },
    load(module) {
      if (module !== id) return null;
      const root = resolve(project, 'src/content');
      const files = list(root);
      const media = list(resolve(project, 'public'));
      const modules = files
        .filter((file) => /^[^/]+\/(package|(generals|cards|skills)\/[^/]+)\.ts$/.test(file))
        .map(
          (file) => `${JSON.stringify(file)}: () => import(${JSON.stringify(resolve(root, file))})`,
        );
      const texts = Object.fromEntries(
        files
          .filter((file) => !file.endsWith('.test.ts'))
          .map((file) => [file, readFileSync(resolve(root, file), 'utf8')]),
      );
      return `const files = ${JSON.stringify(files)};
const media = ${JSON.stringify(media)};
const texts = ${JSON.stringify(texts)};
const modules = {${modules.join(',\n')}};
export const contentTree = async () => ({
  root: 'src/content',
  mediaRoot: 'public',
  files,
  media,
  read: async (file) => texts[file] ?? '',
  load: (file) => modules[file](),
});
`;
    },
  };
}
