import type { AuthoredGeneral } from '../../../sdk';
import guanyu from './guanyu';
import huanggai from './huanggai';
import sunshangxiang from './sunshangxiang';
import zhaoyun from './zhaoyun';
import zhangfei from './zhangfei';
import ganning from './ganning';
import xiahoudun from './xiahoudun';
import xuchu from './xuchu';
import zhenji from './zhenji';
import simayi from './simayi';
import guojia from './guojia';
import caocao from './caocao';
import zhangliao from './zhangliao';
import liubei from './liubei';
import huatuo from './huatuo';
import sunquan from './sunquan';
import lvmeng from './lvmeng';
import luxun from './luxun';
import huangyueying from './huangyueying';
import lvbu from './lvbu';
import daqiao from './daqiao';
import machao from './machao';
import zhouyu from './zhouyu';
import diaochan from './diaochan';
import zhugeliang from './zhugeliang';

/**
 * 标准包武将登记表，顺序即内容：大厅列表、按种子为 AI 抽将与可复现牌局都按此顺序。
 * 显式静态导入在 Bun 宿主、Vite 与 vitest 下行为一致；新增武将在此追加一行
 * （P3 由宿主目录扫描取代本表）。技能随武将的 skills 自动装配。
 */
export const standardGenerals: readonly AuthoredGeneral[] = [
  guanyu,
  huanggai,
  sunshangxiang,
  zhaoyun,
  zhangfei,
  ganning,
  xiahoudun,
  xuchu,
  zhenji,
  simayi,
  guojia,
  caocao,
  zhangliao,
  liubei,
  huatuo,
  sunquan,
  lvmeng,
  luxun,
  huangyueying,
  lvbu,
  daqiao,
  machao,
  zhouyu,
  diaochan,
  zhugeliang,
];
export const standardGeneralSkills = standardGenerals.flatMap((general) => general.abilities);
