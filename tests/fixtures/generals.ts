import { standardGeneralSkills, standardGenerals } from '../../src/content/standard/generals';
import { cardGame } from './cards';

/** 标准武将改为按文件自动登记后，保留旧阵容下标顺序，使既有种子对局逐步回放不变。 */
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
export const legacyGenerals = order.map(
  (name) => standardGenerals.find((general) => general.id === `standard:${name}`)!,
);

/** 标准武将场景：目录装配全部标准武将技能，a 默认空手；技能需另行 grant。 */
export const generalGame = (options: Parameters<typeof cardGame>[0] = {}) =>
  cardGame({
    ...options,
    hands: { a: [], ...options.hands },
    skills: options.skills ?? standardGeneralSkills,
  });
