import { declared, defineEvent, equipmentInSlot, obtain, victimOf } from '../../sdk';
import type { CardDefinition } from '../../sdk';

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
    target: (ctx, { request, target, book }) =>
      target !== request.actor &&
      equipmentInSlot(ctx.world, book, target, 'weapon').length > 0 &&
      // 只探测结构上的杀目标，不要求此刻持有杀；不能借用即将作为借刀材料离场的武器/坐骑。
      book.validateUse(ctx, {
        actor: target,
        choice: {
          kind: 'generated',
          face: { name: 'standard:slash' },
          materials: request.card.materials,
          reason: 'standard:collateral-target',
        },
        targets: [victimOf(request)],
        timing: { kind: 'effect' },
      }).ok,
    victim: { prompt: '借刀杀人：先选持械者，最后选出杀目标' },
    async execute(ctx, { use, book, resolveTargets }) {
      const victim = victimOf(use);
      await resolveTargets(ctx, async (at, { effect }) => {
        const result = await book.askUse(at, {
          actor: effect.target,
          names: ['standard:slash'],
          targets: [victim],
          timing: { kind: 'effect' },
          prompt: `借刀杀人：对 ${victim} 使用杀，否则将武器交给 ${effect.actor}`,
        });

        if (result.kind === 'used' || !at.world.player(effect.target).alive) return;
        // 取结算此刻的武器；旧武器可能已经离场，新武器也可能来自更早的后效。
        const weapons = equipmentInSlot(at.world, book, effect.target, 'weapon');
        await obtain(at, effect.actor, weapons, 'standard:collateral', {
          kind: Collateral.weaponTaken,
          data: { actor: effect.actor, holder: effect.target, victim, cards: weapons },
        });
      });
    },
  },
};
