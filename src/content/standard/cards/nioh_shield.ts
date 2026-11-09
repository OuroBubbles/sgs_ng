import { equipment, Equipment, equipmentEffectiveFor, on, Resolve } from '../../../sdk';

export default equipment(
  'standard:nioh_shield',
  '仁王盾',
  'armor',
  '防具。黑色杀对你无效。',
  on(Resolve.starting, {
    locked: true,
    when: (ctx, { effect }, self) =>
      effect.target === self.owner &&
      effect.state === 'ready' &&
      effect.card.name === 'standard:slash' &&
      effect.card.color === 'black' &&
      equipmentEffectiveFor(ctx, self, effect, 'armor'),
    effect(ctx, { effect }, self) {
      effect.cancel(ctx, 'standard:nioh_shield');
      ctx.commit(Equipment.blocked, [], {
        actor: self.owner,
        name: 'standard:nioh_shield',
        effect: effect.effectId,
      });
    },
  }),
);
