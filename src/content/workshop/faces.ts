import { cardQueries, defineSkill, modify } from '../../sdk';
import type { Card } from '../../sdk';

/** 红颜式过滤的普通作者代码；不修改实体，也不重写武圣或判定流程。 */
export const vermilion = defineSkill({
  id: 'workshop:vermilion',
  name: '映绯',
  description:
    '锁定技，你的黑桃手牌、装备及判定牌的花色视为红桃。已宣告的牌面不因离手或失去技能而改变。',
  effects: [],
  modifiers: [
    modify(cardQueries.cardFace, (_ctx, input, self) =>
      input.player === self.owner && input.card.suit === 'spade'
        ? { suit: 'heart' as const }
        : undefined,
    ),
  ],
});

/** 全黑桃便于观察印刷牌与当前牌面差别；配比仍能完成真实基础 AI 对局。 */
export function createFaceDeck(): readonly Card[] {
  const names = [
    ...Array<string>(18).fill('standard:slash'),
    ...Array<string>(8).fill('standard:jink'),
    ...Array<string>(8).fill('standard:peach'),
    ...Array<string>(4).fill('standard:ex_nihilo'),
    ...Array<string>(2).fill('standard:eight_diagram'),
  ];
  return names.map((name, index) => ({
    id: `face-card-${index + 1}`,
    name,
    suit: 'spade',
    rank: (index % 13) + 1,
  }));
}
