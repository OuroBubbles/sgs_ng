import { convert, skill } from '../../../sdk';

export default skill(
  'standard:longdan',
  '龙胆',
  '可以将一张杀当闪使用或打出，或将一张闪当杀使用或打出。',
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
);
