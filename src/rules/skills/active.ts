import type { Context, FlowResult } from '../../core/runtime/room';
import type { Validation } from '../../core/decisions/hub';
import { immutable } from '../../core/model/value';
import type { SkillHandle } from './skills';
import type { CardBook } from '../cards/book';
import { isGameOver } from '../game/end';
import type { PhaseView } from '../turn/turn';
import { activePhase, activeTarget } from '../turn/turn';
import { readState } from '../state/state';

/** 主动技能是普通流程。作者自由组织选择、支付与后效，不把所有发动压成一种表单。 */
export interface ActiveSkill {
  readonly id: string;
  readonly label: string;
  readonly available: (
    ctx: Context,
    self: SkillHandle,
    phase: PhaseView,
    book: CardBook,
  ) => boolean;
  readonly run: (
    ctx: Context,
    self: SkillHandle,
    phase: PhaseView,
    book: CardBook,
  ) => void | Promise<void>;
}
export interface ActiveChoice {
  readonly skill: string;
  readonly action: string;
}
export interface ActiveOffer {
  readonly id: string;
  readonly kind: 'active';
  readonly label: string;
  readonly skill: string;
  readonly description: string;
  readonly materials: readonly string[];
  readonly count: { readonly min: 0; readonly max: 0 };
  readonly choice: { readonly instance: string; readonly action: string };
}

function open(ctx: Context, phase: PhaseView): boolean {
  const current = readState(ctx.world, activePhase, activeTarget);
  return (
    current?.id === phase.id &&
    current.stage === 'acting' &&
    phase.kind === 'play' &&
    !phase.skipped &&
    !phase.turn?.ended &&
    phase.lifetime.active &&
    phase.lifetime.belongsTo(ctx.world) &&
    ctx.cause.scopePath.includes(phase.id) &&
    ctx.world.player(phase.owner).alive &&
    !isGameOver(ctx.world)
  );
}

export function validateActive(
  ctx: Context,
  book: CardBook,
  phase: PhaseView,
  input: unknown,
): Validation<ActiveChoice> {
  return ctx.query(() => {
    if (
      !input ||
      typeof input !== 'object' ||
      !('skill' in input) ||
      typeof input.skill !== 'string' ||
      !('action' in input) ||
      typeof input.action !== 'string'
    )
      return { ok: false, reason: 'Expected active skill instance and action.' };
    const binding = book.skills.binding(ctx.world, input.skill);
    const action = binding?.definition.active?.find((action) => action.id === input.action);
    return open(ctx, phase) &&
      binding &&
      action &&
      binding.self.owner === phase.owner &&
      binding.self.effective(ctx.world) &&
      action.available(ctx, binding.self, phase, book)
      ? { ok: true, value: { skill: input.skill, action: input.action } }
      : { ok: false, reason: 'Active skill is no longer available.' };
  });
}

export function activeOffers(
  ctx: Context,
  book: CardBook,
  phase: PhaseView,
): readonly ActiveOffer[] {
  return ctx.query(() => {
    if (!open(ctx, phase)) return [];
    return immutable(
      book.skills.bindings(ctx.world).flatMap(({ self, definition }) => {
        if (self.owner !== phase.owner || !self.effective(ctx.world)) return [];
        return (definition.active ?? [])
          .filter((action) => action.available(ctx, self, phase, book))
          .map(
            (action): ActiveOffer => ({
              id: JSON.stringify(['active', self.id, action.id]),
              kind: 'active',
              label: action.label,
              skill: self.skill,
              description: definition.description ?? '',
              materials: [],
              count: { min: 0, max: 0 },
              choice: { instance: self.id, action: action.id },
            }),
          );
      }),
    );
  });
}

/** 执行前重查实例、所属席位和阶段；后续费用与宣告由普通技能代码明确提交。 */
export function activate(
  ctx: Context,
  book: CardBook,
  phase: PhaseView,
  input: ActiveChoice,
): Promise<FlowResult<void>> {
  const choice = immutable(input);
  return ctx.flow('skill.active', async (child) => {
    if (!validateActive(child, book, phase, choice).ok) return;
    const { self, definition } = book.skills.binding(child.world, choice.skill)!;
    await definition
      .active!.find((action) => action.id === choice.action)!
      .run(child, self, phase, book);
  });
}
