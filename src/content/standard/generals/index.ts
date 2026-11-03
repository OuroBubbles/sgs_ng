import type { AuthoredGeneral } from '../../../sdk';

/** 一武将一文件：新增文件即登记，技能随武将的 skills 自动装配。 */
const modules = import.meta.glob<AuthoredGeneral>('./*.ts', { eager: true, import: 'default' });

/**
 * 标准包的武将顺序是内容的一部分：大厅列表、按种子为 AI 抽将与可复现牌局都按此顺序。
 * glob 只按文件名排序，因此这里固定原标准包顺序；未列出的新文件按文件名追加在末尾。
 */
const order = [
  'guanyu',
  'huanggai',
  'sunshangxiang',
  'zhaoyun',
  'zhangfei',
  'ganning',
  'xiahoudun',
  'xuchu',
  'zhenji',
  'simayi',
  'guojia',
  'caocao',
  'zhangliao',
  'liubei',
  'huatuo',
  'sunquan',
  'lvmeng',
  'luxun',
  'huangyueying',
  'lvbu',
  'daqiao',
  'machao',
  'zhouyu',
  'diaochan',
  'zhugeliang',
];
const rank = (path: string) => {
  const index = order.indexOf(path.slice(2, -3));
  return index < 0 ? order.length : index;
};

export const standardGenerals: readonly AuthoredGeneral[] = Object.entries(modules)
  .filter(([path]) => path !== './index.ts')
  .sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
  .map(([, general]) => general);
export const standardGeneralSkills = standardGenerals.flatMap((general) => general.abilities);
