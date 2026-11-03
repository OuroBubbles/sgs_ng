import { convert, general, HE, skill } from '../../../sdk';

export const qixi = skill(
  'standard:qixi',
  '奇袭',
  '可以将一张黑色手牌或装备牌当过河拆桥使用。',
  convert('black-dismantlement', {
    as: 'standard:dismantlement',
    areas: HE,
    match: (c) => c.color === 'black',
  }),
);

export default general('standard:ganning', '甘宁', '吴', 4, [qixi]);
