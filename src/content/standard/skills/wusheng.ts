import { convert, HE, skill } from '../../../sdk';

export default skill(
  'standard:wusheng',
  '武圣',
  '将一张红色手牌或装备牌当杀使用或打出；沿用杀的距离、次数与目标条件。',
  convert('red-slash', { as: 'standard:slash', areas: HE, match: (c) => c.color === 'red' }),
);
