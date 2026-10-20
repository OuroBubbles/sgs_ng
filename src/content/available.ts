import type { ContentPackage } from './package';

/** 仅构建入口依赖 Vite：增加同层目录的默认导出并重新构建即可被发现。 */
const modules = import.meta.glob<ContentPackage>('./*/index.ts', {
  eager: true,
  import: 'default',
});
export const availablePackages: readonly ContentPackage[] = Object.freeze(
  Object.keys(modules)
    .sort()
    .map((path) => modules[path]!),
);
