import type { ChoiceCount } from '../../core/decisions/count';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import type { UsageLimit } from '../costs/pay';
import { cardDef, queryRule } from '../skills/skills';
import * as queries from './queries';
import { isResponseBlocked } from './types';
import type { EffectRef, SemanticCard, UseRequest } from './types';

// 用牌规则的纯查询：基础值由规则给出，技能与独立效果经 cardQueries 修正。

/** 座次距离（至少 1），含坐骑等修正。 */
export function distance(
  ctx: Context,
  from: string,
  to: string,
  card: SemanticCard | null = null,
): number {
  const players = ctx.world.snapshot.players.filter((p) => p.alive).map((p) => p.id);
  const a = players.indexOf(from);
  const b = players.indexOf(to);
  if (a < 0 || b < 0) return Infinity;
  if (a === b) return 0;
  const base = Math.min(Math.abs(a - b), players.length - Math.abs(a - b));
  const value = base + queryRule(ctx, queries.distanceCorrection, { from, to, card }, 0);
  if (!Number.isSafeInteger(value)) throw new Error('Invalid distance.');
  return Math.max(1, value);
}

/** 本次用牌的规则修正合计；时机或目标选项豁免距离即 range 为 Infinity。 */
export function useRule(ctx: Context, request: UseRequest): Required<queries.UseRule> {
  const free =
    request.targetOptions?.ignoreDistance === true ||
    (request.timing.kind === 'effect' && request.timing.ignoreDistance === true);
  const rule = queryRule(ctx, queries.useRule, request, {
    times: 0,
    targets: 0,
    range: free ? Infinity : 0,
  }) as Required<queries.UseRule>;
  if (
    !(rule.times >= 0) ||
    !(rule.range >= 0) ||
    !Number.isSafeInteger(rule.targets) ||
    rule.targets < 0
  )
    throw new Error('Invalid use rule.');
  return rule;
}

/** 目标是否在给定距离内（加上 useRule 的额外距离）。 */
export function withinDistance(
  ctx: Context,
  request: UseRequest,
  target: string,
  maximum: number,
): boolean {
  const range = maximum + useRule(ctx, request).range;
  return range === Infinity || distance(ctx, request.actor, target, request.card) <= range;
}

/** 攻击范围：基础 1，武器等取最大值。 */
export function attackRange(ctx: Context, actor: string, card: SemanticCard): number {
  const value = queryRule(ctx, queries.attackRange, { actor, card }, 1);
  if (!(value >= 0)) throw new Error('Invalid attack range.');
  return value;
}

/** 手牌上限：体力值加修正，不低于 0。 */
export function handLimit(ctx: Context, actor: string): number {
  const correction = queryRule(ctx, queries.handLimitCorrection, { actor }, 0);
  const value = Math.max(0, ctx.world.player(actor).hp + correction);
  if (!Number.isSafeInteger(value)) throw new Error('Invalid hand limit.');
  return value;
}

/** 为明确的响应牌名计算次数；具名/全部禁令优先于追加最低次数。 */
export function responseTimes(
  ctx: Context,
  effect: EffectRef,
  actor: string,
  name: string,
): number {
  if (isResponseBlocked(effect, actor, name)) return 0;
  const value = queryRule(ctx, queries.responseCount, { effect, actor, name }, 1);
  if (!Number.isSafeInteger(value)) throw new Error('Invalid response count.');
  return Math.max(
    value,
    ...(effect.responseRequirements ?? [])
      .filter((item) => item.actor === actor)
      .map((item) => item.minimum),
  );
}

export function isTargetProhibited(
  ctx: Context,
  actor: string,
  target: string,
  card: SemanticCard,
): boolean {
  return queryRule(ctx, queries.prohibitTarget, { actor, target, card }, false);
}

/** 打出禁令与“这张牌是否定义了闪/杀等普通响应”分开，供改判等规则复用。 */
export function isResponseProhibited(ctx: Context, actor: string, card: SemanticCard): boolean {
  return ctx.query(() => {
    ctx.world.player(actor);
    return queryRule(ctx, queries.prohibitResponse, { actor, card }, false);
  });
}

/** 本次用牌可选的目标数：牌面声明加额外目标修正；固定目标牌不追加。 */
export function targetCount(ctx: Context, request: UseRequest): ChoiceCount {
  return ctx.query(() => {
    const rules = cardDef(ctx, request.card.name).use;
    if (!rules) return { min: 0, max: 0 };
    const extra = rules.fixedTargets ? 0 : useRule(ctx, request).targets;
    const max = rules.count.max === 'all' ? 'all' : rules.count.max + extra;
    if (max !== 'all' && !Number.isSafeInteger(max)) throw new Error('Invalid target limit.');
    return immutable({ min: rules.count.min, max });
  });
}

/** 牌面声明的次数限制只约束出牌阶段的主动使用；按牌名计数，修正给出额外次数。 */
export function usageLimit(ctx: Context, request: UseRequest): UsageLimit | undefined {
  const limit = cardDef(ctx, request.card.name).use?.limit;
  if (request.timing.kind !== 'play' || !limit) return undefined;
  return { key: request.card.name, ...limit, times: limit.times + useRule(ctx, request).times };
}
