import { action, draw, general, HE, kingdomOf, skill, trigger, Hp } from '../../../sdk';

export const zhiheng = skill({
  id: 'standard:zhiheng',
  name: '制衡',
  description:
    '出牌阶段限一次，你可以弃置至少一张手牌或装备牌，然后摸等量的牌。标准版制衡不额外奖励弃光手牌。',
  active: [
    action({
      id: 'exchange',
      limit: 1,
      cards: { count: [1, 'all'], areas: HE },
      pay: 'discard',
      declare: (_ctx, { cards }) => ({ data: { count: cards.length } }),
      effect: (ctx, { self, cards }) =>
        draw(ctx, { player: self.owner, count: cards.length, reason: self.skill }),
    }),
  ],
  ai: { value: ({ hand, cost }) => (hand.some((card) => cost(card.id) <= 4) ? 14 : -1) },
});

export const jiuyuan = skill({
  id: 'standard:jiuyuan',
  name: '救援',
  lord: true,
  description:
    '主公技，锁定技。其他吴势力角色对你使用桃时，额外回复 1 点体力；按当前势力判断，仍受体力上限限制。',
  triggers: [
    trigger(Hp.recovering, {
      locked: true,
      who: (recovery) => recovery.input.to,
      when: (ctx, { input }, self) =>
        input.from !== null &&
        input.from !== self.owner &&
        kingdomOf(ctx.world, input.from) === '吴' &&
        input.card?.card.name === 'standard:peach',
      effect: (_ctx, recovery, self) => recovery.adjust(1, self.skill),
    }),
  ],
});

export default general({
  id: 'standard:sunquan',
  name: '孙权',
  kingdom: '吴',
  hp: 4,
  skills: [zhiheng, jiuyuan],
});
