import {
  action,
  draw,
  general,
  isMale,
  nth,
  recover,
  skill,
  trigger,
  wounded,
  Cards,
} from '../../../sdk';
import type { MoveResult } from '../../../sdk';

function lostEquipment(moved: MoveResult, owner: string): readonly string[] {
  const mine = (zones: MoveResult['before']) =>
    zones
      .filter((zone) => zone.kind === 'equipment' && zone.owner === owner)
      .flatMap((zone) => zone.cards);
  const after = new Set(mine(moved.after));
  return mine(moved.before).filter((id) => !after.has(id));
}

export const xiaoji = skill({
  id: 'standard:xiaoji',
  name: '枭姬',
  description: '当你失去装备区里的一张牌后，你可以摸两张牌。一次失去多张时，逐张选择是否发动。',
  triggers: [
    trigger(Cards.moved, {
      times: (_ctx, moved, self) => lostEquipment(moved, self.owner).length,
      when: (_ctx, moved, self) => lostEquipment(moved, self.owner).length > 0,
      ask: (_ctx, _moved, _self, at) => `是否发动【枭姬】摸两张牌？${nth(at)}`,
      effect: (ctx, _moved, self) =>
        draw(ctx, { player: self.owner, count: 2, reason: self.skill }),
    }),
  ],
});

export const jieyin = skill({
  id: 'standard:jieyin',
  name: '结姻',
  description:
    '出牌阶段限一次，弃置两张手牌，令一名受伤的其他男性角色和你各回复 1 点体力。你无需处于受伤状态。',
  active: [
    action({
      id: 'discard-heal',
      limit: 1,
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
  ],
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
});

export default general({
  id: 'standard:sunshangxiang',
  name: '孙尚香',
  kingdom: '吴',
  gender: 'female',
  hp: 3,
  skills: [xiaoji, jieyin],
});
