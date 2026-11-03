import { convert, general, skill } from '../../../sdk';

export const longdan = skill({
  id: 'standard:longdan',
  name: '龙胆',
  description: '可以将一张杀当闪使用或打出，或将一张闪当杀使用或打出。',
  viewAs: [
    convert('jink-slash', {
      label: '龙胆 · 杀',
      as: 'standard:slash',
      match: (c) => c.name === 'standard:jink',
    }),
    convert('slash-jink', {
      label: '龙胆 · 闪',
      as: 'standard:jink',
      match: (c) => c.name === 'standard:slash',
    }),
  ],
});

export default general({
  id: 'standard:zhaoyun',
  name: '赵云',
  kingdom: '蜀',
  hp: 4,
  skills: [longdan],
});
