import { action, draw, general, HE, kingdomOf, skill, on, Hp } from '../../../sdk';

export const zhiheng = skill(
  'standard:zhiheng',
  '制衡',
  '出牌阶段限一次，你可以弃置至少一张手牌或装备牌，然后摸等量的牌。标准版制衡不额外奖励弃光手牌。',
  action({
    id: 'exchange',
    limit: 1,
    cards: { count: [1, 'all'], areas: HE },
    pay: 'discard',
    declare: (_ctx, { cards }) => ({ data: { count: cards.length } }),
    effect: (ctx, { self, cards }) =>
      draw(ctx, { player: self.owner, count: cards.length, reason: self.skill }),
  }),
  { ai: { value: ({ hand, cost }) => (hand.some((card) => cost(card.id) <= 4) ? 14 : -1) } },
);

export const jiuyuan = skill(
  'standard:jiuyuan',
  '救援',
  '主公技，锁定技。其他吴势力角色对你使用桃时，额外回复 1 点体力；按当前势力判断，仍受体力上限限制。',
  on(Hp.recovering, {
    locked: true,
    who: (recovery) => recovery.input.to,
    when: (ctx, { input }, self) =>
      input.from !== null &&
      input.from !== self.owner &&
      kingdomOf(ctx.world, input.from) === '吴' &&
      input.card?.card.name === 'standard:peach',
    effect: (_ctx, recovery, self) => recovery.adjust(1, self.skill),
  }),
  { lord: true },
);

export default general('standard:sunquan', '孙权', '吴', 4, [zhiheng, jiuyuan]);
