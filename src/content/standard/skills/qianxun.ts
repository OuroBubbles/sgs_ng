import { cardQueries, modify, skill } from '../../../sdk';

export default skill(
  'standard:qianxun',
  '谦逊',
  '锁定技，你不能成为顺手牵羊或乐不思蜀的目标。',
  modify(cardQueries.prohibitTarget, (_ctx, { input, self }) =>
    input.target === self.owner &&
    ['standard:snatch', 'standard:indulgence'].includes(input.card.name)
      ? true
      : undefined,
  ),
);
