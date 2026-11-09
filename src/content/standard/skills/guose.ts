import { convert, HE, skill } from '../../../sdk';

export default skill(
  'standard:guose',
  '国色',
  '可以将一张方块手牌或装备牌当乐不思蜀使用。',
  convert('diamond-indulgence', {
    as: 'standard:indulgence',
    areas: HE,
    match: (c) => c.suit === 'diamond',
  }),
);
