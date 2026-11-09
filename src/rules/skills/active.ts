import { rulesOf } from './skills';
import type { Context } from '../../core/runtime/room';
import type { Validation } from '../../core/decisions/hub';
import { immutable } from '../../core/model/value';
import type { SkillHandle } from './skills';
import { isGameOver } from '../game/end';
import type { PhaseView } from '../turn/turn';
import { activePhase } from '../turn/turn';
import { JointSelection, type JointChoice } from '../../core/decisions/selection';

/** 技能的具名输入；Context 仍显式传递，来源、阶段和本局目录不注入全局对象。 */
export interface ActiveInput {
  readonly self: SkillHandle;
  readonly phase: PhaseView;
}
export interface ActiveRunInput extends ActiveInput {
  readonly choice: JointChoice;
  /** 本次执行重查使用的模型；支付前仍可读取当前候选，无需再次调用工厂。 */
  readonly selection: JointSelection;
}

/** 发动前的牌与目标共用一个选择；提交后的支付、响应与后效仍是普通流程。 */
export interface ActiveSkill {
  readonly id: string;
  /** 菜单文字；省略时使用当前技能实例的名称。 */
  readonly label?: string | undefined;
  /** 仅表达次数等额外发动条件；材料与目标能否完成由 selection 统一判断。 */
  readonly available?: (ctx: Context, input: ActiveInput) => boolean;
  /** 纯同步选择工厂；候选与约束在每次预览、提交时读取当前状态。 */
  readonly selection?: (ctx: Context, input: ActiveInput) => JointSelection;
  /** 等待整段技能后效，忽略其返回值；支付与结果处理由技能代码表达。 */
  readonly run: (ctx: Context, input: ActiveRunInput) => unknown;
}
export interface ActiveChoice extends JointChoice {
  /** 本局技能实例，与主动菜单 choice 的来源身份一致。 */
  readonly instance: string;
  readonly action: string;
}
export interface ActiveOffer {
  readonly id: string;
  readonly kind: 'active';
  readonly label: string;
  readonly skill: string;
  readonly description: string;
  readonly materials: readonly string[];
  readonly count: { readonly min: number; readonly max: number | 'all' };
  readonly choice: Pick<ActiveChoice, 'instance' | 'action'>;
}

const emptySelection = new JointSelection();
const isRecord = (input: unknown): input is Record<string, unknown> =>
  input !== null && typeof input === 'object';

function availableSelection(ctx: Context, input: ActiveInput, action: ActiveSkill) {
  if (action.available !== undefined && !action.available(ctx, input)) return null;
  const model = action.selection ? action.selection(ctx, input) : emptySelection;
  return model.available() ? model : null;
}

function open(ctx: Context, phase: PhaseView): boolean {
  const current = activePhase.of(ctx.world);
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

interface CheckedActive {
  readonly self: SkillHandle;
  readonly action: ActiveSkill;
  readonly selection: JointSelection;
  readonly choice: ActiveChoice;
}

/** 在调用者的纯查询内解析来源和模型；草稿是否完成仍由预览或最终验证决定。 */
function selectActive(
  ctx: Context,
  phase: PhaseView,
  input: unknown,
): Validation<Omit<CheckedActive, 'choice'>> {
  if (!isRecord(input) || typeof input.instance !== 'string' || typeof input.action !== 'string')
    return { ok: false, reason: 'Expected active skill instance and action.' };
  const binding = rulesOf(ctx).binding(ctx.world, input.instance);
  const action = binding?.definition.active?.find((action) => action.id === input.action);
  if (
    !open(ctx, phase) ||
    !binding ||
    !action ||
    binding.self.owner !== phase.owner ||
    !binding.self.active(ctx)
  )
    return { ok: false, reason: 'Active skill is no longer available.' };
  const selection = availableSelection(ctx, { self: binding.self, phase }, action);
  return selection
    ? { ok: true, value: { self: binding.self, action, selection } }
    : { ok: false, reason: 'Active skill is no longer available.' };
}

function checkActive(ctx: Context, phase: PhaseView, input: unknown): Validation<CheckedActive> {
  return ctx.query(() => {
    const selected = selectActive(ctx, phase, input);
    if (!selected.ok) return selected;
    const { self, action, selection } = selected.value;
    const checked = selection.validate(input);
    return checked.ok
      ? {
          ok: true,
          value: {
            self,
            action,
            selection,
            choice: { instance: self.id, action: action.id, ...checked.value },
          },
        }
      : checked;
  });
}

export function validateActive(
  ctx: Context,
  phase: PhaseView,
  input: unknown,
): Validation<ActiveChoice> {
  const checked = checkActive(ctx, phase, input);
  return checked.ok ? { ok: true, value: checked.value.choice } : checked;
}

/** 只预览当前实例的选择，不发动、不支付，也不产生额外的决策。 */
export function inspectActive(ctx: Context, phase: PhaseView, input: unknown) {
  return ctx.query(() => {
    const selected = selectActive(ctx, phase, input);
    if (!selected.ok) return null;
    const { preview, ...description } = selected.value.selection.describe(input);
    return { ...description, ...preview, fixedTargets: [] };
  });
}

export function activeOffers(ctx: Context, phase: PhaseView): readonly ActiveOffer[] {
  return ctx.query(() => {
    return immutable(
      Array.from(
        activeSelections(ctx, phase),
        ({ self, definition, action, model }): ActiveOffer => {
          const described = model.describe();
          return {
            id: JSON.stringify(['active', self.id, action.id]),
            kind: 'active',
            label: action.label ?? self.name,
            skill: self.skill,
            description: definition.description ?? '',
            materials: described.preview.cards.map((card) => card.id),
            count: described.cardCount,
            choice: { instance: self.id, action: action.id },
          };
        },
      ),
    );
  });
}

/** 与菜单共用来源、阶段和选择资格，只判断是否存在，不投影逐项选择。 */
export function activeAvailable(ctx: Context, phase: PhaseView): boolean {
  return ctx.query(() => activeSelections(ctx, phase).next().done === false);
}

function* activeSelections(ctx: Context, phase: PhaseView) {
  if (!open(ctx, phase)) return;
  for (const { self, definition } of rulesOf(ctx).bindings(ctx.world)) {
    if (self.owner !== phase.owner || !self.active(ctx)) continue;
    for (const action of definition.active ?? []) {
      const model = availableSelection(ctx, { self, phase }, action);
      if (model) yield { self, definition, action, model };
    }
  }
}

/** 执行前重查实例、所属席位和阶段；后续费用与宣告由普通技能代码明确提交。 */
export function activate(ctx: Context, phase: PhaseView, input: ActiveChoice): Promise<void> {
  const choice = immutable(input);
  return ctx.flow('skill.active', async (child) => {
    const checked = checkActive(child, phase, choice);
    if (!checked.ok) return;
    const { self, action, selection } = checked.value;
    await action.run(child, { self, phase, choice: checked.value.choice, selection });
  });
}
