import { convert, skill } from '../../../sdk';

export default skill(
  'standard:qingguo',
  '倾国',
  '可以将一张黑色手牌当闪使用或打出。装备区的牌不能作为材料。',
  convert('black-jink', { as: 'standard:jink', match: (c) => c.color === 'black' }),
);
