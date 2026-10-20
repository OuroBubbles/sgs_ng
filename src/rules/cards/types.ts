import type { Card, WorldReader } from '../../core/model/state';
import type { Validation } from '../../core/decisions/hub';
import type { ChoiceCount } from '../../core/decisions/selection';
import type { Context, FlowResult } from '../../core/runtime/room';
import type { Lifetime } from '../scopes/lifetime';
import type { SkillHandle } from '../skills/skills';
import type { CardBook, UseResult } from './book';
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

export interface ViewAs {
  readonly id: string;
  readonly label: string;
  readonly names: (ctx: Context, self: SkillHandle) => readonly string[];
  readonly materials: (ctx: Context, self: SkillHandle, book: CardBook) => readonly string[];
  readonly count: ChoiceCount | ((ctx: Context, self: SkillHandle) => ChoiceCount);
  readonly available?: (ctx: Context, self: SkillHandle, purpose: Purpose) => boolean;
  readonly make: (
    ctx: Context,
    self: SkillHandle,
    materials: readonly string[],
    parameters: unknown,
  ) => CardFace | null;
  /** 选定目标并通过初次校验后，可用普通异步代码取得实际用牌，再返回完整用牌结果。 */
  readonly use?: (
    ctx: Context,
    self: SkillHandle,
    intent: UseIntent,
    book: CardBook,
  ) => Promise<FlowResult<UseResult>>;
}

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
export interface UseIntent {
  readonly actor: string;
  readonly choice: CardChoice;
  readonly targets: readonly string[];
  readonly timing: UseTiming;
  /** 规则调用者可预填附属选择；牌定义必须验证，普通玩家输入不直接透传。 */
  readonly parameters?: unknown;
  /** 本次用牌明确禁止的反制牌名，不改变整种牌的定义。 */
  readonly prohibitedCounters?: readonly string[];
}
export interface UseRequest {
  readonly actor: string;
  readonly card: SemanticCard;
  readonly targets: readonly string[];
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
export interface UseRules {
  readonly count: ChoiceCount;
  /** 省略时接受所有规则用途；提供时也约束候选菜单，不把仅可响应的牌列入出牌阶段。 */
  readonly timings?: readonly UseTiming['kind'][];
  readonly usage?: { readonly key: string; readonly max: number };
  readonly canUse?: (ctx: Context, request: UseRequest, book: CardBook) => string | null;
  readonly target: (ctx: Context, request: UseRequest, target: string, book: CardBook) => boolean;
  /** 宣告前的附属选择：返回已验证的普通参数；统一管线再做最终校验；取消不支付、不开放用牌窗口。 */
  readonly prepare?: (
    ctx: Context,
    request: UseRequest,
    book: CardBook,
  ) => Validation<unknown> | Promise<Validation<unknown>>;
  /** 自动目标在宣告前计算并冻结，玩家不再手工指定；禁止目标由统一管线过滤。 */
  readonly fixedTargets?: (
    ctx: Context,
    actor: string,
    card: SemanticCard,
    book: CardBook,
  ) => readonly string[];
  readonly canResolve?: (ctx: Context, effect: CardEffect, book: CardBook) => boolean;
  readonly resolve?: (ctx: Context, effect: CardEffect, book: CardBook) => void | Promise<void>;
  /** 整张牌的普通控制流，可用处理区包住全部目标；有目标时必须明确调用一次 resolveTargets。 */
  readonly execute?: (
    ctx: Context,
    use: UsePlanView,
    book: CardBook,
    resolveTargets: ResolveTargets,
  ) => unknown;
}
export type TargetResolver = (
  ctx: Context,
  effect: CardEffect,
  book: CardBook,
) => void | Promise<void>;
export type ResolveTargets = (at: Context, resolve?: TargetResolver) => Promise<void>;
export interface CardDefinition {
  readonly id: string;
  readonly type: 'basic' | 'trick' | 'equipment';
  readonly label: string;
  readonly nature?: Nature;
  readonly response?: boolean;
  readonly counterable?: boolean;
  readonly equipment?: EquipmentDefinition;
  readonly delayed?: DelayedRules;
  readonly use?: UseRules;
}
export interface CardPolicy {
  readonly distance: (ctx: Context, from: string, to: string, base: number) => number;
  readonly handLimit: (ctx: Context, actor: string, base: number) => number;
  readonly attackRange: (ctx: Context, actor: string, card: SemanticCard) => number;
  readonly prohibitUse: (ctx: Context, actor: string, card: SemanticCard) => boolean;
  readonly prohibitResponse: (ctx: Context, actor: string, card: SemanticCard) => boolean;
  readonly prohibitTarget: (
    ctx: Context,
    actor: string,
    target: string,
    card: SemanticCard,
  ) => boolean;
  readonly usage: (ctx: Context, request: UseRequest, base: number) => number | null;
  readonly responseTimes: (
    ctx: Context,
    effect: EffectRef,
    responder: string,
    name: string,
  ) => number;
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
export function viewAs(definition: ViewAs): ViewAs {
  if (!definition.id) throw new Error('View-as recipe requires an ID.');
  return Object.freeze({
    ...definition,
    count:
      typeof definition.count === 'function'
        ? definition.count
        : Object.freeze({ ...definition.count }),
  });
}
