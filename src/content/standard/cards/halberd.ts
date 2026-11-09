import { cardQueries, equipment, modify, ownedCards } from '../../../sdk';

export default equipment(
  'standard:halberd',
  '方天画戟',
  { weapon: 4 },
  '武器，攻击范围 4。使用杀的材料包含全部手牌时，可额外选择至多两个目标；零材料且空手不满足条件。',
  modify(cardQueries.extraTargets, (ctx, { input: request, self }) => {
    const hand = ownedCards(ctx.world, self.owner);
    return request.actor === self.owner &&
      request.card.name === 'standard:slash' &&
      !request.card.materials.includes(self.origin?.id ?? '') &&
      hand.length > 0 &&
      hand.every((id) => request.card.materials.includes(id))
      ? 2
      : undefined;
  }),
);
