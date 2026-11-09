import { draw, nth, skill, on, Cards } from '../../../sdk';
import type { MoveResult } from '../../../sdk';

function lostEquipment(moved: MoveResult, owner: string): readonly string[] {
  const mine = (zones: MoveResult['before']) =>
    zones
      .filter((zone) => zone.kind === 'equipment' && zone.owner === owner)
      .flatMap((zone) => zone.cards);
  const after = new Set(mine(moved.after));
  return mine(moved.before).filter((id) => !after.has(id));
}

export default skill(
  'standard:xiaoji',
  '枭姬',
  '当你失去装备区里的一张牌后，你可以摸两张牌。一次失去多张时，逐张选择是否发动。',
  on(Cards.moved, {
    times: (_ctx, moved, self) => lostEquipment(moved, self.owner).length,
    when: (_ctx, moved, self) => lostEquipment(moved, self.owner).length > 0,
    ask: (_ctx, _moved, _self, at) => `是否发动【枭姬】摸两张牌？${nth(at)}`,
    effect: (ctx, _moved, self) => draw(ctx, { player: self.owner, count: 2, reason: self.skill }),
  }),
);
