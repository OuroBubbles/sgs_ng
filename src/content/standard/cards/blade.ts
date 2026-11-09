import { askUse, Attack, equipment, on } from '../../../sdk';
import { Weapon, slashDefended } from '../card-kit';

export default equipment(
  'standard:blade',
  '青龙偃月刀',
  { weapon: 3 },
  '武器，攻击范围 3。你的杀被闪抵消后，可对原目标再使用一张杀，忽略距离与出牌阶段次数。',
  on(Attack.defended, {
    when: slashDefended,
    async effect(ctx, draft, self) {
      const used = await askUse(ctx, {
        actor: self.owner,
        names: ['standard:slash'],
        targets: [draft.effect.target],
        timing: { kind: 'effect', ignoreDistance: true },
        prompt: `青龙偃月刀：可对 ${draft.effect.target} 再使用一张杀（忽略距离与阶段次数）`,
        available: (at) =>
          self.active(at) && !draft.broken && at.world.player(draft.effect.target).alive,
      });
      if (used.kind === 'used')
        ctx.commit(Weapon.followUp, [], {
          actor: self.owner,
          name: self.name,
          fromEffect: draft.effect.effectId,
          use: used.use.id,
        });
    },
  }),
);
