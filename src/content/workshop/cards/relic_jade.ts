import { draw, equipment, equipmentLost, on, Cards } from '../../../sdk';

/** 历史来源仍可普通发动；当前装备、转换与查询目录不会重新获得这件牌。 */
export default equipment(
  'workshop:relic_jade',
  '遗玉',
  'armor',
  '防具。离开你的装备区后，你可以摸一张牌。手牌中的遗玉被弃置不会发动。',
  on(Cards.moved, {
    retain: (ctx, moved, self) =>
      ctx.world.player(self.owner).alive && equipmentLost(ctx.world, moved, self),
    when: (ctx, moved, self) => equipmentLost(ctx.world, moved, self),
    ask: '是否发动【遗玉】摸一张牌？',
    effect: (ctx, _event, self) => draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
  }),
);
