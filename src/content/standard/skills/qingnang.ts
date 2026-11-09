import { action, recover, skill, wounded } from '../../../sdk';

export default skill(
  'standard:qingnang',
  '青囊',
  '出牌阶段限一次，你可以弃置一张手牌，令一名已受伤的角色回复 1 点体力，可以选择自己。',
  action({
    id: 'discard-heal',
    limit: { per: 'phase', times: 1 },
    cards: { count: 1 },
    targets: { count: 1, filter: wounded },
    pay: 'discard',
    effect: (ctx, { self, targets: [target] }) =>
      recover(ctx, { from: self.owner, to: target!, amount: 1 }),
  }),
  {
    ai: {
      targets: 'ally',
      value: ({ players, hostility }) =>
        players.some((p) => p.alive && p.hp < p.maxHp && hostility(p.id) < 0) ? 42 : -1,
    },
  },
);
