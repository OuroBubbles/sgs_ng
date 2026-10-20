import { JointSelection, equipmentInSlot, isGameOver, moveCards } from '../../sdk';
import type { CardBook, CardDefinition, CardChoice, Context, UseRequest } from '../../sdk';

function victimOf(input: unknown): string | null {
  return input !== null &&
    typeof input === 'object' &&
    'victim' in input &&
    typeof input.victim === 'string'
    ? input.victim
    : null;
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

function victims(
  ctx: Context,
  request: UseRequest,
  holder: string,
  book: CardBook,
): readonly string[] {
  return ctx.world.snapshot.players
    .filter((player) => player.alive && canAttack(ctx, request, holder, player.id, book))
    .map((player) => player.id);
}

export const collateral: CardDefinition = {
  id: 'standard:collateral',
  type: 'trick',
  label: '借刀杀人',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (ctx, request, target, book) =>
      target !== request.actor &&
      equipmentInSlot(ctx.world, book, target, 'weapon').length > 0 &&
      (request.parameters === undefined
        ? victims(ctx, request, target, book).length > 0
        : canAttack(ctx, request, target, victimOf(request.parameters) ?? '', book)),
    async prepare(ctx, request, book) {
      if (request.parameters !== undefined) return { ok: true, value: request.parameters };
      const holder = request.targets[0]!;
      const model = new JointSelection({
        cards: () => [],
        cardCount: { min: 0, max: 0 },
        targetCount: { min: 1, max: 1 },
        targets: () => victims(ctx, request, holder, book).map((id) => ({ id, label: id })),
      });
      const answer = await ctx.ask(
        model.decision(request.actor, `借刀杀人：选择 ${holder} 使用杀的目标`, true, {
          cancelLabel: '取消用牌',
        }),
      );
      return answer.kind === 'chosen'
        ? { ok: true, value: { victim: answer.value.targets[0]! } }
        : { ok: false, reason: 'Collateral victim selection cancelled or unavailable.' };
    },
    async execute(ctx, use, book, resolveTargets) {
      const victim = victimOf(use.parameters);
      if (!victim) throw new Error('Declared collateral has no victim.');
      await resolveTargets(ctx, async (at, effect) => {
        const result = await book.askUse(at, {
          actor: effect.target,
          names: ['standard:slash'],
          targets: [victim],
          timing: { kind: 'effect' },
          prompt: `借刀杀人：对 ${victim} 使用杀，否则将武器交给 ${effect.actor}`,
        });
        if (result.kind === 'aborted') return at.abort(result.reason);
        if (
          result.value.kind === 'used' ||
          isGameOver(at.world) ||
          !at.world.player(effect.actor).alive ||
          !at.world.player(effect.target).alive
        )
          return;
        // 取结算此刻的武器；旧武器可能已经离场，新武器也可能来自更早的后效。
        const weapons = equipmentInSlot(at.world, book, effect.target, 'weapon');
        if (!weapons.length) return;
        const moves = weapons.map((id) => ({
          cards: [id],
          from: at.world.position(id),
          to: `${effect.actor}:hand`,
          place: 'bottom' as const,
        }));
        const moved = await moveCards(at, moves, 'standard:collateral');
        if (moved.kind === 'aborted') return at.abort(moved.reason);
        at.commit('collateral.weapon-taken', [], {
          actor: effect.actor,
          holder: effect.target,
          victim,
          cards: weapons,
        });
      });
    },
  },
};
