import { cardDef, cardQueries, modify, skill } from '../../../sdk';

export default skill(
  'standard:qicai',
  '奇才',
  '锁定技，你使用锦囊牌无距离限制；仍须满足其他目标条件。',
  modify(cardQueries.useRule, (ctx, { input, self }) =>
    input.actor === self.owner && cardDef(ctx, input.card.name).type === 'trick'
      ? { range: Infinity }
      : undefined,
  ),
);
