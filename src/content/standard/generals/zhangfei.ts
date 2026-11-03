import { cardQueries, general, modify, skill } from '../../../sdk';

export const paoxiao = skill({
  id: 'standard:paoxiao',
  name: '咆哮',
  description: '锁定技，你使用杀没有次数限制。距离、目标与响应条件不变。',
  modifiers: [
    modify(cardQueries.usageLimit, (_ctx, { input, self }) =>
      input.actor === self.owner && input.card.name === 'standard:slash' ? null : undefined,
    ),
  ],
});

export default general('standard:zhangfei', '张飞', '蜀', 4, [paoxiao]);
