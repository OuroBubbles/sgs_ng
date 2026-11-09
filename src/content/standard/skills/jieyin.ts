import { action, isMale, recover, skill, wounded } from '../../../sdk';

export default skill(
  'standard:jieyin',
  '结姻',
  '出牌阶段限一次，弃置两张手牌，令一名受伤的其他男性角色和你各回复 1 点体力。你无需处于受伤状态。',
  action({
    id: 'discard-heal',
    limit: { per: 'phase', times: 1 },
    cards: { count: 2 },
    targets: {
      count: 1,
      filter: (ctx, id, { self }) => id !== self.owner && wounded(ctx, id) && isMale(ctx, id),
    },
    pay: 'discard',
    // 宣告不回滚：两次回复各自按当前状态结算。
    async effect(ctx, { self, targets: [target] }) {
      await recover(ctx, { from: self.owner, to: target!, amount: 1 });
      await recover(ctx, { from: self.owner, to: self.owner, amount: 1 });
    },
  }),
  {
    ai: {
      targets: 'ally',
      value: ({ self, players, hostility }) =>
        self.hp < self.maxHp &&
        players.some(
          (p) =>
            p.alive &&
            p.id !== self.id &&
            p.hp < p.maxHp &&
            ['male', 'dual'].includes(p.gender) &&
            hostility(p.id) < 0,
        )
          ? 40
          : -1,
    },
  },
);
