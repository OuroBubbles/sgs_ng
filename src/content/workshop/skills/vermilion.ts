import { cardQueries, modify, skill } from '../../../sdk';

/** 红颜式过滤的普通作者代码；不修改实体，也不重写武圣或判定流程。 */
export default skill(
  'workshop:vermilion',
  '映绯',
  '锁定技，你的黑桃手牌、装备及判定牌的花色视为红桃。已宣告的牌面不因离手或失去技能而改变。',
  modify(cardQueries.cardFace, (_ctx, { input, self }) =>
    input.player === self.owner && input.card.suit === 'spade'
      ? { suit: 'heart' as const }
      : undefined,
  ),
);
