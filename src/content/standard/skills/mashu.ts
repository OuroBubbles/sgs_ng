import { cardQueries, modify, skill } from '../../../sdk';

export default skill(
  'standard:mashu',
  '马术',
  '锁定技，你计算与其他角色的距离时减一。',
  modify(cardQueries.distanceCorrection, (_ctx, { input, self }) =>
    input.from === self.owner && input.to !== self.owner ? -1 : undefined,
  ),
);
