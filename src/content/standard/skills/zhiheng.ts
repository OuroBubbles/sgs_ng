import { action, draw, HE, skill } from '../../../sdk';

export default skill(
  'standard:zhiheng',
  '制衡',
  '出牌阶段限一次，你可以弃置至少一张手牌或装备牌，然后摸等量的牌。标准版制衡不额外奖励弃光手牌。',
  action({
    id: 'exchange',
    limit: { per: 'phase', times: 1 },
    cards: { count: [1, 'all'], areas: HE },
    pay: 'discard',
    declare: (_ctx, { cards }) => ({ data: { count: cards.length } }),
    effect: (ctx, { self, cards }) =>
      draw(ctx, { player: self.owner, count: cards.length, reason: self.skill }),
  }),
);
