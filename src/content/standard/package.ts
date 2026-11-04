import type { PackDefinition, PackSetup } from '../../sdk';
import { standardCards } from './cards';
import { createStandardDeck } from './deck';
import { mechanicsDeck } from './practice-deck';
import { standardCardViews } from './presentation';

/**
 * 标准＋EX 包。generals/ 下每个文件即一名武将（主持端启动时发现，无需登记）；
 * 立绘与语音按约定从 public/standard 取得。order 保留历史标准顺序（大厅列表与按种子抽将），
 * 新增文件按文件名追加在其后。
 */
export default ({ media }: PackSetup): PackDefinition => ({
  cards: standardCards,
  cardViews: standardCardViews(media),
  decks: [
    { id: 'standard:identity', label: '标准＋EX（108 张）', create: createStandardDeck },
    { id: 'standard:mechanics', label: '机制练习（288 张）', create: mechanicsDeck },
  ],
  order: [
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
  ],
});
