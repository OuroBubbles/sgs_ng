import { convert, general, HE, skill } from '../../../sdk';

export const wusheng = skill({
  id: 'standard:wusheng',
  name: '武圣',
  description: '将一张红色手牌或装备牌当杀使用或打出；沿用杀的距离、次数与目标条件。',
  viewAs: [
    convert('red-slash', { as: 'standard:slash', areas: HE, match: (c) => c.color === 'red' }),
  ],
});

export default general({
  id: 'standard:guanyu',
  name: '关羽',
  kingdom: '蜀',
  hp: 4,
  skills: [wusheng],
});
