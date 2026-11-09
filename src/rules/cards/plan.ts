import type { Change, WorldReader } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { assertLifetime } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';
import { defineMark } from '../state/mark';
import type {
  CardEffect,
  EffectSnapshot,
  SemanticCard,
  UseTarget,
  TargetOptions,
  TargetStage,
  UseSnapshot,
  UseTiming,
} from './types';
import { primaryOf, targetStages, timingSnapshot } from './types';
import { CardEvent } from './move';

interface DeclaredEffect {
  readonly effectId: string;
  readonly target: string;
  readonly tuple?: readonly string[];
  readonly cancelled: string | null;
  readonly ignoredEquipment: EffectSnapshot['ignoredEquipment'];
  readonly responseRequirements: NonNullable<EffectSnapshot['responseRequirements']>;
  readonly responseBlocks: NonNullable<EffectSnapshot['responseBlocks']>;
}
/** 宣告是 World 数据；执行游标属于当前协程，不伪装成可恢复的续体。 */
export interface UseDeclaration {
  readonly id: string;
  readonly actor: string;
  readonly actionOrder: readonly string[];
  readonly effects: readonly DeclaredEffect[];
  readonly edits: UseSnapshot['edits'];
  readonly ignoredEquipment: EffectSnapshot['ignoredEquipment'];
}
const declarationKey = defineMark<UseDeclaration | null>('card:use-declaration', null);
export function useDeclarations(world: WorldReader): readonly UseDeclaration[] {
  return world.snapshot.states
    .filter((entry) => entry.key === declarationKey.id && entry.value)
    .map((entry) => entry.value as UseDeclaration);
}
class TargetEffect implements CardEffect {
  #state: EffectSnapshot['state'] = 'pending';
  #targetStep = 0;
  #reason: string | null = null;
  constructor(
    private readonly plan: UsePlan,
    readonly effectId: string,
  ) {}
  get useId() {
    return this.plan.id;
  }
  get actor() {
    return this.plan.actor;
  }
  get card() {
    return this.plan.card;
  }
  get processing() {
    return this.plan.processing;
  }
  get prohibitedCounters() {
    return this.plan.prohibitedCounters;
  }
  get responseBlocks() {
    return this.plan.declaredEffect(this.effectId).responseBlocks;
  }
  get target() {
    return this.plan.declaredEffect(this.effectId).target;
  }
  get tuple() {
    const declared = this.plan.declaredEffect(this.effectId);
    return declared.tuple ?? [declared.target];
  }
  get state(): EffectSnapshot['state'] {
    return this.plan.declaredEffect(this.effectId).cancelled !== null ? 'cancelled' : this.#state;
  }
  get ignoredEquipment() {
    return this.plan.declaredEffect(this.effectId).ignoredEquipment;
  }
  get responseRequirements() {
    return this.plan.declaredEffect(this.effectId).responseRequirements;
  }
  ignoreEquipment(ctx: Context, slot: string, reason: string): void {
    if (!slot || !reason) throw new Error('Equipment rule requires a slot and reason.');
    this.plan.editEffect(ctx, this.effectId, (entry) => ({
      ...entry,
      ignoredEquipment: entry.ignoredEquipment.some((item) => item.slot === slot)
        ? entry.ignoredEquipment
        : [...entry.ignoredEquipment, { slot, reason }],
    }));
  }
  requireResponses(ctx: Context, actor: string, minimum: number, reason: string): void {
    ctx.world.player(actor);
    if (!Number.isSafeInteger(minimum) || minimum < 1 || !reason)
      throw new Error('Invalid response requirement.');
    this.plan.editEffect(ctx, this.effectId, (entry) => ({
      ...entry,
      responseRequirements: [...entry.responseRequirements, { actor, minimum, reason }],
    }));
  }
  blockResponses(
    ctx: Context,
    actor: string,
    reason: string,
    names: readonly string[] | null = null,
  ): void {
    ctx.world.player(actor);
    if (!reason) throw new Error('Response block requires a reason.');
    if (
      names !== null &&
      (!Array.isArray(names) ||
        !names.length ||
        names.some((name) => typeof name !== 'string' || !name.trim()) ||
        new Set(names).size !== names.length)
    )
      throw new Error(
        'Response block requires distinct nonempty card names, or null for all responses.',
      );
    this.plan.editEffect(ctx, this.effectId, (entry) => ({
      ...entry,
      responseBlocks: [...entry.responseBlocks, { actor, names, reason }],
    }));
  }
  cancelled(): boolean {
    return this.state === 'cancelled';
  }
  get targetStep(): number {
    return this.#targetStep;
  }
  get targetStage(): TargetStage | null {
    return targetStages[this.#targetStep - 1] ?? null;
  }
  cancel(ctx: Context, reason: string): void {
    this.plan.assertMutable(ctx);
    if (this.cancelled()) return;
    if (!reason) throw new Error('Cancellation requires a reason.');
    this.plan.editEffect(ctx, this.effectId, (entry) => ({ ...entry, cancelled: reason }));
  }
  begin(): void {
    if (this.state !== 'pending') throw new Error('Target sequence has already started.');
    this.#state = 'targeting';
  }
  enterTargetStage(stage: TargetStage): void {
    if (this.state !== 'targeting' || targetStages[this.#targetStep] !== stage)
      throw new Error('Target stages must run once in order.');
    this.#targetStep++;
  }
  prepare(): void {
    if (
      !(
        (this.state === 'targeting' && this.#targetStep === targetStages.length) ||
        (this.state === 'pending' && this.plan.stage === 'delayed')
      )
    )
      throw new Error('Target sequence has not finished.');
    this.#state = 'ready';
  }
  start(): void {
    if (this.state !== 'ready') throw new Error('Effect must be ready before resolving.');
    this.#state = 'resolving';
  }
  finish(state: 'resolved' | 'skipped' | 'aborted', reason: string | null = null): void {
    this.#state = state;
    this.#reason = reason;
  }
  snapshot(): EffectSnapshot {
    return immutable({
      useId: this.useId,
      effectId: this.effectId,
      actor: this.actor,
      target: this.target,
      ...(this.plan.declaredEffect(this.effectId).tuple ? { tuple: this.tuple } : {}),
      card: this.card,
      processing: this.processing,
      state: this.state,
      targetStage: this.targetStage,
      reason: this.plan.declaredEffect(this.effectId).cancelled ?? this.#reason,
      ignoredEquipment: this.ignoredEquipment,
      ...(this.prohibitedCounters.length ? { prohibitedCounters: this.prohibitedCounters } : {}),
      ...(this.responseBlocks.length ? { responseBlocks: this.responseBlocks } : {}),
      ...(this.responseRequirements.length
        ? { responseRequirements: this.responseRequirements }
        : {}),
    });
  }
}
export interface UsePlanInit {
  readonly id: string;
  readonly actor: string;
  readonly card: SemanticCard;
  readonly processing: string;
  readonly timing: UseTiming;
  readonly targets: readonly UseTarget[];
  readonly ctx: Context;
  readonly lifetime: Lifetime;
  /** 追加/转移目标的合法性；原目标的合法性已由用牌验证。 */
  readonly accepts: (ctx: Context, target: UseTarget, options?: TargetOptions) => boolean;
  readonly stage?: 'use' | 'delayed';
  readonly effectPrefix?: string;
  readonly parameters?: unknown;
  readonly prohibitedCounters?: readonly string[];
}
/** 内容与窗口看到的用牌宣告：只读字段与目标改写方法。 */
export type UsePlanView = Pick<
  UsePlan,
  | 'id'
  | 'actor'
  | 'actionOrder'
  | 'card'
  | 'processing'
  | 'timing'
  | 'stage'
  | 'parameters'
  | 'prohibitedCounters'
  | 'targets'
  | 'effects'
  | 'addTarget'
  | 'repeatTarget'
  | 'removeTarget'
  | 'canReplaceTarget'
  | 'replaceTargetChange'
  | 'replaceTarget'
  | 'ignoreEquipment'
  | 'snapshot'
>;
/** 宣告改写通过 Change 提交，能与费用合并；封口效果不能改写。 */
export class UsePlan {
  #handles = new Map<string, TargetEffect>();
  #visited = new Set<string>();
  #open = true;
  #outcome: unknown = null;
  #retained: UseDeclaration;
  readonly id: string;
  readonly actor: string;
  readonly card: SemanticCard;
  readonly processing: string;
  readonly timing: UseTiming;
  readonly stage: 'use' | 'delayed';
  readonly parameters: unknown;
  readonly prohibitedCounters: readonly string[];
  private readonly ctx: Context;
  private readonly lifetime: Lifetime;
  private readonly acceptsTarget: UsePlanInit['accepts'];
  private readonly effectPrefix: string;
  constructor(init: UsePlanInit) {
    const { id, actor, targets, ctx } = init;
    const effectPrefix = init.effectPrefix ?? id;
    this.id = id;
    this.actor = actor;
    this.card = init.card;
    this.processing = init.processing;
    this.timing = init.timing;
    this.stage = init.stage ?? 'use';
    this.parameters = init.parameters ?? null;
    this.prohibitedCounters = init.prohibitedCounters ?? [];
    this.ctx = ctx;
    this.lifetime = init.lifetime;
    this.acceptsTarget = init.accepts;
    this.effectPrefix = effectPrefix;
    const actionOrder = ctx.actionOrder(actor);
    const orderedTargets = [...targets].sort(
      (a, b) => actionOrder.indexOf(primaryOf(a)) - actionOrder.indexOf(primaryOf(b)),
    );
    this.#retained = immutable({
      id,
      actor,
      actionOrder,
      effects: orderedTargets.map((target, i) => ({
        effectId: `${effectPrefix}:effect:${i + 1}`,
        target: primaryOf(target),
        ...(typeof target === 'string' ? {} : { tuple: target }),
        cancelled: null,
        ignoredEquipment: [],
        responseRequirements: [],
        responseBlocks: [],
      })),
      edits: [],
      ignoredEquipment: [],
    });
    ctx.defer(() => {
      this.#retained = this.#declaration();
      this.#open = false;
    });
  }
  #slot() {
    return { source: this.id, lifetime: this.lifetime };
  }
  #declaration(): UseDeclaration {
    return declarationKey.of(this.ctx.world, this.actor, this.#slot()) ?? this.#retained;
  }
  initializeChange(ctx: Context): Change {
    this.assertMutable(ctx);
    return declarationKey.change(ctx, this.actor, this.#retained, this.#slot());
  }
  declaredEffect(id: string): DeclaredEffect {
    const entry = this.#declaration().effects.find((effect) => effect.effectId === id);
    if (!entry) throw new Error('Unknown target effect.');
    return entry;
  }
  #handle(id: string): TargetEffect {
    let handle = this.#handles.get(id);
    if (!handle) {
      handle = new TargetEffect(this, id);
      this.#handles.set(id, handle);
    }
    return handle;
  }
  get effects(): readonly EffectSnapshot[] {
    return this.#declaration().effects.map((effect) => this.#handle(effect.effectId).snapshot());
  }
  get actionOrder(): readonly string[] {
    return this.#declaration().actionOrder;
  }
  /** 防具/无懈取消效果不移除宣告目标；只有 remove/replace 编辑释放其身份。 */
  get targets(): readonly string[] {
    const state = this.#declaration();
    const removed = new Set(
      state.edits.flatMap((edit) =>
        edit.kind === 'remove'
          ? [edit.effectId]
          : edit.kind === 'replace'
            ? [edit.fromEffectId]
            : [],
      ),
    );
    return immutable(
      state.effects
        .filter((effect) => !removed.has(effect.effectId))
        .map((effect) => effect.target),
    );
  }
  assertMutable(ctx: Context): void {
    assertLifetime(ctx, this.lifetime);
    if (!this.#open || ctx.world !== this.ctx.world) throw new Error('Use plan is sealed.');
  }
  #unsealed(id: string): boolean {
    return ['pending', 'targeting', 'ready'].includes(this.#handle(id).state);
  }
  #commit(ctx: Context, value: UseDeclaration): void {
    this.assertMutable(ctx);
    ctx.commit(
      CardEvent.planChanged,
      [declarationKey.change(ctx, this.actor, value, this.#slot())],
      { useId: this.id },
    );
  }
  editEffect(ctx: Context, id: string, edit: (entry: DeclaredEffect) => DeclaredEffect): void {
    this.assertMutable(ctx);
    if (!this.#unsealed(id)) throw new Error('UseTarget effect is sealed.');
    const state = this.#declaration();
    this.#commit(ctx, {
      ...state,
      effects: state.effects.map((entry) => (entry.effectId === id ? edit(entry) : entry)),
    });
  }
  ignoreEquipment(ctx: Context, slot: string, reason: string): void {
    this.assertMutable(ctx);
    if (!slot || !reason) throw new Error('Equipment rule requires a slot and reason.');
    const state = this.#declaration();
    const extend = (entries: DeclaredEffect['ignoredEquipment']) =>
      entries.some((entry) => entry.slot === slot) ? entries : [...entries, { slot, reason }];
    this.#commit(ctx, {
      ...state,
      ignoredEquipment: extend(state.ignoredEquipment),
      effects: state.effects.map((entry) =>
        this.#unsealed(entry.effectId)
          ? { ...entry, ignoredEquipment: extend(entry.ignoredEquipment) }
          : entry,
      ),
    });
  }
  /** 只给角色时沿用 from 的元组尾部（借刀转移持械者仍对原杀目标）。 */
  #complete(target: UseTarget, from: DeclaredEffect | undefined): UseTarget {
    return typeof target === 'string' && from?.tuple ? [target, ...from.tuple.slice(1)] : target;
  }
  #canTarget(ctx: Context, target: UseTarget, repeat: boolean, options?: TargetOptions): boolean {
    return (
      this.#open &&
      this.lifetime.active &&
      this.lifetime.belongsTo(ctx.world) &&
      ctx.cause.scopePath.includes(this.lifetime.id) &&
      ctx.query(() => this.acceptsTarget(ctx, target, options)) &&
      (repeat || !this.targets.includes(primaryOf(target)))
    );
  }
  /** 元组牌：替换只给角色时保留原元组的后续位置；重复只给角色时复用该目标最近的元组。 */
  addTarget(ctx: Context, target: UseTarget, reason: string): string {
    return this.#add(ctx, target, reason, false);
  }
  repeatTarget(ctx: Context, target: UseTarget, reason: string): string {
    const from = [...this.#declaration().effects]
      .reverse()
      .find((entry) => entry.target === target);
    return this.#add(ctx, this.#complete(target, from), reason, true);
  }
  #newEffect(state: UseDeclaration, target: UseTarget): DeclaredEffect {
    return {
      effectId: `${this.effectPrefix}:effect:${state.effects.length + 1}`,
      target: primaryOf(target),
      ...(typeof target === 'string' ? {} : { tuple: target }),
      cancelled: null,
      ignoredEquipment: state.ignoredEquipment,
      responseRequirements: [],
      responseBlocks: [],
    };
  }
  #add(ctx: Context, target: UseTarget, reason: string, repeat: boolean): string {
    this.assertMutable(ctx);
    if (!reason || !this.#canTarget(ctx, target, repeat))
      throw new Error('Invalid added target; repeat it explicitly for a duplicate.');
    const state = this.#declaration();
    const effect = this.#newEffect(state, target);
    this.#commit(ctx, {
      ...state,
      effects: [...state.effects, effect],
      edits: [
        ...state.edits,
        {
          kind: repeat ? 'repeat' : 'add',
          effectId: effect.effectId,
          target: effect.target,
          reason,
          fromEffectId: null,
        },
      ],
    });
    return effect.effectId;
  }
  removeTarget(ctx: Context, id: string, reason: string): void {
    this.assertMutable(ctx);
    const previous = this.declaredEffect(id);
    if (previous.cancelled !== null) return;
    if (!reason || !this.#unsealed(id)) throw new Error('Cannot remove a closed target effect.');
    const state = this.#declaration();
    this.#commit(ctx, {
      ...state,
      effects: state.effects.map((entry) =>
        entry.effectId === id ? { ...entry, cancelled: reason } : entry,
      ),
      edits: [
        ...state.edits,
        { kind: 'remove', effectId: id, target: previous.target, reason, fromEffectId: null },
      ],
    });
  }
  canReplaceTarget(ctx: Context, id: string, target: UseTarget, options?: TargetOptions): boolean {
    const from = this.#declaration().effects.find((entry) => entry.effectId === id);
    return (
      from !== undefined &&
      this.#unsealed(id) &&
      this.#canTarget(ctx, this.#complete(target, from), false, options)
    );
  }
  /** 构造此刻的改写；与费用合并时须在 pay.legal 重查选择，不跨 await 缓存 Change。 */
  replaceTargetChange(
    ctx: Context,
    id: string,
    target: UseTarget,
    reason: string,
    options?: TargetOptions,
  ): Change {
    this.assertMutable(ctx);
    if (!reason || !this.canReplaceTarget(ctx, id, target, options))
      throw new Error('Invalid replacement target.');
    const state = this.#declaration();
    const effect = this.#newEffect(state, this.#complete(target, this.declaredEffect(id)));
    return declarationKey.change(
      ctx,
      this.actor,
      {
        ...state,
        effects: [
          ...state.effects.map((entry) =>
            entry.effectId === id ? { ...entry, cancelled: reason } : entry,
          ),
          effect,
        ],
        edits: [
          ...state.edits,
          {
            kind: 'replace',
            effectId: effect.effectId,
            target: effect.target,
            reason,
            fromEffectId: id,
          },
        ],
      },
      this.#slot(),
    );
  }
  replaceTarget(
    ctx: Context,
    id: string,
    target: UseTarget,
    reason: string,
    options?: TargetOptions,
  ): string {
    const change = this.replaceTargetChange(ctx, id, target, reason, options);
    ctx.commit(CardEvent.targetReplaced, [change], {
      useId: this.id,
      fromEffectId: id,
      target: primaryOf(target),
      reason,
    });
    return this.#declaration().effects.at(-1)!.effectId;
  }
  /** 按宣告时固定的模式行动序选择未访问身份；嵌套回合不会重排外层牌。 */
  #ordered(): readonly TargetEffect[] {
    const rank = (target: string) => this.actionOrder.indexOf(target);
    return this.#declaration()
      .effects.map((entry) => this.#handle(entry.effectId))
      .sort((a, b) => rank(a.target) - rank(b.target));
  }
  /** 新身份从最早缺失的时点补齐，已进入过的时点不重复派发。 */
  nextTarget(): { readonly effect: TargetEffect; readonly stage: TargetStage } | undefined {
    const effects = this.#ordered();
    for (let step = 0; step < targetStages.length; step++) {
      const effect = effects.find(
        (item) =>
          (item.state === 'pending' || item.state === 'targeting') && item.targetStep === step,
      );
      if (effect) return { effect, stage: targetStages[step]! };
    }
    return undefined;
  }
  next(): TargetEffect | undefined {
    const entry = this.#ordered().find((item) => !this.#visited.has(item.effectId));
    if (!entry) return;
    this.#visited.add(entry.effectId);
    return this.#handle(entry.effectId);
  }
  close(outcome: unknown = null): UseSnapshot {
    this.#retained = this.#declaration();
    this.#open = false;
    this.#outcome = immutable(outcome);
    return this.snapshot();
  }
  snapshot(): UseSnapshot {
    return immutable({
      id: this.id,
      actor: this.actor,
      actionOrder: this.actionOrder,
      card: this.card,
      processing: this.processing,
      timing: timingSnapshot(this.timing),
      stage: this.stage,
      outcome: this.#outcome,
      ...(this.parameters === null ? {} : { parameters: this.parameters }),
      ...(this.prohibitedCounters.length ? { prohibitedCounters: this.prohibitedCounters } : {}),
      effects: this.effects,
      edits: this.#declaration().edits,
    });
  }
}
