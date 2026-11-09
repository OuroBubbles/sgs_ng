import type { Card, WorldReader } from '../../core/model/state';
import type { Validation } from '../../core/decisions/hub';
import { normalizeChoiceCount } from '../../core/decisions/count';
import type { ChoiceCount } from '../../core/decisions/count';
import type { Context } from '../../core/runtime/room';
import type { Lifetime } from '../scopes/lifetime';
import type { Limit } from '../costs/pay';
import type { SkillHandle } from '../skills/skills';
import type { UseResult } from './use';
import type { UsePlanView } from './plan';
import type { EquipmentDefinition } from './equipment';
import type { DelayedRules } from './delayed';
import { immutable } from '../../core/model/value';

export type Purpose = 'use' | 'response';
/** 火/雷是内置属性；扩展可以使用自己的具名属性，不需要修改内核枚举。 */
export type Nature = string;
export type CardColor = 'red' | 'black' | 'none';
export function colorOfSuit(suit: Card['suit']): CardColor {
  return suit === 'heart' || suit === 'diamond'
    ? 'red'
    : suit === 'spade' || suit === 'club'
      ? 'black'
      : 'none';
}
export interface CardFace {
  readonly name: string;
  readonly suit?: Card['suit'];
  readonly rank?: number;
  readonly nature?: Nature;
  readonly color?: CardColor;
}
export interface SemanticCard {
  readonly name: string;
  readonly suit: Card['suit'];
  readonly color: CardColor;
  readonly rank: number;
  readonly nature: Nature;
  readonly materials: readonly string[];
  readonly source:
    | {
        readonly kind: 'viewAs';
        readonly skill: string;
        readonly instance: string;
        readonly recipe: string;
      }
    | {
        readonly kind: 'generated';
        readonly reason: string;
        readonly origin?: { readonly actor: string; readonly card: SemanticCard };
      }
    | null;
}
export type CardChoice =
  | { readonly kind: 'physical'; readonly card: string }
  | {
      readonly kind: 'viewAs';
      readonly instance: string;
      readonly recipe: string;
      readonly materials: readonly string[];
      readonly parameters?: unknown;
    }
  | {
      readonly kind: 'generated';
      readonly face: CardFace;
      readonly materials: readonly string[];
      readonly reason: string;
      readonly origin?: { readonly actor: string; readonly card: SemanticCard };
    };

/** 转换的显式输入；用途在预览与最终构牌时保持一致。 */
export interface ViewAsInput {
  readonly self: SkillHandle;
  readonly purpose: Purpose;
}
export interface ViewAsMakeInput extends ViewAsInput {
  readonly materials: readonly string[];
  readonly parameters: unknown;
}
export interface ViewAsUseInput extends ViewAsInput {
  readonly purpose: 'use';
  readonly intent: UseIntent;
}

interface ViewAsSpec {
  readonly id: string;
  /** 菜单文字；省略时使用当前技能实例的名称。 */
  readonly label?: string | undefined;
  readonly materials: (ctx: Context, input: ViewAsInput) => readonly string[];
  readonly count: ChoiceCount | ((ctx: Context, input: ViewAsInput) => ChoiceCount);
  readonly available?: (ctx: Context, input: ViewAsInput) => boolean;
  /** 通过初次校验后，直接返回用牌结果或其 Promise；同步放弃与异步准备均用普通代码。 */
  readonly use?: (ctx: Context, input: ViewAsUseInput) => UseResult | Promise<UseResult>;
}

/**
 * 固定转换直接声明牌面，动态转换保留 names/make 与普通参数构牌。
 * 零材料可整组省略候选和数量；需要材料时两者必须同时声明。
 */
export type ViewAs = Omit<ViewAsSpec, 'materials' | 'count'> &
  (
    | Pick<ViewAsSpec, 'materials' | 'count'>
    | { readonly materials?: never; readonly count?: never }
  ) &
  (
    | { readonly make: CardFace; readonly names?: never }
    | {
        readonly names: (ctx: Context, input: ViewAsInput) => readonly string[];
        readonly make: (ctx: Context, input: ViewAsMakeInput) => CardFace | null;
      }
  );

export type UseTiming =
  | { readonly kind: 'play'; readonly owner: string; readonly phase: Lifetime }
  | { readonly kind: 'effect'; readonly ignoreDistance?: boolean }
  | { readonly kind: 'rescue'; readonly dying: string }
  | { readonly kind: 'response'; readonly opportunity: ResponseUseOpportunity }
  | { readonly kind: 'counter'; readonly opportunity: CounterOpportunity };
/** 响应中的使用机会；普通 effect 用途不能伪造这项具备生存期的资格。 */
export interface ResponseUseOpportunity {
  readonly lifetime: Lifetime;
  readonly actor: string;
  readonly names: readonly string[];
  readonly to: EffectRef;
  readonly available: (ctx: Context) => boolean;
}
export interface CardUseRef {
  readonly useId: string;
  readonly actor: string;
  readonly card: SemanticCard;
  readonly processing: string;
  readonly prohibitedCounters?: readonly string[];
}
export type CounterSubject =
  | { readonly kind: 'effect'; readonly effect: EffectRef }
  | { readonly kind: 'use'; readonly use: CardUseRef };
export interface CounterOpportunity {
  readonly depth: number;
  readonly lifetime: Lifetime;
  readonly subject: CounterSubject;
  readonly root: EffectRef;
  readonly available: (ctx: Context) => boolean;
  readonly names: readonly string[];
}
export type TimingSnapshot =
  | { readonly kind: 'play'; readonly owner: string; readonly phase: string }
  | { readonly kind: 'effect'; readonly ignoreDistance?: boolean }
  | { readonly kind: 'rescue'; readonly dying: string }
  | { readonly kind: 'response'; readonly opportunity: string; readonly to: EffectRef }
  | {
      readonly kind: 'counter';
      readonly depth: number;
      readonly opportunity: string;
      readonly names: readonly string[];
      readonly subject: CounterSubject;
      readonly root: EffectRef;
    };
/**
 * 一个用牌目标：单个角色，或按牌定义 target 过滤器顺序排列的角色元组（如借刀杀人的 [持械者, 杀目标]）。
 * 元组首位是效果目标；单元素元组规范写作字符串。
 */
export type UseTarget = string | readonly string[];
export const tupleOf = (target: UseTarget): readonly string[] =>
  typeof target === 'string' ? [target] : target;
export const primaryOf = (target: UseTarget): string =>
  typeof target === 'string' ? target : target[0]!;
export interface UseIntent {
  readonly actor: string;
  readonly choice: CardChoice;
  readonly targets: readonly UseTarget[];
  readonly timing: UseTiming;
  /** 规则调用者可预填附属选择；牌定义必须验证，普通玩家输入不直接透传。 */
  readonly parameters?: unknown;
  /** 本次用牌明确禁止的反制牌名，不改变整种牌的定义。 */
  readonly prohibitedCounters?: readonly string[];
}
export interface UseRequest {
  readonly actor: string;
  readonly card: SemanticCard;
  readonly targets: readonly UseTarget[];
  readonly timing: UseTiming;
  readonly parameters?: unknown;
  readonly targetOptions?: TargetOptions;
}
/** 只豁免距离；角色存活、牌定义与目标禁令仍由统一管线检查。 */
export interface TargetOptions {
  readonly ignoreDistance?: boolean;
}
/** actor 是本次效果中需要响应的角色；代打者不改变这一禁令归属。 */
export interface ResponseBlock {
  readonly actor: string;
  /** null 禁止全部响应牌；具名列表只禁止这些语义牌名。 */
  readonly names: readonly string[] | null;
  readonly reason: string;
}
export interface EffectRef {
  readonly useId: string;
  readonly effectId: string;
  readonly actor: string;
  readonly target: string;
  /** 元组目标的完整角色序列（首位即 target）；单角色目标省略。 */
  readonly tuple?: readonly string[];
  readonly card: SemanticCard;
  readonly processing: string;
  readonly prohibitedCounters?: readonly string[];
  readonly responseBlocks?: readonly ResponseBlock[];
  readonly ignoredEquipment?: readonly { readonly slot: string; readonly reason: string }[];
  readonly responseRequirements?: readonly {
    readonly actor: string;
    readonly minimum: number;
    readonly reason: string;
  }[];
}
export const targetStages = ['specifying', 'confirming', 'specified', 'confirmed'] as const;
export type TargetStage = (typeof targetStages)[number];

export interface EffectSnapshot extends EffectRef {
  readonly ignoredEquipment: readonly { readonly slot: string; readonly reason: string }[];
  /** 最后进入的目标时点；延时牌后续生效不重新指定目标，保持 null。 */
  readonly targetStage: TargetStage | null;
  readonly state:
    | 'pending'
    | 'targeting'
    | 'ready'
    | 'resolving'
    | 'resolved'
    | 'cancelled'
    | 'skipped'
    | 'aborted';
  readonly reason: string | null;
}
export interface CardEffect extends EffectRef {
  /** 本效果的目标元组；单角色目标为 [target]。 */
  readonly tuple: readonly string[];
  readonly state: EffectSnapshot['state'];
  readonly targetStage: TargetStage | null;
  cancel(ctx: Context, reason: string): void;
  ignoreEquipment(ctx: Context, slot: string, reason: string): void;
  requireResponses(ctx: Context, actor: string, minimum: number, reason: string): void;
  blockResponses(
    ctx: Context,
    actor: string,
    reason: string,
    names?: readonly string[] | null,
  ): void;
}
export interface UseSnapshot {
  readonly id: string;
  readonly actor: string;
  readonly actionOrder: readonly string[];
  readonly card: SemanticCard;
  readonly processing: string;
  readonly timing: TimingSnapshot;
  readonly stage: 'use' | 'delayed';
  readonly outcome: unknown;
  readonly parameters?: unknown;
  readonly prohibitedCounters?: readonly string[];
  readonly effects: readonly EffectSnapshot[];
  readonly edits: readonly {
    readonly kind: string;
    readonly effectId: string;
    readonly target: string;
    readonly reason: string;
    readonly fromEffectId: string | null;
  }[];
}
/** 卡牌回调的具名输入；规则操作经 ctx 取得本局目录。 */
export interface CardUseInput {
  readonly request: UseRequest;
}
export interface CardTargetInput extends CardUseInput {
  readonly target: string;
  /** 同一目标元组中已选的前序角色；单角色目标为空。 */
  readonly chosen: readonly string[];
}
export type TargetFilter = (ctx: Context, input: CardTargetInput) => boolean;
export interface CardFixedTargetsInput {
  readonly actor: string;
  readonly card: SemanticCard;
}
export interface CardEffectInput {
  readonly effect: CardEffect;
}
export interface CardExecuteInput {
  readonly use: UsePlanView;
  readonly resolveTargets: ResolveTargets;
}

export interface UseRules {
  readonly count: ChoiceCount;
  /** 省略时接受所有规则用途；提供时也约束候选菜单，不把仅可响应的牌列入出牌阶段。 */
  readonly timings?: readonly UseTiming['kind'][];
  /** 次数限制，如杀 { per: 'phase', times: 1 }；只约束出牌阶段的主动使用。 */
  readonly limit?: Limit;
  readonly canUse?: (ctx: Context, input: CardUseInput) => string | null;
  /** 单个过滤器选单角色目标；过滤器数组按位置选目标元组，count 计元组个数。 */
  readonly target: TargetFilter | readonly [TargetFilter, ...TargetFilter[]];
  /** 选目标时的提示（元组牌说明点选顺序）；省略时为通用提示。 */
  readonly prompt?: string;
  /** 宣告前的附属选择：返回已验证的普通参数；统一管线再做最终校验；取消不支付、不开放用牌窗口。 */
  readonly prepare?: (
    ctx: Context,
    input: CardUseInput,
  ) => Validation<unknown> | Promise<Validation<unknown>>;
  /** 自动目标在宣告前计算并冻结，玩家不再手工指定；禁止目标由统一管线过滤。 */
  readonly fixedTargets?: (ctx: Context, input: CardFixedTargetsInput) => readonly string[];
  readonly canResolve?: (ctx: Context, input: CardEffectInput) => boolean;
  readonly resolve?: TargetResolver;
  /** 整张牌的普通控制流，可用处理区包住全部目标；有目标时必须明确调用一次 resolveTargets。 */
  readonly execute?: (ctx: Context, input: CardExecuteInput) => unknown;
}
/** 等待该目标的普通规则操作；返回值不替代明确的目标状态与中止语义。 */
export type TargetResolver = (ctx: Context, input: CardEffectInput) => unknown;
export type ResolveTargets = (at: Context, resolve?: TargetResolver) => Promise<void>;
export interface CardDefinition {
  readonly id: string;
  readonly type: 'basic' | 'trick' | 'equipment';
  readonly label: string;
  /** 规则说明（与技能说明同等地位）；大厅与卡面详情直接显示。 */
  readonly description?: string;
  readonly nature?: Nature;
  readonly response?: boolean;
  readonly counterable?: boolean;
  readonly equipment?: EquipmentDefinition;
  readonly delayed?: DelayedRules;
  readonly use?: UseRules;
}
export function ownedCards(
  world: WorldReader,
  owner: string,
  areas: readonly string[] = ['hand'],
): readonly string[] {
  return world.snapshot.zones
    .filter((zone) => zone.owner === owner && areas.includes(zone.kind))
    .flatMap((zone) => zone.cards);
}
/** 与实际供牌者的禁止打出查询分开；这里只判断该角色回应当前效果的具名禁令。 */
export function isResponseBlocked(effect: EffectRef, actor: string, name: string): boolean {
  return (
    effect.responseBlocks?.some(
      (entry) => entry.actor === actor && (entry.names === null || entry.names.includes(name)),
    ) ?? false
  );
}
export function effectReference(effect: EffectRef): EffectRef {
  return immutable({
    useId: effect.useId,
    effectId: effect.effectId,
    actor: effect.actor,
    target: effect.target,
    card: effect.card,
    processing: effect.processing,
    ...((effect.ignoredEquipment?.length ?? 0) > 0
      ? { ignoredEquipment: effect.ignoredEquipment }
      : {}),
    ...((effect.responseRequirements?.length ?? 0) > 0
      ? { responseRequirements: effect.responseRequirements }
      : {}),
    ...((effect.responseBlocks?.length ?? 0) > 0 ? { responseBlocks: effect.responseBlocks } : {}),
    ...((effect.prohibitedCounters?.length ?? 0) > 0
      ? { prohibitedCounters: effect.prohibitedCounters }
      : {}),
  });
}
export function useReference(
  use: Pick<UsePlanView, 'id' | 'actor' | 'card' | 'processing'> & {
    readonly prohibitedCounters?: readonly string[];
  },
): CardUseRef {
  return immutable({
    useId: use.id,
    actor: use.actor,
    card: use.card,
    processing: use.processing,
    ...((use.prohibitedCounters?.length ?? 0) > 0
      ? { prohibitedCounters: use.prohibitedCounters }
      : {}),
  });
}
export function timingSnapshot(timing: UseTiming): TimingSnapshot {
  switch (timing.kind) {
    case 'play':
      return immutable({ kind: 'play', owner: timing.owner, phase: timing.phase.id });
    case 'rescue':
      return immutable(timing);
    case 'effect':
      return immutable(timing);
    case 'counter':
      return immutable({
        kind: 'counter',
        depth: timing.opportunity.depth,
        opportunity: timing.opportunity.lifetime.id,
        names: timing.opportunity.names,
        subject: timing.opportunity.subject,
        root: timing.opportunity.root,
      });
    case 'response':
      return immutable({
        kind: 'response',
        opportunity: timing.opportunity.lifetime.id,
        to: timing.opportunity.to,
      });
  }
}
/** 校验配方后直接使用声明本身；省略的材料维度在执行侧按空处理。 */
export function viewAs(definition: ViewAs): ViewAs {
  const { id, materials, count, names, make } = definition;
  if (!id) throw new Error('View-as recipe requires an ID.');
  if ((materials === undefined) !== (count === undefined))
    throw new Error(`[${id}] View-as materials and count must be provided together.`);
  if (count !== undefined && typeof count !== 'function')
    normalizeChoiceCount(count, `${id} material`);
  if (typeof make === 'function') {
    if (typeof names !== 'function') throw new Error(`[${id}] Dynamic view-as requires names.`);
  } else {
    if (!make || typeof make.name !== 'string' || !make.name)
      throw new Error(`[${id}] Fixed view-as requires a card face.`);
    if (names !== undefined)
      throw new Error(`[${id}] Fixed view-as derives names from its card face.`);
  }
  return definition;
}
