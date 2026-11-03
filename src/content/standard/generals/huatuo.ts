import { action, convert, general, HE, recover, skill, turnOwner, wounded } from '../../../sdk';

export const qingnang = skill({
  id: 'standard:qingnang',
  name: '青囊',
  description:
    '出牌阶段限一次，你可以弃置一张手牌，令一名已受伤的角色回复 1 点体力，可以选择自己。',
  active: [
    action({
      id: 'discard-heal',
      limit: 1,
      cards: { count: 1 },
      targets: { count: 1, filter: wounded },
      pay: 'discard',
      effect: (ctx, { self, targets: [target] }) =>
        recover(ctx, { from: self.owner, to: target!, amount: 1 }),
    }),
  ],
  ai: {
    targets: 'ally',
    value: ({ players, hostility }) =>
      players.some((p) => p.alive && p.hp < p.maxHp && hostility(p.id) < 0) ? 42 : -1,
  },
});

export const jijiu = skill({
  id: 'standard:jijiu',
  name: '急救',
  description:
    '你的回合外，你可以将一张红色手牌或装备牌当桃使用。救援属于使用牌，不能将急救当作普通打出。',
  viewAs: [
    convert('red-peach', {
      as: 'standard:peach',
      areas: HE,
      match: (c) => c.color === 'red',
      when: (ctx, { self, purpose }) => purpose === 'use' && turnOwner(ctx) !== self.owner,
    }),
  ],
});

export default general('standard:huatuo', '华佗', '群', 3, [qingnang, jijiu]);
