import { Equipment, equipment, on, Target } from '../../../sdk';

export default equipment(
  'standard:qinggang_sword',
  '青釭剑',
  { weapon: 2 },
  '武器，攻击范围 2。你使用杀时，此杀的目标防具失效。',
  on(Target.specified, {
    locked: true,
    when: (_ctx, { effect }, self) =>
      effect.actor === self.owner &&
      effect.card.name === 'standard:slash' &&
      effect.state === 'targeting',
    effect(ctx, { use, effect }, self) {
      effect.ignoreEquipment(ctx, 'armor', 'standard:qinggang_sword');
      ctx.commit(Equipment.ignored, [], {
        actor: self.owner,
        name: 'standard:qinggang_sword',
        use: use.id,
        effect: effect.effectId,
        target: effect.target,
        slot: 'armor',
      });
    },
  }),
);
