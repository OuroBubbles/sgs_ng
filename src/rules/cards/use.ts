import type { Decision, Validation } from '../../core/decisions/hub';
import type { ChoiceCount } from '../../core/decisions/count';
import { equal, immutable, isStringArray } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineEvent, timing } from '../../core/runtime/event';
import { pay, used } from '../costs/pay';
import { isGameOver } from '../game/end';
import { withLifetime } from '../scopes/lifetime';
import { cardDef, rulesOf } from '../skills/skills';
import type { SkillHandle } from '../skills/skills';
import { buildCard, cardOffers, countValid, hasCardOffers, invalid, parseCardChoice } from './card';
import type { CardOffer } from './card';
import { Delayed } from './delayed';
import { CardEvent, declared } from './move';
import { UsePlan } from './plan';
import type { UsePlanView } from './plan';
import { withProcessing } from './processing';
import { isTargetProhibited, targetCount, usageLimit } from './rule';
import { isResponseBlocked, timingSnapshot, victimOf } from './types';
import type {
  CardChoice,
  CardEffect,
  CardUseRef,
  EffectRef,
  EffectSnapshot,
  TargetResolver,
  UseIntent,
  UseRequest,
  UseRules,
  UseSnapshot,
  UseTiming,
} from './types';

// 统一用牌管线：验证、支付、宣告、目标时点与逐目标结算。牌与技能只依赖这里的语义操作。

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
  materialsObtained: declared<{
    readonly actor: string;
    readonly useId: string;
    readonly cards: readonly string[];
    readonly reason: string;
  }>(),
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

/** 玩家草稿可以包含附属选择；只有验证后的真实意图进入用牌与效果管线。 */
export function useSelection(
  ctx: Context,
  input: Omit<UseIntent, 'targets' | 'parameters'>,
): Decision<Pick<UseIntent, 'targets' | 'parameters'>> {
  return ctx.query(() => {
    const intent: UseIntent = { ...input, targets: [] };
    const built = buildCard(ctx, intent.actor, intent.choice, 'use');
    const rules = built.ok ? cardDef(ctx, built.value.name).use : undefined;
    const victim = rules?.victim;
    // 附属目标是最后选出的一名角色：记入 parameters.victim，不进入效果目标。
    const split = (targets: readonly string[]): Pick<UseIntent, 'targets' | 'parameters'> =>
      victim
        ? { targets: targets.slice(0, -1), parameters: { victim: targets.at(-1) } }
        : { targets };
    const parse = (raw: unknown): Validation<readonly string[]> =>
      !raw || typeof raw !== 'object' || !('targets' in raw) || !isStringArray(raw.targets)
        ? invalid('Expected target IDs.')
        : { ok: true, value: raw.targets };
    const check = (targets: readonly string[]) =>
      victim && targets.length < 2
        ? invalid('Illegal target.')
        : validateUse(ctx, { ...intent, ...split(targets) });
    return {
      player: intent.actor,
      kind: 'cards-targets',
      prompt: victim?.prompt ?? '选择用牌目标',
      optional: true,
      feedback: (raw) => {
        const parsed = parse(raw);
        if (!parsed.ok) return null;
        if (!victim) return inspectUse(ctx, { ...intent, targets: parsed.value });
        const targets = parsed.value;
        const complete = (next: readonly string[]) => check(next).ok;
        const reachable = (next: readonly string[]) =>
          complete(next) ||
          ctx.world.snapshot.players.some(
            (player) => player.alive && !next.includes(player.id) && complete([...next, player.id]),
          );
        const done = check(targets);
        const valid = !targets.length || reachable(targets);
        return immutable({
          model: 'use',
          complete: done.ok,
          reason: done.ok ? '' : done.reason,
          prompt: victim.prompt,
          targetCount: {
            min: valid && !done.ok ? Math.max(2, targets.length + 1) : 2,
            max: 'all',
          },
          fixedTargets: [],
          targets: ctx.world.snapshot.players.map((player) => {
            const selected = targets.includes(player.id);
            return {
              id: player.id,
              selected,
              selectable: selected || (player.alive && reachable([...targets, player.id])),
            };
          }),
        });
      },
      validate: (raw) => {
        const parsed = parse(raw);
        if (!parsed.ok) return parsed;
        const legal = check(parsed.value);
        return legal.ok ? { ok: true, value: split(parsed.value) } : legal;
      },
    };
  });
}

export function validateUse(ctx: Context, intent: UseIntent): Validation<UseRequest> {
  return ctx.query(() => {
    if (!isStringArray(intent.targets)) return invalid('Expected target IDs.');
    const built = buildCard(ctx, intent.actor, intent.choice, 'use');
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
      (!ctx.world.player(intent.timing.dying).alive || ctx.world.player(intent.timing.dying).hp > 0)
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
        !opportunity.available(ctx)
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
        !opportunity.available(ctx) ||
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
    const rules = cardDef(ctx, built.value.name).use;
    if (!rules) return invalid('This card cannot be actively used.');
    if (rules.timings && !rules.timings.includes(intent.timing.kind))
      return invalid('Card is unavailable at this timing.');
    if (rules.victim && typeof victimOf(request) !== 'string') return invalid('Missing victim.');
    if (rules.fixedTargets) {
      if (intent.targets.length) return invalid('Fixed-target cards do not accept manual targets.');
      const targets = immutable(
        rules.fixedTargets(ctx, { actor: intent.actor, card: built.value }),
      );
      if (
        new Set(targets).size !== targets.length ||
        targets.some((id) => !ctx.world.snapshot.players.some((player) => player.id === id))
      )
        throw new Error('Invalid automatic targets.');
      const proposed = { ...request, targets };
      request = {
        ...request,
        targets: targets.filter((target) => legalTarget(ctx, proposed, target)),
      };
    }
    if (
      new Set(intent.targets).size !== intent.targets.length ||
      !countValid(
        targetCount(ctx, request),
        intent.targets.length,
        ctx.world.snapshot.players.length,
      )
    )
      return invalid('Invalid target count or duplicate targets.');
    if (request.targets.some((target) => !legalTarget(ctx, request, target)))
      return invalid('Illegal target.');
    const limit = usageLimit(ctx, request);
    if (limit && used(ctx.world, intent.actor, limit) >= limit.max)
      return invalid('Usage limit reached.');
    const reason = rules.canUse?.(ctx, { request });
    return reason ? invalid(reason) : { ok: true, value: request };
  });
}

/** 目标的部分选择反馈由规则生成；最终可用性仍完整复用 validateUse。 */
export function inspectUse(ctx: Context, intent: UseIntent): UseFeedback {
  return ctx.query(() => {
    const built = buildCard(ctx, intent.actor, intent.choice, 'use');
    const rules = built.ok ? cardDef(ctx, built.value.name).use : undefined;
    if (!built.ok || !rules)
      return immutable({
        model: 'use',
        complete: false,
        reason: built.ok ? 'This card cannot be used.' : built.reason,
        targetCount: { min: 0, max: 0 },
        fixedTargets: [],
        targets: [],
      });
    const checked = validateUse(ctx, intent);
    const request: UseRequest = {
      actor: intent.actor,
      card: built.value,
      timing: intent.timing,
      ...(intent.parameters === undefined ? {} : { parameters: intent.parameters }),
      targets: intent.targets,
    };
    const count = targetCount(ctx, request);
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
            legalTarget(ctx, { ...request, targets: [...intent.targets, player.id] }, player.id)),
      })),
    });
  });
}

export function useCard(ctx: Context, input: UseIntent): Promise<UseResult> {
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
    const checked = validateUse(child, intent);
    if (!checked.ok) return { kind: 'unavailable', reason: checked.reason };
    let request = checked.value;
    const selected = intent.choice;
    if (selected.kind === 'viewAs') {
      const binding = rulesOf(child).binding(child.world, selected.instance)!;
      const recipe = binding.definition.viewAs!.find((item) => item.id === selected.recipe)!;
      if (recipe.use) {
        const prepared = await recipe.use(child, {
          self: binding.self,
          purpose: 'use',
          intent,
        });

        return prepared;
      }
    }
    const origins = new Map(request.card.materials.map((id) => [id, child.world.position(id)]));
    const rules = cardDef(child, request.card.name).use!;
    if (rules.prepare) {
      const prepare = rules.prepare;
      const prepared = await child.flow('use.prepare', (at) => prepare(at, { request }));

      if (!prepared.ok) return { kind: 'unavailable', reason: prepared.reason };
      intent = { ...intent, parameters: immutable(prepared.value) };
      const finalized = validateUse(child, intent);
      if (!finalized.ok) return { kind: 'unavailable', reason: finalized.reason };
      if (
        !equal(finalized.value.card, request.card) ||
        !equal(finalized.value.targets, request.targets)
      )
        return { kind: 'unavailable', reason: 'Card or targets changed during preparation.' };
      request = finalized.value;
    }
    const parameters = intent.parameters ?? null;
    const useId = child.cause.flowId;
    const limit = child.query(() => usageLimit(child, request));
    const result = await withProcessing<UseResult>(child, [], async (body, processing) => {
      const plan: UsePlan = new UsePlan({
        id: useId,
        actor: intent.actor,
        card: request.card,
        processing: processing.zone,
        timing: intent.timing,
        targets: request.targets,
        ctx: body,
        lifetime: processing.lifetime,
        accepts: (at, target, options) =>
          legalTarget(
            at,
            { ...request, targetOptions: options ?? {}, targets: [...plan.targets, target] },
            target,
          ),
        parameters,
        prohibitedCounters: intent.prohibitedCounters ?? [],
      });
      const paid = await pay(body, {
        cards: request.card.materials,
        to: processing.zone,
        reason: useId,
        factKind: CardEvent.used,
        changes: [plan.initializeChange(body)],
        ...(request.card.source?.kind === 'viewAs'
          ? {
              skill: abilityHandle(body, request.card.source.instance),
            }
          : { actor: intent.actor }),
        ...(limit ? { limit } : {}),
        materialAllowed: (_pay, id, zone) => origins.get(id) === zone.id,
        legal: (atPay) => {
          const latest = validateUse(atPay, intent);
          return (
            latest.ok &&
            equal(latest.value.card, request.card) &&
            equal(latest.value.targets, request.targets)
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
      await confirmTargets(body, plan);
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
          resolvePlanTargets(child, plan, rules, resolve),
        );
      };
      let outcome: unknown = null;
      if (rules.execute) {
        const execute = rules.execute;
        const executed = await body.flow('use.execute', (at) =>
          execute(at, { use: plan, resolveTargets }),
        );

        outcome = executed ?? null;
      } else await resolveTargets(body);
      if (
        (!dispatched && plan.effects.length > 0) ||
        plan.effects.some((effect) => ['pending', 'targeting', 'ready'].includes(effect.state))
      )
        throw new Error('Card body left unresolved target effects.');
      const finished = plan.close(outcome);
      body.commit(CardEvent.finished, [], finished);
      await body.window(Use.finished, finished, { subject: intent.actor });
      return { kind: 'used', use: finished };
    });

    return result;
  });
}

/** 结算已放置延时牌：沿用原 UseId，生成本次独立 EffectId，不重复支付、宣告或确认目标。 */
export function resolveDelayed(
  ctx: Context,
  source: CardUseRef,
  target: string,
  resolver: TargetResolver,
): Promise<UseSnapshot> {
  const input = immutable(source);
  return withLifetime(ctx, 'delayed.effect', async (child, lifetime) => {
    if (!cardDef(child, input.card.name).delayed) throw new Error('Card has no delayed rules.');
    const plan = new UsePlan({
      id: input.useId,
      actor: input.actor,
      card: input.card,
      processing: input.processing,
      timing: { kind: 'effect' },
      targets: [target],
      ctx: child,
      lifetime,
      accepts: (_at, id) => id === target && child.world.player(id).alive,
      stage: 'delayed',
      effectPrefix: child.cause.flowId,
      prohibitedCounters: input.prohibitedCounters ?? [],
    });
    child.commit(Delayed.effectDeclared, [plan.initializeChange(child)], { useId: plan.id });
    const rules: UseRules = { count: { min: 1, max: 1 }, target: () => true, resolve: resolver };
    await resolvePlanTargets(child, plan, rules, resolver, false);
    const result = plan.close();
    child.commit(Delayed.effectFinished, [], result);
    return result;
  });
}
/** 征询一次固定用途的用牌；仍完整执行 use，不把救援等用牌降格为响应。 */
export function askUse(ctx: Context, request: UseOfferRequest): Promise<AskedUseResult> {
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
        validateUse(child, intent({ kind: 'physical', card: offer.choice.card })).ok);
    const offers = () => (!live() ? [] : cardOffers(child, actor, timing, names).filter(accepts));
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
      available: () => live() && hasCardOffers(child, actor, timing, names, accepts),
      validate: (input) => {
        const parsed = parseCardChoice(input);
        if (!parsed.ok) return parsed;
        const checked = validateUse(child, intent(parsed.value));
        return live() && checked.ok && names.includes(checked.value.card.name)
          ? parsed
          : invalid('Card does not satisfy this use.');
      },
    });
    if (answer.kind !== 'chosen')
      return answer.kind === 'unavailable'
        ? { kind: 'unavailable', reason: 'No available card.' }
        : { kind: 'declined' };
    const checked = validateUse(child, intent(answer.value));
    if (!live() || !checked.ok || !names.includes(checked.value.card.name))
      return { kind: 'unavailable', reason: 'Requested card is no longer available.' };
    const used = await useCard(child, intent(answer.value));

    return used;
  });
}
/** 分层排空四个目标时点；新增身份补齐此前各层，已有身份不重放。 */
async function confirmTargets(ctx: Context, plan: UsePlan): Promise<void> {
  const windows = {
    specifying: Target.specifying,
    confirming: Target.confirming,
    specified: Target.specified,
    confirmed: Target.confirmed,
  };
  for (let next = plan.nextTarget(); next; next = plan.nextTarget()) {
    const { effect, stage } = next;
    if (!effectAvailable(ctx, effect)) {
      effect.finish('skipped', 'Target no longer available.');
      continue;
    }
    if (effect.state === 'pending') effect.begin();
    effect.enterTargetStage(stage);
    ctx.commit(CardEvent.targeting, [], {
      useId: plan.id,
      effectId: effect.effectId,
      target: effect.target,
      stage,
    });
    const subject = stage === 'specifying' || stage === 'specified' ? effect.actor : effect.target;
    // 目标身份在同窗内也会失效；canResolve 只属于稍后的实际效果，不提前套用。
    await ctx.window(
      windows[stage],
      { use: plan, effect },
      {
        subject,
        active: (at) => effect.state === 'targeting' && effectAvailable(at, effect),
      },
    );
    if (!effect.cancelled() && !effectAvailable(ctx, effect))
      effect.finish('skipped', 'Target no longer available.');
    if (effect.state === 'targeting' && stage === 'confirmed') effect.prepare();
  }
}

async function resolvePlanTargets(
  ctx: Context,
  plan: UsePlan,
  rules: UseRules,
  resolver: TargetResolver | undefined,
  confirm = true,
): Promise<void> {
  const available = (at: Context, effect: CardEffect) =>
    effectAvailable(at, effect) && at.query(() => rules.canResolve?.(at, { effect }) ?? true);
  const prepare = async () => {
    if (confirm) await confirmTargets(ctx, plan);
  };
  await prepare();
  for (let next = plan.next(); next; next = plan.next()) {
    const effect = next;
    if (!effect.cancelled() && !available(ctx, effect))
      effect.finish('skipped', 'Effect no longer available.');
    if (!confirm && effect.state === 'pending') effect.prepare();
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
            resolver(at, { effect: current }),
          );
          effect.finish(
            resolved.kind === 'resolved' ? 'resolved' : 'aborted',
            resolved.kind === 'aborted' ? resolved.reason : null,
          );
        }
      }
    }
    const snapshot = effect.snapshot();
    ctx.commit(CardEvent.effect, [], snapshot);
    await ctx.window(Resolve.finished, { use: plan, effect: snapshot }, { subject: effect.target });
    // 实际效果及后效中新增的身份形成下一批目标时点，不重跑已访问身份。
    await prepare();
  }
}
function effectAvailable(ctx: Context, effect: EffectRef): boolean {
  return (
    !isGameOver(ctx.world) &&
    ctx.world.player(effect.target).alive &&
    !isTargetProhibited(ctx, effect.actor, effect.target, effect.card)
  );
}
/** 视为牌来源技能的当前句柄；来源已失效时报错。 */
export function abilityHandle(ctx: Context, id: string): SkillHandle {
  const binding = rulesOf(ctx).binding(ctx.world, id);
  if (!binding) throw new Error('Ability source is no longer available.');
  return binding.self;
}
function legalTarget(ctx: Context, request: UseRequest, target: string): boolean {
  return ctx.query(
    () =>
      ctx.world.snapshot.players.some((player) => player.id === target && player.alive) &&
      !isTargetProhibited(ctx, request.actor, target, request.card) &&
      (cardDef(ctx, request.card.name).use?.target(ctx, { request, target }) ?? false),
  );
}
