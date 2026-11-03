import type { Decision, Validation } from '../../core/decisions/hub';
import { normalizeChoiceCount } from '../../core/decisions/count';
import type { ChoiceCount } from '../../core/decisions/count';
import { immutable, isStringArray } from '../../core/model/value';
import { syncQueryValue } from '../../core/runtime/query';
import type { Context } from '../../core/runtime/room';
import { pay, used } from '../costs/pay';
import type { UsageLimit } from '../costs/pay';
import type { SkillBook, SkillHandle } from '../skills/skills';
import { defineSkill } from '../skills/skills';
import { equipmentAbilities } from './equipment';
import * as queries from './queries';
import { discardSubject } from './discard';
import type { DiscardRequest } from './discard';
import { withProcessing } from './processing';
import { UsePlan } from './plan';
import { withLifetime } from '../scopes/lifetime';
import type { UsePlanView } from './plan';
import type {
  CardChoice,
  CardDefinition,
  CardUseRef,
  CardEffect,
  CardFace,
  CardPolicy,
  EffectRef,
  EffectSnapshot,
  Purpose,
  SemanticCard,
  UseIntent,
  UseRequest,
  UseSnapshot,
  UseTiming,
  UseRules,
  TargetResolver,
  ViewAs,
  ViewAsInput,
  viewAs,
} from './types';
import { ownedCards, timingSnapshot, colorOfSuit, isResponseBlocked } from './types';
import { physicalCardFace } from './face';
import type { PhysicalCardFace } from './face';
import { isGameOver } from '../game/end';
import { requestResponse, Response } from './response';
import type { ResponseIntent, ResponseResult, ResponseConsumer } from './response';
import { defineEvent, timing } from '../../core/runtime/event';

export type { ResponseResult } from './response';

export interface CardOffer {
  /** 来源定义供表现层归组；不参与提交身份与合法性判定。 */
  readonly skill?: string;
  readonly description?: string;
  readonly id: string;
  readonly kind: 'physical' | 'viewAs';
  readonly label: string;
  readonly names: readonly string[];
  readonly materials: readonly string[];
  readonly count: ChoiceCount;
  readonly choice:
    | { readonly card: string }
    | { readonly instance: string; readonly recipe: string };
}
export interface UseFeedback {
  readonly model: 'use';
  readonly complete: boolean;
  readonly reason: string;
  readonly targetCount: ChoiceCount;
  readonly fixedTargets: readonly string[];
  readonly targets: readonly {
    readonly id: string;
    readonly selected: boolean;
    readonly selectable: boolean;
  }[];
}
export type UseResult =
  | { readonly kind: 'used'; readonly use: UseSnapshot }
  | { readonly kind: 'unavailable'; readonly reason: string };
export interface UseOfferRequest {
  readonly actor: string;
  readonly names: readonly string[];
  readonly targets: readonly string[];
  readonly timing: UseTiming;
  readonly prompt: string;
  readonly available?: (ctx: Context) => boolean;
}
export type AskedUseResult = UseResult | { readonly kind: 'declined' };
export const Use = defineEvent('use', {
  declared: timing<UsePlanView>(),
  targets: timing<UsePlanView>(),
  finished: timing<UseSnapshot>(),
});
export const Target = defineEvent('target', {
  specifying: timing<{
    readonly use: UsePlanView;
    readonly effect: CardEffect;
  }>(),
  specified: timing<{
    readonly use: UsePlanView;
    readonly effect: CardEffect;
  }>(),
  confirming: timing<{
    readonly use: UsePlanView;
    readonly effect: CardEffect;
  }>(),
  confirmed: timing<{
    readonly use: UsePlanView;
    readonly effect: CardEffect;
  }>(),
});
export const Resolve = defineEvent('resolve', {
  starting: timing<{
    readonly use: UsePlanView;
    readonly effect: CardEffect;
    /** 本次实际结算的纯资格；嵌套机会复用它，不按牌名重建 canResolve。 */
    readonly available: (ctx: Context) => boolean;
  }>('main', 'counter', 'after'),
  finished: timing<{
    readonly use: UsePlanView;
    readonly effect: EffectSnapshot;
  }>(),
});

function invalid(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}
function countValid(count: ChoiceCount, selected: number, total: number): boolean {
  return selected >= count.min && selected <= (count.max === 'all' ? total : count.max);
}

/** 回复只允许玩家可提供的实体牌/配方，不能伪造 generated 规则指令。 */
export function parseCardChoice(input: unknown): Validation<CardChoice> {
  if (!input || typeof input !== 'object' || !('kind' in input))
    return invalid('Expected a card choice.');
  if (input.kind === 'physical' && 'card' in input && typeof input.card === 'string')
    return { ok: true, value: { kind: 'physical', card: input.card } };
  if (
    input.kind !== 'viewAs' ||
    !('instance' in input) ||
    typeof input.instance !== 'string' ||
    !('recipe' in input) ||
    typeof input.recipe !== 'string' ||
    !('materials' in input) ||
    !isStringArray(input.materials)
  )
    return invalid('Invalid card recipe choice.');
  try {
    return {
      ok: true,
      value: immutable({
        kind: 'viewAs',
        instance: input.instance,
        recipe: input.recipe,
        materials: input.materials,
        parameters: 'parameters' in input ? (input.parameters ?? null) : null,
      }),
    };
  } catch {
    return invalid('Parameters must be plain data.');
  }
}

const defaults: CardPolicy = {
  distance: (_ctx, _from, _to, base) => base,
  handLimit: (_ctx, _actor, base) => base,
  attackRange: () => 1,
  prohibitUse: () => false,
  prohibitResponse: () => false,
  prohibitTarget: () => false,
  usage: (_ctx, _request, base) => base,
  responseTimes: () => 1,
};

function fixedUse(rules: UseRules, id: string): UseRules {
  const {
    count: declaredCount,
    timings,
    usage,
    canUse,
    target,
    selection,
    prepare,
    fixedTargets,
    canResolve,
    resolve,
    execute,
  } = rules;
  if (!resolve && !execute) throw new Error('A usable card requires resolve or execute.');
  const count = normalizeChoiceCount(declaredCount, `${id} target`);
  return Object.freeze({
    count,
    target: target.bind(rules),
    ...(timings === undefined ? {} : { timings: Object.freeze([...timings]) }),
    ...(usage === undefined ? {} : { usage: Object.freeze({ key: usage.key, max: usage.max }) }),
    ...(canUse === undefined ? {} : { canUse: canUse.bind(rules) }),
    ...(selection === undefined ? {} : { selection: selection.bind(rules) }),
    ...(prepare === undefined ? {} : { prepare: prepare.bind(rules) }),
    ...(fixedTargets === undefined ? {} : { fixedTargets: fixedTargets.bind(rules) }),
    ...(canResolve === undefined ? {} : { canResolve: canResolve.bind(rules) }),
    ...(resolve === undefined ? {} : { resolve: resolve.bind(rules) }),
    ...(execute === undefined ? {} : { execute: execute.bind(rules) }),
  });
}

const definedCards = new WeakSet<CardDefinition>();

/** 隔离可变声明并固定方法入口；原接收者保留，已完成的规范化直接复用。 */
export function defineCard(definition: CardDefinition): CardDefinition {
  if (definedCards.has(definition)) return definition;
  const { id, label, type, nature, response, counterable, delayed, equipment, use } = definition;
  if (!id) throw new Error('Duplicate or empty card definition.');
  if (!['basic', 'trick', 'equipment'].includes(type))
    throw new Error('Card definition requires an explicit type.');
  if (nature !== undefined && (typeof nature !== 'string' || !nature.trim()))
    throw new Error('Card nature must be a nonempty string.');
  let fixedDelayed: CardDefinition['delayed'];
  if (delayed !== undefined) {
    const { resolve, cancelled } = delayed;
    fixedDelayed = Object.freeze({
      resolve: resolve.bind(delayed),
      ...(cancelled === undefined ? {} : { cancelled: cancelled.bind(delayed) }),
    });
  }
  let fixedEquipment: CardDefinition['equipment'];
  if (equipment !== undefined) {
    const { slot, range, skill } = equipment;
    fixedEquipment = Object.freeze({
      slot,
      ...(range === undefined ? {} : { range }),
      ...(skill === undefined ? {} : { skill: defineSkill(skill) }),
    });
  }
  const fixed = Object.freeze({
    id,
    label,
    type,
    ...(nature === undefined ? {} : { nature }),
    ...(response === undefined ? {} : { response }),
    ...(counterable === undefined ? {} : { counterable }),
    ...(fixedDelayed === undefined ? {} : { delayed: fixedDelayed }),
    ...(fixedEquipment === undefined ? {} : { equipment: fixedEquipment }),
    ...(use === undefined ? {} : { use: fixedUse(use, id) }),
  });
  definedCards.add(fixed);
  return fixed;
}

/** 固定牌定义与统一动作管线。牌与技能的自由代码只依赖公开的语义操作。 */
export class CardBook {
  /** 独立效果属于每局规则目录，不借用角色的技能授予或当前技能资格。 */
  get effects() {
    return this.skills.effects;
  }
  #definitions: ReadonlyMap<string, CardDefinition>;
  #faceQueries = new WeakMap<Context['world'], Set<string>>();
  readonly policy: CardPolicy;
  constructor(
    definitions: readonly CardDefinition[],
    readonly skills: SkillBook,
    policy: Partial<CardPolicy> = {},
  ) {
    const prepared = definitions.map(defineCard);
    if (
      prepared.some((definition) => !definition.id) ||
      new Set(prepared.map((definition) => definition.id)).size !== prepared.length
    )
      throw new Error('Duplicate or empty card definition.');
    this.#definitions = new Map(prepared.map((definition) => [definition.id, definition]));
    // 逐项读取也支持原型方法；固定入口而保留原接收者，不缓存查询结果。
    this.policy = Object.freeze({
      distance: policy.distance?.bind(policy) ?? defaults.distance,
      handLimit: policy.handLimit?.bind(policy) ?? defaults.handLimit,
      attackRange: policy.attackRange?.bind(policy) ?? defaults.attackRange,
      prohibitUse: policy.prohibitUse?.bind(policy) ?? defaults.prohibitUse,
      prohibitResponse: policy.prohibitResponse?.bind(policy) ?? defaults.prohibitResponse,
      prohibitTarget: policy.prohibitTarget?.bind(policy) ?? defaults.prohibitTarget,
      usage: policy.usage?.bind(policy) ?? defaults.usage,
      responseTimes: policy.responseTimes?.bind(policy) ?? defaults.responseTimes,
    });
    this.skills.cards = this;
    this.skills.addProvider(equipmentAbilities([...this.#definitions.values()]));
  }

  definition(id: string): CardDefinition {
    const definition = this.#definitions.get(id);
    if (!definition) throw new Error(`Unknown card definition: ${id}`);
    return definition;
  }

  build(
    ctx: Context,
    actor: string,
    choice: CardChoice,
    purpose: Purpose,
  ): Validation<SemanticCard> {
    return ctx.query(() => this.#build(ctx, actor, choice, purpose));
  }

  /** 当前实体牌面；判定显式指定被判定者，不借用改判供牌者的过滤。 */
  face(ctx: Context, id: string, judgmentPlayer?: string): PhysicalCardFace {
    const key = JSON.stringify([id, judgmentPlayer ?? null]);
    const active = this.#faceQueries.get(ctx.world) ?? new Set<string>();
    if (active.has(key)) throw new Error('Recursive card face query; read the printed input card.');
    this.#faceQueries.set(ctx.world, active);
    active.add(key);
    try {
      return physicalCardFace(ctx, this.skills, id, judgmentPlayer);
    } finally {
      active.delete(key);
      if (!active.size) this.#faceQueries.delete(ctx.world);
    }
  }

  /** 实体牌的语义牌面，不附带用牌/响应牌型资格，也不虚构持有权。 */
  physicalCard(ctx: Context, id: string): SemanticCard {
    return ctx.query(() => {
      const card = this.face(ctx, id);
      return immutable({
        name: card.name,
        suit: card.suit,
        rank: card.rank,
        color: card.color,
        nature: this.#definitions.get(card.name)?.nature ?? 'normal',
        materials: [id],
        source: null,
      });
    });
  }

  /** 打出禁令与“这张牌是否定义了闪/杀等普通响应”分开，供改判等规则复用。 */
  isResponseProhibited(ctx: Context, actor: string, card: SemanticCard): boolean {
    return ctx.query(() => {
      ctx.world.player(actor);
      return this.skills.query(
        ctx,
        queries.prohibitResponse,
        { actor, card },
        this.policy.prohibitResponse(ctx, actor, card),
      );
    });
  }

  offers(
    ctx: Context,
    actor: string,
    purpose: Purpose | UseTiming,
    names?: readonly string[],
  ): readonly CardOffer[] {
    return ctx.query(() => immutable([...this.#offerCandidates(ctx, actor, purpose, names)]));
  }

  /** 只判断候选存在性；纯同步过滤可收窄候选，实际材料和目标仍须最终验证。 */
  hasOffers(
    ctx: Context,
    actor: string,
    purpose: Purpose | UseTiming,
    names?: readonly string[],
    accepts?: (offer: CardOffer) => boolean,
  ): boolean {
    return ctx.query(() => {
      for (const offer of this.#offerCandidates(ctx, actor, purpose, names))
        if (!accepts || syncQueryValue(accepts(immutable(offer)), 'card.offer.filter')) return true;
      return false;
    });
  }

  // 两个公开入口均在 query 内消费迭代器，不让规则回调逃出纯查询边界。
  *#offerCandidates(
    ctx: Context,
    actor: string,
    purpose: Purpose | UseTiming,
    names?: readonly string[],
  ): Iterable<CardOffer> {
    if (!ctx.world.player(actor).alive || isGameOver(ctx.world)) return;
    const operation = typeof purpose === 'string' ? purpose : 'use';
    for (const id of ownedCards(ctx.world, actor)) {
      const card = this.#build(ctx, actor, { kind: 'physical', card: id }, operation);
      if (
        card.ok &&
        this.#supports(card.value.name, purpose) &&
        (!names || names.includes(card.value.name))
      )
        yield {
          id: JSON.stringify(['physical', id]),
          kind: 'physical',
          label: this.definition(card.value.name).label,
          names: [card.value.name],
          materials: [id],
          count: { min: 1, max: 1 },
          choice: { card: id },
        };
    }
    for (const { self, definition } of this.skills.bindings(ctx.world)) {
      if (self.owner !== actor || !self.effective(ctx.world)) continue;
      const input: ViewAsInput = { self, book: this, purpose: operation };
      for (const recipe of definition.viewAs ?? []) {
        if (
          recipe.available &&
          !syncQueryValue(recipe.available(ctx, input), `${self.skill}/${recipe.id}.available`)
        )
          continue;
        const possible = this.#names(ctx, input, recipe).filter(
          (name) => this.#supports(name, purpose) && (!names || names.includes(name)),
        );
        const materials = syncQueryValue(
          recipe.materials(ctx, input),
          `${self.skill}/${recipe.id}.materials`,
        );
        const count = this.#count(ctx, input, recipe);
        if (!possible.length || materials.length < count.min) continue;
        yield {
          id: JSON.stringify([self.id, recipe.id]),
          kind: 'viewAs',
          label: recipe.label ?? self.name,
          skill: self.skill,
          description: definition.description ?? '',
          names: possible,
          materials,
          count,
          choice: { instance: self.id, recipe: recipe.id },
        };
      }
    }
  }

  /** 玩家草稿可以包含附属选择；只有验证后的真实意图进入用牌与效果管线。 */
  useSelection(
    ctx: Context,
    input: Omit<UseIntent, 'targets' | 'parameters'>,
  ): Decision<Pick<UseIntent, 'targets' | 'parameters'>> {
    return ctx.query(() => {
      const intent: UseIntent = { ...input, targets: [] };
      const built = this.#build(ctx, intent.actor, intent.choice, 'use');
      const rules = built.ok ? this.definition(built.value.name).use : undefined;
      if (rules?.selection) {
        const selection = syncQueryValue(
          rules.selection(ctx, { intent, book: this }),
          `${built.ok ? built.value.name : ''}.selection`,
        );
        // 选择可由普通对象或原型方法实现；固定入口，不用展开对象丢失其声明。
        const { available, describe, feedback, validate } = selection;
        return {
          player: selection.player,
          kind: selection.kind,
          prompt: selection.prompt,
          optional: selection.optional,
          ...(describe === undefined
            ? { data: selection.data }
            : { describe: () => ctx.query(() => describe.call(selection)) }),
          ...(available === undefined
            ? {}
            : { available: () => ctx.query(() => available.call(selection)) }),
          feedback: (raw) =>
            ctx.query(() =>
              syncQueryValue(feedback?.call(selection, raw), 'use.selection.feedback'),
            ),
          validate: (raw) =>
            ctx.query(() => {
              // 出牌草稿也直接调用 validate，不能依赖 DecisionHub 代查可用性。
              if (
                available &&
                !syncQueryValue(available.call(selection), 'use.selection.available')
              )
                return invalid('Card selection is no longer available.');
              const chosen = syncQueryValue(
                validate.call(selection, raw),
                'use.selection.validate',
              );
              if (!chosen.ok) return chosen;
              const legal = this.validateUse(ctx, { ...intent, ...chosen.value });
              return legal.ok ? chosen : legal;
            }),
        };
      }
      const parse = (raw: unknown): Validation<Pick<UseIntent, 'targets' | 'parameters'>> => {
        if (!raw || typeof raw !== 'object' || !('targets' in raw) || !isStringArray(raw.targets))
          return invalid('Expected target IDs.');
        return { ok: true, value: { targets: raw.targets } };
      };
      return {
        player: intent.actor,
        kind: 'cards-targets',
        prompt: '选择用牌目标',
        optional: true,
        feedback: (raw) => {
          const parsed = parse(raw);
          return parsed.ok ? this.inspectUse(ctx, { ...intent, ...parsed.value }) : null;
        },
        validate: (raw) => {
          const parsed = parse(raw);
          if (!parsed.ok) return parsed;
          const legal = this.validateUse(ctx, { ...intent, ...parsed.value });
          return legal.ok ? parsed : legal;
        },
      };
    });
  }

  validateUse(ctx: Context, intent: UseIntent): Validation<UseRequest> {
    return ctx.query(() => {
      if (!isStringArray(intent.targets)) return invalid('Expected target IDs.');
      const built = this.#build(ctx, intent.actor, intent.choice, 'use');
      if (!built.ok) return built;
      if (
        intent.timing.kind === 'play' &&
        (intent.timing.owner !== intent.actor ||
          intent.timing.phase.kind !== 'play' ||
          !intent.timing.phase.belongsTo(ctx.world) ||
          !intent.timing.phase.active ||
          !ctx.cause.scopePath.includes(intent.timing.phase.id))
      )
        return invalid("Not this actor's active play phase.");
      if (
        intent.timing.kind === 'rescue' &&
        (!ctx.world.player(intent.timing.dying).alive ||
          ctx.world.player(intent.timing.dying).hp > 0)
      )
        return invalid('No dying target.');
      if (intent.timing.kind === 'counter') {
        const opportunity = intent.timing.opportunity;
        const lifetime = opportunity.lifetime;
        if (!opportunity.names.includes(built.value.name))
          return invalid('Card is not a supported counter type.');
        const subject =
          opportunity.subject.kind === 'effect'
            ? opportunity.subject.effect
            : opportunity.subject.use;
        if (subject.prohibitedCounters?.includes(built.value.name))
          return invalid('This use prohibits that counter card.');
        if (
          lifetime.kind !== 'counter' ||
          !lifetime.active ||
          !lifetime.belongsTo(ctx.world) ||
          !ctx.cause.scopePath.includes(lifetime.id) ||
          !syncQueryValue(opportunity.available(ctx), 'counter.available')
        )
          return invalid('Counter opportunity is closed or outside this flow.');
      }
      if (intent.timing.kind === 'response') {
        const opportunity = intent.timing.opportunity;
        if (
          opportunity.actor !== intent.actor ||
          opportunity.lifetime.kind !== 'response' ||
          !opportunity.names.includes(built.value.name) ||
          !opportunity.lifetime.active ||
          !opportunity.lifetime.belongsTo(ctx.world) ||
          !ctx.cause.scopePath.includes(opportunity.lifetime.id) ||
          !syncQueryValue(opportunity.available(ctx), 'response.available') ||
          isResponseBlocked(opportunity.to, intent.actor, built.value.name)
        )
          return invalid('Response use opportunity is closed or outside this flow.');
      }
      let request: UseRequest = {
        actor: intent.actor,
        card: built.value,
        targets: intent.targets,
        timing: intent.timing,
        ...(intent.parameters === undefined ? {} : { parameters: intent.parameters }),
      };
      const rules = this.definition(built.value.name).use;
      if (!rules) return invalid('This card cannot be actively used.');
      if (rules.timings && !rules.timings.includes(intent.timing.kind))
        return invalid('Card is unavailable at this timing.');
      if (rules.fixedTargets) {
        if (intent.targets.length)
          return invalid('Fixed-target cards do not accept manual targets.');
        const targets = immutable(
          syncQueryValue(
            rules.fixedTargets(ctx, { actor: intent.actor, card: built.value, book: this }),
            `${built.value.name}.fixedTargets`,
          ),
        );
        if (
          new Set(targets).size !== targets.length ||
          targets.some((id) => !ctx.world.snapshot.players.some((player) => player.id === id))
        )
          throw new Error('Invalid automatic targets.');
        const proposed = { ...request, targets };
        request = {
          ...request,
          targets: targets.filter((target) => this.#target(ctx, proposed, target)),
        };
      }
      if (
        new Set(intent.targets).size !== intent.targets.length ||
        !countValid(
          this.targetCount(ctx, request),
          intent.targets.length,
          ctx.world.snapshot.players.length,
        )
      )
        return invalid('Invalid target count or duplicate targets.');
      if (request.targets.some((target) => !this.#target(ctx, request, target)))
        return invalid('Illegal target.');
      const limit = this.#limit(ctx, request);
      if (limit && used(ctx.world, intent.actor, limit) >= limit.max)
        return invalid('Usage limit reached.');
      const reason = syncQueryValue(
        rules.canUse?.(ctx, { request, book: this }),
        `${request.card.name}.canUse`,
      );
      return reason ? invalid(reason) : { ok: true, value: request };
    });
  }

  /** 目标的部分选择反馈由规则生成；最终可用性仍完整复用 validateUse。 */
  inspectUse(ctx: Context, intent: UseIntent): UseFeedback {
    return ctx.query(() => {
      const built = this.#build(ctx, intent.actor, intent.choice, 'use');
      const rules = built.ok ? this.definition(built.value.name).use : undefined;
      if (!built.ok || !rules)
        return immutable({
          model: 'use',
          complete: false,
          reason: built.ok ? 'This card cannot be used.' : built.reason,
          targetCount: { min: 0, max: 0 },
          fixedTargets: [],
          targets: [],
        });
      const checked = this.validateUse(ctx, intent);
      const request: UseRequest = {
        actor: intent.actor,
        card: built.value,
        timing: intent.timing,
        ...(intent.parameters === undefined ? {} : { parameters: intent.parameters }),
        targets: intent.targets,
      };
      const count = this.targetCount(ctx, request);
      const max = count.max === 'all' ? ctx.world.snapshot.players.length : count.max;
      if (rules.fixedTargets)
        return immutable({
          model: 'use',
          complete: checked.ok,
          reason: checked.ok ? '' : checked.reason,
          targetCount: { min: 0, max: 0 },
          fixedTargets: checked.ok ? checked.value.targets : [],
          targets: [],
        });
      return immutable({
        model: 'use',
        complete: checked.ok,
        reason: checked.ok ? '' : checked.reason,
        targetCount: count,
        fixedTargets: [],
        targets: ctx.world.snapshot.players.map((player) => ({
          id: player.id,
          selected: intent.targets.includes(player.id),
          selectable:
            intent.targets.includes(player.id) ||
            (intent.targets.length < max &&
              this.#target(
                ctx,
                { ...request, targets: [...intent.targets, player.id] },
                player.id,
              )),
        })),
      });
    });
  }

  use(ctx: Context, input: UseIntent): Promise<UseResult> {
    return ctx.flow('useCard', async (child) => {
      let intent: UseIntent = {
        actor: input.actor,
        choice: immutable(input.choice),
        targets: immutable(input.targets),
        timing: Object.freeze({ ...input.timing }),
        ...(input.parameters === undefined ? {} : { parameters: immutable(input.parameters) }),
        ...(input.prohibitedCounters === undefined
          ? {}
          : { prohibitedCounters: immutable(input.prohibitedCounters) }),
      };
      const checked = this.validateUse(child, intent);
      if (!checked.ok) return { kind: 'unavailable', reason: checked.reason };
      let request = checked.value;
      const selected = intent.choice;
      if (selected.kind === 'viewAs') {
        const binding = this.skills.binding(child.world, selected.instance)!;
        const recipe = binding.definition.viewAs!.find((item) => item.id === selected.recipe)!;
        if (recipe.use) {
          const prepared = await recipe.use(child, {
            self: binding.self,
            book: this,
            purpose: 'use',
            intent,
          });

          return prepared;
        }
      }
      const origins = new Map(request.card.materials.map((id) => [id, child.world.position(id)]));
      const rules = this.definition(request.card.name).use!;
      if (rules.prepare) {
        const prepare = rules.prepare;
        const prepared = await child.flow('use.prepare', (at) =>
          prepare(at, { request, book: this }),
        );

        if (!prepared.ok) return { kind: 'unavailable', reason: prepared.reason };
        intent = { ...intent, parameters: immutable(prepared.value) };
        const finalized = this.validateUse(child, intent);
        if (!finalized.ok) return { kind: 'unavailable', reason: finalized.reason };
        if (
          JSON.stringify(finalized.value.card) !== JSON.stringify(request.card) ||
          JSON.stringify(finalized.value.targets) !== JSON.stringify(request.targets)
        )
          return { kind: 'unavailable', reason: 'Card or targets changed during preparation.' };
        request = finalized.value;
      }
      const parameters = intent.parameters ?? null;
      const useId = child.cause.flowId;
      const limit = child.query(() => this.#limit(child, request));
      const result = await withProcessing<UseResult>(child, [], async (body, processing) => {
        const plan: UsePlan = new UsePlan(
          useId,
          intent.actor,
          request.card,
          processing.zone,
          intent.timing,
          request.targets,
          body,
          processing.lifetime,
          (at, target, options) =>
            this.#target(
              at,
              {
                ...request,
                targetOptions: options ?? {},
                targets: [...plan.targets, target],
              },
              target,
            ),
          'use',
          useId,
          parameters,
          intent.prohibitedCounters ?? [],
        );
        const paid = await pay(body, {
          cards: request.card.materials,
          to: processing.zone,
          reason: useId,
          factKind: 'card.used',
          changes: [plan.initializeChange(body)],
          ...(request.card.source?.kind === 'viewAs'
            ? {
                skill: this.#handle(body.world, request.card.source.instance),
              }
            : { actor: intent.actor }),
          ...(limit ? { limit } : {}),
          materialAllowed: (_pay, id, zone) => origins.get(id) === zone.id,
          legal: (atPay) => {
            const latest = this.validateUse(atPay, intent);
            return (
              latest.ok &&
              JSON.stringify(latest.value.card) === JSON.stringify(request.card) &&
              JSON.stringify(latest.value.targets) === JSON.stringify(request.targets)
            );
          },
          declaration: {
            useId,
            processing: processing.zone,
            card: request.card,
            targets: request.targets,
            timing: intent.timing.kind,
            context: timingSnapshot(intent.timing),
            ...(intent.prohibitedCounters?.length
              ? { prohibitedCounters: intent.prohibitedCounters }
              : {}),
            ...(parameters === null ? {} : { parameters }),
          },
        });

        if (paid.kind !== 'paid') return { kind: 'unavailable', reason: paid.reason };
        await body.window(Use.declared, plan, { subject: intent.actor });
        await body.window(Use.targets, plan, { subject: intent.actor });
        await this.#confirmTargets(body, plan);
        let dispatched = false;
        const resolveTargets = async (
          at: Context,
          resolve: TargetResolver | undefined = rules.resolve,
        ): Promise<void> => {
          at.assertActive();
          if (at.world !== body.world || !at.cause.scopePath.includes(body.scope.id) || dispatched)
            throw new Error('Targets must resolve once within this use.');
          dispatched = true;
          await at.flow('use.targets.resolve', (child) =>
            this.#resolveTargets(child, plan, rules, resolve),
          );
        };
        let outcome: unknown = null;
        if (rules.execute) {
          const execute = rules.execute;
          const executed = await body.flow('use.execute', (at) =>
            execute(at, { use: plan, book: this, resolveTargets }),
          );

          outcome = executed ?? null;
        } else await resolveTargets(body);
        if (
          (!dispatched && plan.effects.length > 0) ||
          plan.effects.some((effect) => ['pending', 'targeting', 'ready'].includes(effect.state))
        )
          throw new Error('Card body left unresolved target effects.');
        const finished = plan.close(outcome);
        body.commit('card.finished', [], finished);
        await body.window(Use.finished, finished, { subject: intent.actor });
        return { kind: 'used', use: finished };
      });

      return result;
    });
  }

  /** 结算已放置延时牌：沿用原 UseId，生成本次独立 EffectId，不重复支付、宣告或确认目标。 */
  resolveDelayed(
    ctx: Context,
    source: CardUseRef,
    target: string,
    resolver: TargetResolver,
  ): Promise<UseSnapshot> {
    const input = immutable(source);
    return withLifetime(ctx, 'delayed.effect', async (child, lifetime) => {
      if (!this.definition(input.card.name).delayed) throw new Error('Card has no delayed rules.');
      const plan = new UsePlan(
        input.useId,
        input.actor,
        input.card,
        input.processing,
        { kind: 'effect' },
        [target],
        child,
        lifetime,
        (_at, id) => id === target && child.world.player(id).alive,
        'delayed',
        child.cause.flowId,
        null,
        input.prohibitedCounters ?? [],
      );
      child.commit('delayed.effect.declared', [plan.initializeChange(child)], { useId: plan.id });
      const rules: UseRules = { count: { min: 1, max: 1 }, target: () => true, resolve: resolver };
      await this.#resolveTargets(child, plan, rules, resolver, false);
      const result = plan.close();
      child.commit('delayed.effect.finished', [], result);
      return result;
    });
  }

  isTargetProhibited(ctx: Context, actor: string, target: string, card: SemanticCard): boolean {
    return this.#prohibitedTarget(ctx, actor, target, card);
  }

  /** 征询一次固定用途的用牌；仍完整执行 use，不把救援等用牌降格为响应。 */
  askUse(ctx: Context, request: UseOfferRequest): Promise<AskedUseResult> {
    return ctx.flow('askUse', async (child) => {
      const actor = request.actor;
      const names = immutable(request.names);
      const targets = immutable(request.targets);
      const timing = Object.freeze({ ...request.timing });
      const available = request.available;
      const live = () => child.query(() => available?.(child) ?? true);
      const intent = (choice: CardChoice): UseIntent => ({ actor, choice, targets, timing });
      const accepts = (offer: CardOffer) =>
        offer.kind === 'viewAs' ||
        ('card' in offer.choice &&
          this.validateUse(child, intent({ kind: 'physical', card: offer.choice.card })).ok);
      const offers = () =>
        !live() ? [] : this.offers(child, actor, timing, names).filter(accepts);
      const answer = await child.ask<CardChoice>({
        player: actor,
        kind: 'use-card',
        prompt: request.prompt,
        describe: () => ({
          names,
          targets,
          timing: timing.kind,
          offers: offers(),
          ...(timing.kind === 'counter'
            ? {
                counter: {
                  card: timing.opportunity.root.card.name,
                  target: timing.opportunity.root.target,
                  depth: timing.opportunity.depth,
                },
              }
            : {}),
        }),
        optional: true,
        available: () => live() && this.hasOffers(child, actor, timing, names, accepts),
        validate: (input) => {
          const parsed = parseCardChoice(input);
          if (!parsed.ok) return parsed;
          const checked = this.validateUse(child, intent(parsed.value));
          return live() && checked.ok && names.includes(checked.value.card.name)
            ? parsed
            : invalid('Card does not satisfy this use.');
        },
      });
      if (answer.kind !== 'chosen')
        return answer.kind === 'unavailable'
          ? { kind: 'unavailable', reason: 'No available card.' }
          : { kind: 'declined' };
      const checked = this.validateUse(child, intent(answer.value));
      if (!live() || !checked.ok || !names.includes(checked.value.card.name))
        return { kind: 'unavailable', reason: 'Requested card is no longer available.' };
      const used = await this.use(child, intent(answer.value));

      return used;
    });
  }

  respond(
    ctx: Context,
    actor: string,
    requestedNames: readonly string[],
    target: EffectRef,
  ): Promise<ResponseResult> {
    return requestResponse(
      ctx,
      this,
      actor,
      requestedNames,
      target,
      (at, input, available, consume) => this.#answerChoice(at, input, available, consume),
    );
  }

  /** 响应一个效果时使用牌；技能供牌者实际打出，原请求者使用，材料在回调内交接。 */
  useResponse(
    ctx: Context,
    actor: string,
    names: readonly string[],
    target: EffectRef,
  ): Promise<ResponseResult> {
    return requestResponse(
      ctx,
      this,
      actor,
      names,
      target,
      (at, input, available, consume) => this.#answerChoice(at, input, available, consume),
      undefined,
      'use',
    );
  }

  #answerChoice(
    ctx: Context,
    input: ResponseIntent,
    available: (ctx: Context) => boolean,
    consume?: ResponseConsumer,
  ): Promise<ResponseResult> {
    if (input.purpose === 'response') return this.#respondChoice(ctx, input, available, consume);
    return ctx.flow<ResponseResult>('response.use', async (at) => {
      const opportunity = Object.freeze({
        ...input.opportunity,
        available: (current: Context) =>
          current.query(
            () =>
              syncQueryValue(input.opportunity.available(current), 'response.available') &&
              available(current),
          ),
      });
      const result = await this.use(at, {
        actor: input.actor,
        choice: input.choice,
        targets: [],
        timing: { kind: 'response', opportunity },
      });
      return result.kind === 'used'
        ? {
            kind: 'used',
            id: result.use.id,
            actor: result.use.actor,
            card: result.use.card,
            use: result.use,
          }
        : { kind: 'unavailable' };
    });
  }

  #respondChoice(
    ctx: Context,
    input: ResponseIntent,
    available: (ctx: Context) => boolean,
    consume?: ResponseConsumer,
  ): Promise<ResponseResult> {
    return ctx.flow('response.card', async (child) => {
      const { actor, names, to, choice } = input;
      const built = this.build(child, actor, choice, 'response');
      if (!child.query(() => available(child)) || !built.ok || !names.includes(built.value.name))
        return { kind: 'unavailable' };
      const card = built.value;
      const id = child.cause.flowId;
      const origins = new Map(
        card.materials.map((material) => [material, child.world.position(material)]),
      );
      const processed = await withProcessing<ResponseResult>(
        child,
        [],
        async (body, processing) => {
          const paid = await pay(body, {
            cards: card.materials,
            to: processing.zone,
            reason: id,
            factKind: 'card.responded',
            ...(card.source?.kind === 'viewAs'
              ? { skill: this.#handle(body.world, card.source.instance) }
              : { actor }),
            materialAllowed: (_pay, material, zone) => origins.get(material) === zone.id,
            legal: (atPay) => {
              const current = this.#build(atPay, actor, choice, 'response');
              return (
                atPay.query(() => available(atPay)) &&
                current.ok &&
                names.includes(current.value.name) &&
                JSON.stringify(current.value) === JSON.stringify(card)
              );
            },
            declaration: {
              responseId: id,
              processing: processing.zone,
              request: input.request,
              beneficiary: input.beneficiary,
              to: { useId: to.useId, effectId: to.effectId },
              card,
            },
          });

          if (paid.kind !== 'paid') return { kind: 'unavailable' };
          await body.window(
            Response.finished,
            immutable({ id, actor, card, subject: { kind: 'effect', effect: to } }),
            { subject: actor },
          );
          const response = { kind: 'responded', id, actor, card } as const;
          if (!consume) return response;
          const consumed = await consume(
            body,
            response,
            (at) =>
              at.query(() => available(at)) &&
              processing.lifetime.active &&
              at.cause.scopePath.includes(processing.lifetime.id) &&
              card.materials.every((material) => at.world.position(material) === processing.zone),
          );

          return consumed;
        },
      );

      return processed;
    });
  }

  targetCount(ctx: Context, request: UseRequest): ChoiceCount {
    return ctx.query(() => {
      const rules = this.definition(request.card.name).use;
      if (!rules) return { min: 0, max: 0 };
      const extra = rules.fixedTargets
        ? 0
        : this.skills.query(ctx, queries.extraTargets, request, 0);
      if (!Number.isSafeInteger(extra) || extra < 0) throw new Error('Invalid extra target count.');
      const max = rules.count.max === 'all' ? 'all' : rules.count.max + extra;
      if (max !== 'all' && !Number.isSafeInteger(max)) throw new Error('Invalid target limit.');
      return immutable({ min: rules.count.min, max });
    });
  }
  withinDistance(ctx: Context, request: UseRequest, target: string, maximum: number): boolean {
    return (
      request.targetOptions?.ignoreDistance === true ||
      (request.timing.kind === 'effect' && request.timing.ignoreDistance === true) ||
      this.skills.query(ctx, queries.ignoreDistance, request, false) ||
      this.distance(ctx, request.actor, target, request.card) <= maximum
    );
  }
  distance(ctx: Context, from: string, to: string, card: SemanticCard | null = null): number {
    const players = ctx.world.snapshot.players
      .filter((player) => player.alive)
      .map((player) => player.id);
    const a = players.indexOf(from);
    const b = players.indexOf(to);
    if (a < 0 || b < 0) return Infinity;
    if (a === b) return 0;
    const base = Math.min(Math.abs(a - b), players.length - Math.abs(a - b));
    const correction = this.skills.query(ctx, queries.distanceCorrection, { from, to, card }, 0);
    const value = ctx.query(() => this.policy.distance(ctx, from, to, base + correction));
    if (!Number.isSafeInteger(value)) throw new Error('Invalid distance.');
    return Math.max(1, value);
  }
  handLimit(ctx: Context, actor: string): number {
    const value = ctx.query(() =>
      this.policy.handLimit(
        ctx,
        actor,
        Math.max(
          0,
          ctx.world.player(actor).hp +
            this.skills.query(ctx, queries.handLimitCorrection, { actor }, 0),
        ),
      ),
    );
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid hand limit.');
    return value;
  }
  attackRange(ctx: Context, actor: string, card: SemanticCard): number {
    const value = this.skills.query(
      ctx,
      queries.attackRange,
      { actor, card },
      ctx.query(() => this.policy.attackRange(ctx, actor, card)),
    );
    if (!(value >= 0)) throw new Error('Invalid attack range.');
    return value;
  }
  canDiscard(ctx: Context, input: DiscardRequest): boolean {
    return ctx.query(() => {
      if (!input.reason || isGameOver(ctx.world)) return false;
      // 权限不替代发动资格；已宣告效果是否在来源死亡后继续，由其普通流程明确决定。
      ctx.world.player(input.actor);
      ctx.world.player(input.owner);
      const subject = discardSubject(ctx, input);
      return subject !== null && !this.skills.query(ctx, queries.prohibitDiscard, subject, false);
    });
  }
  /** 为明确的响应牌名计算次数；具名/全部禁令优先于政策及追加最低次数。 */
  responseTimes(ctx: Context, effect: EffectRef, actor: string, name: string): number {
    if (isResponseBlocked(effect, actor, name)) return 0;
    const value = this.skills.query(
      ctx,
      queries.responseCount,
      { effect, actor, name },
      ctx.query(() => this.policy.responseTimes(ctx, effect, actor, name)),
    );
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid response count.');
    // 0 表示没有响应机会，追加最低次数不能重新开放它。
    return value === 0
      ? 0
      : Math.max(
          value,
          ...(effect.responseRequirements ?? [])
            .filter((item) => item.actor === actor)
            .map((item) => item.minimum),
        );
  }

  /** 分层排空四个目标时点；新增身份补齐此前各层，已有身份不重放。 */
  async #confirmTargets(ctx: Context, plan: UsePlan): Promise<void> {
    const windows = {
      specifying: Target.specifying,
      confirming: Target.confirming,
      specified: Target.specified,
      confirmed: Target.confirmed,
    };
    for (let next = plan.nextTarget(); next; next = plan.nextTarget()) {
      const { effect, stage } = next;
      if (!this.#effectAvailable(ctx, effect)) {
        effect.finish('skipped', 'Target no longer available.');
        continue;
      }
      if (effect.state === 'pending') effect.begin();
      effect.enterTargetStage(stage);
      ctx.commit('card.targeting', [], {
        useId: plan.id,
        effectId: effect.effectId,
        target: effect.target,
        stage,
      });
      const subject =
        stage === 'specifying' || stage === 'specified' ? effect.actor : effect.target;
      // 目标身份在同窗内也会失效；canResolve 只属于稍后的实际效果，不提前套用。
      await ctx.window(
        windows[stage],
        { use: plan, effect },
        {
          subject,
          active: (at) => effect.state === 'targeting' && this.#effectAvailable(at, effect),
        },
      );
      if (!effect.cancelled() && !this.#effectAvailable(ctx, effect))
        effect.finish('skipped', 'Target no longer available.');
      if (effect.state === 'targeting' && stage === 'confirmed') effect.prepare();
    }
  }

  async #resolveTargets(
    ctx: Context,
    plan: UsePlan,
    rules: UseRules,
    resolver: TargetResolver | undefined,
    confirmTargets = true,
  ): Promise<void> {
    const available = (at: Context, effect: CardEffect) =>
      this.#effectAvailable(at, effect) &&
      at.query(() => rules.canResolve?.(at, { effect, book: this }) ?? true);
    const prepare = async () => {
      if (confirmTargets) await this.#confirmTargets(ctx, plan);
    };
    await prepare();
    for (let next = plan.next(); next; next = plan.next()) {
      const effect = next;
      if (!effect.cancelled() && !available(ctx, effect))
        effect.finish('skipped', 'Effect no longer available.');
      if (!confirmTargets && effect.state === 'pending') effect.prepare();
      if (effect.state === 'ready') {
        const pending = (at: Context) =>
          ctx.scope.active &&
          at.world === ctx.world &&
          effect.state === 'ready' &&
          available(at, effect);
        // 防具、反制或其他启动候选可取消本效果，后组不再对旧身份继续执行。
        await ctx.window(
          Resolve.starting,
          { use: plan, effect, available: pending },
          {
            subject: effect.target,
            active: pending,
          },
        );
        // 启动窗口也可追加/转移目标；先完成它们的声明，再封口当前实际效果。
        await prepare();
        if (effect.state === 'ready') {
          if (!available(ctx, effect)) effect.finish('skipped', 'Effect no longer available.');
          else {
            if (!resolver) throw new Error('Target effects require a resolve function.');
            effect.start();
            const current = effect;
            const resolved = await ctx.attempt('effect:' + effect.effectId, (at) =>
              resolver(at, { effect: current, book: this }),
            );
            effect.finish(
              resolved.kind === 'resolved' ? 'resolved' : 'aborted',
              resolved.kind === 'aborted' ? resolved.reason : null,
            );
          }
        }
      }
      const snapshot = effect.snapshot();
      ctx.commit('card.effect', [], snapshot);
      await ctx.window(
        Resolve.finished,
        { use: plan, effect: snapshot },
        { subject: effect.target },
      );
      // 实际效果及后效中新增的身份形成下一批目标时点，不重跑已访问身份。
      await prepare();
    }
  }

  #supports(name: string, purpose: Purpose | UseTiming): boolean {
    const definition = this.#definitions.get(name);
    if (purpose === 'response') return definition?.response === true;
    const rules = definition?.use;
    return (
      !!rules &&
      (typeof purpose === 'string' || !rules.timings || rules.timings.includes(purpose.kind))
    );
  }
  #effectAvailable(ctx: Context, effect: EffectRef): boolean {
    return (
      !isGameOver(ctx.world) &&
      ctx.world.player(effect.target).alive &&
      !this.#prohibitedTarget(ctx, effect.actor, effect.target, effect.card)
    );
  }
  #handle(world: Context['world'], id: string): SkillHandle {
    const binding = this.skills.binding(world, id);
    if (!binding) throw new Error('Ability source is no longer available.');
    return binding.self;
  }
  #count(ctx: Context, input: ViewAsInput, recipe: ReturnType<typeof viewAs>): ChoiceCount {
    if (typeof recipe.count !== 'function') return recipe.count;
    const count = syncQueryValue(
      recipe.count(ctx, input),
      `${input.self.skill}/${recipe.id}.count`,
    );
    return normalizeChoiceCount(count, `${input.self.skill}/${recipe.id} material`);
  }
  #names(ctx: Context, input: ViewAsInput, recipe: ViewAs): readonly string[] {
    return typeof recipe.make === 'function'
      ? syncQueryValue(recipe.names!(ctx, input), `${input.self.skill}/${recipe.id}.names`)
      : [recipe.make.name];
  }
  #target(ctx: Context, request: UseRequest, target: string): boolean {
    return ctx.query(
      () =>
        ctx.world.snapshot.players.some((player) => player.id === target && player.alive) &&
        !this.#prohibitedTarget(ctx, request.actor, target, request.card) &&
        (this.definition(request.card.name).use?.target(ctx, { request, target, book: this }) ??
          false),
    );
  }
  #limit(ctx: Context, request: UseRequest): UsageLimit | undefined {
    const usage = this.definition(request.card.name).use?.usage;
    if (request.timing.kind !== 'play' || !usage) return undefined;
    const modified = this.skills.query(ctx, queries.usageLimit, request, usage.max);
    const value = ctx.query(() =>
      this.policy.usage(ctx, request, modified ?? Number.MAX_SAFE_INTEGER),
    );
    if (value !== null && (!Number.isSafeInteger(value) || value < 0))
      throw new Error('Invalid card usage limit.');
    return {
      key: usage.key,
      source: 'card-use',
      lifetime: request.timing.phase,
      max: value ?? Number.MAX_SAFE_INTEGER,
    };
  }
  #build(
    ctx: Context,
    actor: string,
    choice: CardChoice,
    purpose: Purpose,
  ): Validation<SemanticCard> {
    if (!ctx.world.player(actor).alive || isGameOver(ctx.world))
      return invalid('Actor or game is no longer active.');
    if (choice.kind !== 'physical' && !isStringArray(choice.materials))
      return invalid('Expected material IDs.');
    let face: CardFace;
    let materials: readonly string[];
    let source: SemanticCard['source'] = null;
    if (choice.kind === 'physical') {
      if (!ownedCards(ctx.world, actor).includes(choice.card))
        return invalid("Physical card is not in this actor's hand.");
      face = this.face(ctx, choice.card);
      materials = [choice.card];
    } else if (choice.kind === 'generated') {
      if (!choice.reason) return invalid('Generated card requires a reason.');
      face = choice.face;
      materials = choice.materials;
      source = {
        kind: 'generated',
        reason: choice.reason,
        ...(choice.origin ? { origin: immutable(choice.origin) } : {}),
      };
    } else {
      const binding = this.skills.binding(ctx.world, choice.instance);
      if (!binding || binding.self.owner !== actor || !binding.self.effective(ctx.world))
        return invalid('View-as skill is no longer available.');
      const { self, definition } = binding;
      const recipe = definition.viewAs?.find((item) => item.id === choice.recipe);
      if (!recipe) return invalid('Unknown view-as recipe.');
      const input: ViewAsInput = { self, book: this, purpose };
      if (
        recipe.available &&
        !syncQueryValue(recipe.available(ctx, input), `${self.skill}/${recipe.id}.available`)
      )
        return invalid('Recipe is unavailable here.');
      const candidates = syncQueryValue(
        recipe.materials(ctx, input),
        `${self.skill}/${recipe.id}.materials`,
      );
      if (
        !countValid(this.#count(ctx, input, recipe), choice.materials.length, candidates.length) ||
        choice.materials.some((id) => !candidates.includes(id))
      )
        return invalid('Invalid recipe materials.');
      const made = syncQueryValue(
        typeof recipe.make === 'function'
          ? recipe.make(ctx, {
              ...input,
              materials: choice.materials,
              parameters: choice.parameters ?? null,
            })
          : recipe.make,
        `${self.skill}/${recipe.id}.make`,
      );
      if (!made || !this.#names(ctx, input, recipe).includes(made.name))
        return invalid('Recipe could not construct this card.');
      face = made;
      materials = choice.materials;
      source = { kind: 'viewAs', skill: self.skill, instance: self.id, recipe: recipe.id };
    }
    if (
      new Set(materials).size !== materials.length ||
      materials.some((id) => !ctx.world.snapshot.cards.some((card) => card.id === id))
    )
      return invalid('Duplicate or unknown material.');
    if (!this.#supports(face.name, purpose))
      return invalid('Card is unavailable for this purpose.');
    // 同次构牌复用实体牌面；转换和生成牌的材料仍按当前状态读取。
    const faces = choice.kind === 'physical' ? [face] : materials.map((id) => this.face(ctx, id));
    const first = faces.length === 1 ? faces[0]! : null;
    const suit = face.suit ?? first?.suit ?? 'none';
    const colors = faces.map((card) => card.color);
    const materialColor =
      colors.length && colors.every((color) => color === colors[0]) ? colors[0]! : 'none';
    const card: SemanticCard = immutable({
      name: face.name,
      suit,
      color:
        face.color ??
        (face.suit === undefined
          ? (first?.color ?? materialColor)
          : suit === 'none'
            ? materialColor
            : colorOfSuit(suit)),
      rank: face.rank ?? first?.rank ?? 0,
      nature: face.nature ?? this.definition(face.name).nature ?? 'normal',
      materials,
      source,
    });
    if (!Number.isInteger(card.rank) || card.rank < 0 || card.rank > 13)
      return invalid('Invalid semantic card rank.');
    if (!['spade', 'heart', 'club', 'diamond', 'none'].includes(card.suit))
      return invalid('Invalid semantic card suit.');
    if (!['red', 'black', 'none'].includes(card.color))
      return invalid('Invalid semantic card color.');
    if (typeof card.nature !== 'string' || !card.nature.trim())
      return invalid('Invalid semantic card nature.');
    if (
      purpose === 'use'
        ? this.skills.query(
            ctx,
            queries.prohibitUse,
            { actor, card },
            this.policy.prohibitUse(ctx, actor, card),
          )
        : this.isResponseProhibited(ctx, actor, card)
    )
      return invalid('Card is prohibited for this purpose.');
    return { ok: true, value: card };
  }

  #prohibitedTarget(ctx: Context, actor: string, target: string, card: SemanticCard): boolean {
    return this.skills.query(
      ctx,
      queries.prohibitTarget,
      { actor, target, card },
      ctx.query(() => this.policy.prohibitTarget(ctx, actor, target, card)),
    );
  }
}
