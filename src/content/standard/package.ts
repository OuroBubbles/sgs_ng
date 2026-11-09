import type { PackDefinition } from '../../sdk';
import { createStandardDeck } from './deck';
import { mechanicsDeck } from './practice-deck';

/**
 * 标准＋EX 包。generals/ 下每个文件即一名武将、cards/ 下每个文件即一种牌（主持端启动时发现，无需登记）；
 * 立绘、卡图与语音按约定从 public/standard 取得。order 保留历史标准武将顺序（大厅列表与按种子抽将），
 * 新增文件按文件名追加在其后。
 */
export default {
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
} satisfies PackDefinition;
