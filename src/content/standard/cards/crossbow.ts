import { cardQueries, equipment, modify } from '../../../sdk';

export default equipment(
  'standard:crossbow',
  '诸葛连弩',
  { weapon: 1 },
  '武器，攻击范围 1。你的出牌阶段使用杀没有次数限制。作为杀的材料时不能借用此能力。',
  modify(cardQueries.useRule, (_ctx, { input: request, self }) =>
    request.actor === self.owner &&
    request.card.name === 'standard:slash' &&
    !request.card.materials.includes(self.origin?.id ?? '')
      ? { times: Infinity }
      : undefined,
  ),
);
