import type { GeneralPresentation } from '../package';

// Vite 为宿主输出有哈希的本地文件；作者模块构建则将同类 import 内联到单个模块。
const portraits = import.meta.glob<string>('./portraits/*.jpg', {
  eager: true,
  import: 'default',
  query: '?url',
});

export const standardGeneralViews: readonly GeneralPresentation[] = Object.entries(portraits).map(
  ([path, portrait]) => ({
    id: `standard:${path.slice('./portraits/'.length, -'.jpg'.length)}`,
    portrait,
  }),
);
