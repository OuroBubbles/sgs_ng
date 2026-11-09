import type { CardDefinition } from '../../sdk';
import { askUse, validateUse, declared, defineEvent, equipmentInSlot, obtain } from '../../sdk';

export const Collateral = defineEvent('collateral', {
  weaponTaken: declared<{
    readonly actor: string;
    readonly holder: string;
    readonly victim: string;
    readonly cards: readonly string[];
  }>(),
});

export const collateral: CardDefinition = {
  id: 'standard:collateral',
  type: 'trick',
  label: '借刀杀人',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    // 目标元组 [持械者, 杀目标]：锦囊只作用于持械者，杀目标随元组记录。
    target: [
      (ctx, { request, target }) =>
        target !== request.actor && equipmentInSlot(ctx, target, 'weapon').length > 0,
      // 只探测结构上的杀目标，不要求此刻持有杀；不能借用即将作为借刀材料离场的武器/坐骑。
      (ctx, { request, target, chosen: [holder] }) =>
        validateUse(ctx, {
          actor: holder!,
          choice: {
            kind: 'generated',
            face: { name: 'standard:slash' },
            materials: request.card.materials,
            reason: 'standard:collateral-target',
          },
          targets: [target],
          timing: { kind: 'effect' },
        }).ok,
    ],
    async resolve(ctx, { effect }) {
      const [holder, victim] = effect.tuple as [string, string];
      const result = await askUse(ctx, {
        actor: holder,
        names: ['standard:slash'],
        targets: [victim],
        timing: { kind: 'effect' },
        prompt: `借刀杀人：对 ${victim} 使用杀，否则将武器交给 ${effect.actor}`,
      });
      if (result.kind === 'used' || !ctx.world.player(holder).alive) return;
      // 取结算此刻的武器；旧武器可能已经离场，新武器也可能来自更早的后效。
      const weapons = equipmentInSlot(ctx, holder, 'weapon');
      await obtain(ctx, effect.actor, weapons, 'standard:collateral', {
        kind: Collateral.weaponTaken,
        data: { actor: effect.actor, holder, victim, cards: weapons },
      });
    },
  },
};
