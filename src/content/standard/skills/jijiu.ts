import { convert, HE, skill, turnOwner } from '../../../sdk';

export default skill(
  'standard:jijiu',
  '急救',
  '你的回合外，你可以将一张红色手牌或装备牌当桃使用。救援属于使用牌，不能将急救当作普通打出。',
  convert('red-peach', {
    as: 'standard:peach',
    areas: HE,
    match: (c) => c.color === 'red',
    when: (ctx, { self, purpose }) => purpose === 'use' && turnOwner(ctx) !== self.owner,
  }),
);
