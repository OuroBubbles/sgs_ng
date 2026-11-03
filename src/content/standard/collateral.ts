import { JointSelection, defineEvent, equipmentInSlot, obtain, timing } from '../../sdk';
import type { CardBook, CardDefinition, CardChoice, Context, UseRequest } from '../../sdk';

export const Collateral = defineEvent('collateral', {
  weaponTaken: timing<unknown>(),
});

function victimOf(input: unknown): string | null {
  const victim = (input as { victim?: unknown } | null | undefined)?.victim;
  return typeof victim === 'string' ? victim : null;
}

/** 只探测结构上的杀目标；不要求此刻持有杀。实际用牌仍按所选牌面完整重查。 */
function canAttack(
  ctx: Context,
  request: UseRequest,
  holder: string,
  victim: string,
  book: CardBook,
): boolean {
  const probe: CardChoice = {
    kind: 'generated',
    face: { name: 'standard:slash', suit: 'none', rank: 0, color: 'none' },
    // 不能继续借用即将作为借刀材料离场的武器/坐骑。
    materials: request.card.materials,
    reason: 'standard:collateral-target',
  };
  return book.validateUse(ctx, {
    actor: holder,
    choice: probe,
    targets: [victim],
    timing: { kind: 'effect' },
  }).ok;
}

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
      canAttack(ctx, request, target, victimOf(request.parameters) ?? '', book),
    selection(ctx, { intent, book }) {
      // 草稿包含两种角色；实际持械者上限由完整意图的 validateUse 计算。
      const targetCount = { min: 2, max: 'all' as const };
      const players = ctx.world.snapshot.players.filter((player) => player.alive);
      // 最后一位是杀的目标，不进入借刀本身的效果列表；额外持械者共用此目标。
      const selectedTargets = (targets: readonly string[]) => ({
        targets: targets.slice(0, -1),
        parameters: { victim: targets.at(-1) },
      });
      const complete = (targets: readonly string[]) =>
        targets.length >= 2 && book.validateUse(ctx, { ...intent, ...selectedTargets(targets) }).ok;
      const canComplete = (targets: readonly string[]): boolean => {
        if (complete(targets)) return true;
        if (!targets.length) return players.some((player) => canComplete([player.id]));
        return players.some(
          (player) => !targets.includes(player.id) && complete([...targets, player.id]),
        );
      };
      const model = new JointSelection({
        targetCount,
        targets: () => players.map((player) => player.id),
        constraints: {
          complete: (choice) => (complete(choice.targets) ? null : 'Illegal target.'),
          canComplete: (choice) => canComplete(choice.targets),
        },
      });
      const prompt = '借刀杀人：先选持械者，最后选出杀目标';
      return {
        ...model.decision(intent.actor, prompt, { optional: true }),
        feedback: (input) => {
          const preview = model.inspect(input);
          return {
            ...preview,
            targetCount: {
              ...targetCount,
              min:
                preview.valid && !preview.complete
                  ? Math.max(targetCount.min, preview.selection.targets.length + 1)
                  : targetCount.min,
            },
            prompt,
          };
        },
        validate: (input) => {
          const chosen = model.validate(input);
          return chosen.ok ? { ok: true, value: selectedTargets(chosen.value.targets) } : chosen;
        },
      };
    },
    async execute(ctx, { use, book, resolveTargets }) {
      const victim = victimOf(use.parameters);
      if (!victim) throw new Error('Declared collateral has no victim.');
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
