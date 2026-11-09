import { draw, on, skill, Damage } from '../../../sdk';

/** 不属于任何武将：由拾慧在局中授予。 */
export default skill(
  'workshop:echo',
  '余响',
  '受到一次伤害后，你可以摸一张牌。每次伤害一次，不按伤害点数重复。',
  on(Damage.received, {
    when: (_ctx, hit, self) => hit.input.to === self.owner,
    ask: '是否发动【余响】摸一张牌？',
    effect: (ctx, _event, self) => draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
  }),
);
