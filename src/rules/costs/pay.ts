import { canDiscard } from '../cards/discard';
import type { CardMove, Change, WorldReader, Zone } from '../../core/model/state';
import { immutable, isStringArray } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { assertLifetime } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';
import type { SkillHandle } from '../skills/skills';
import { readState, stateChange, useCount } from '../state/state';
import { isGameOver } from '../game/end';
import { Cards } from '../cards/move';
import { defineEvent, timing } from '../../core/runtime/event';
import type { Timing } from '../../core/runtime/event';

export interface UsageLimit {
  readonly key: string;
  /** 规则选择计数命名空间：技能名可跨重新授予共享，实例 ID 则区分每次技能实例。 */
  readonly source: string | null;
  readonly lifetime: Lifetime;
  readonly max: number;
}

function usageTarget(actor: string, limit: UsageLimit) {
  return {
    owner: actor,
    source: JSON.stringify([limit.source, limit.key]),
    lifetime: limit.lifetime,
  };
}

export function used(world: WorldReader, actor: string, limit: UsageLimit): number {
  return readState(world, useCount, usageTarget(actor, limit));
}

export interface PaymentOptions {
  readonly reason: string;
  readonly limit?: UsageLimit;
  readonly areas?: readonly Zone['kind'][];
  readonly legal?: (ctx: Context) => boolean;
  readonly declaration?: unknown;
  /** 待决规则意图：费用提交前重查，同步确定后才开放支付后效；不写入事实。 */
  readonly intent?: PaymentIntent;
  readonly factKind?: Timing<unknown, PaymentReceipt>;
  readonly materialAllowed?: (ctx: Context, card: string, zone: Zone) => boolean;
  /** 与费用同次提交的规则变更；其中的移动也纳入同一 cardsMoved 批次。 */
  readonly changes?: readonly Change[];
}

/** 技能支付由来源确定付款人；普通支付显式指定角色，不能同时声明两个主体。 */
export type PaymentSource =
  | { readonly skill: SkillHandle; readonly actor?: never }
  | { readonly actor: string; readonly skill?: never };

/** 零材料支付无需目的区；声明材料时必须同时明确其去向。 */
export type PaymentSpec = PaymentOptions &
  PaymentSource &
  (
    | { readonly cards: readonly string[]; readonly to: string }
    | { readonly cards?: never; readonly to?: never }
  );

export interface PaymentIntent {
  /** 纯查询；失效时不支付任何费用。 */
  available(ctx: Context): boolean;
  /** 费用已提交，尚未开放 cardsMoved/costPaid；必须同步，不可等待。 */
  committed(ctx: Context): void;
}

export interface PaymentReceipt<D = unknown> {
  readonly actor: string;
  readonly cards: readonly string[];
  readonly reason: string;
  readonly skill: string | null;
  readonly instance: string | null;
  readonly declaration: D;
}

export type PaymentResult =
  | { readonly kind: 'paid'; readonly receipt: PaymentReceipt; readonly seq: number }
  | { readonly kind: 'unavailable'; readonly reason: string };

export const Cost = defineEvent('cost', {
  paid: timing<PaymentReceipt>(),
});

/** 费用、次数和宣告同步提交；支付后效完整结束后返回，不承诺整条技能事务回滚。 */
export function pay(ctx: Context, spec: PaymentSpec): Promise<PaymentResult> {
  return performPayment(ctx, spec);
}

/** 弃牌费用直接进入同一支付流程；权限与原 legal 同步重查，保留原型字段及方法接收者。 */
export function payDiscard(
  ctx: Context,
  spec: Omit<PaymentOptions, 'materialAllowed'> &
    PaymentSource & {
      readonly cards: readonly string[];
    },
): Promise<PaymentResult> {
  return performPayment(ctx, spec, true);
}

/** 两个公开入口各自约束配置形状，实际检查、提交与后效只有一份实现。 */
function performPayment(
  ctx: Context,
  spec: PaymentOptions &
    PaymentSource & {
      readonly cards?: readonly string[];
      readonly to?: string;
    },
  discard = false,
): Promise<PaymentResult> {
  // 同一次支付的来源与原因固定；资格、权限、流程因果和收据共用这份身份。
  const { skill, actor: specifiedActor, reason } = spec;
  const actor = skill ? skill.owner : specifiedActor;
  return ctx.flow(
    'pay',
    (child) => {
      const intent = spec.intent;
      if (isGameOver(child.world)) return { kind: 'unavailable', reason: 'Game has finished.' };
      const to = discard ? 'discard' : spec.to;
      if ((specifiedActor === undefined) === (skill === undefined))
        throw new Error('Payment requires exactly one actor or skill source.');
      const limit = spec.limit;
      if (limit) {
        assertLifetime(child, limit.lifetime);
        if (!limit.key || !Number.isSafeInteger(limit.max) || limit.max < 0)
          throw new Error('Invalid usage limit.');
      }
      const materials = spec.cards;
      if ((materials === undefined) !== (to === undefined))
        throw new Error('Payment materials and destination must be provided together.');
      if (to !== undefined) child.world.zone(to);
      if (skill ? !child.query(() => skill.active(child)) : !child.world.player(actor).alive)
        return { kind: 'unavailable', reason: 'Actor or skill is no longer available.' };
      if (limit && used(child.world, actor, limit) >= limit.max)
        return { kind: 'unavailable', reason: 'Usage limit reached.' };
      // 权限检查与实际移动使用同一份材料，查询回调不能替换本次费用。
      const ids = child.query(() => immutable(materials ?? []));
      if (
        (discard || spec.legal) &&
        !child.query(() => {
          if (discard && !ids.every((card) => canDiscard(child, { actor, card, reason })))
            return false;
          return spec.legal ? spec.legal(child) : true;
        })
      )
        return { kind: 'unavailable', reason: 'Final cost conditions changed.' };
      if (intent && !child.query(() => intent.available(child)))
        return { kind: 'unavailable', reason: 'Declaration is no longer available.' };
      if (
        !isStringArray(ids) ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !child.world.snapshot.cards.some((card) => card.id === id))
      )
        return { kind: 'unavailable', reason: 'Invalid cost materials.' };
      const materialMoves: (CardMove & { cards: string[] })[] = [];
      if (to !== undefined) {
        for (const id of ids) {
          const zone = child.world.zone(child.world.position(id));
          const allowed = spec.materialAllowed
            ? child.query(() => spec.materialAllowed?.(child, id, zone))
            : zone.owner === actor && (spec.areas ?? ['hand', 'equipment']).includes(zone.kind);
          if (!allowed)
            return {
              kind: 'unavailable',
              reason: 'Cost materials are no longer owned or selectable.',
            };
          const existing = materialMoves.find((move) => move.from === zone.id);
          if (existing) existing.cards.push(id);
          else materialMoves.push({ cards: [id], from: zone.id, to, place: 'bottom' });
        }
      }
      const changes: Change[] = materialMoves.map((move) => ({ kind: 'move', ...move }));
      if (limit)
        changes.push(
          stateChange(
            child,
            useCount,
            usageTarget(actor, limit),
            used(child.world, actor, limit) + 1,
          ),
        );
      changes.push(...(spec.changes ?? []));
      const moves = immutable(
        changes.flatMap((change): CardMove[] =>
          change.kind === 'move' && change.cards.length
            ? [{ cards: change.cards, from: change.from, to: change.to, place: change.place }]
            : [],
        ),
      );
      const affected = new Set(moves.flatMap((move) => [move.from, move.to]));
      const before = child.world.snapshot.zones.filter((zone) => affected.has(zone.id));
      const receipt = immutable({
        actor,
        cards: ids,
        reason,
        skill: skill?.skill ?? null,
        instance: skill?.id ?? null,
        declaration: spec.declaration ?? null,
      });
      const fact = child.commit(spec.factKind ?? Cost.paid, changes, receipt);
      // 快照属于这次提交，不追随同步宣告或后续嵌套结算的另一次变更。
      const moved = moves.length
        ? immutable({
            kind: 'moved' as const,
            moves,
            before,
            after: child.world.snapshot.zones.filter((zone) => affected.has(zone.id)),
          })
        : null;
      const declared: unknown = intent?.committed(child);
      if (
        declared !== null &&
        (typeof declared === 'object' || typeof declared === 'function') &&
        'then' in declared &&
        typeof declared.then === 'function'
      ) {
        void Promise.resolve(declared).catch(() => undefined);
        throw new Error('Payment declaration must be synchronous.');
      }
      // 提交/宣告必须直接同步执行，错误才能在排队续体之前冻结本局；只有后效可等待。
      const settle = async (): Promise<PaymentResult> => {
        if (moved) await child.window(Cards.moved, moved, { subject: receipt.actor });
        await child.window(Cost.paid, receipt, { subject: receipt.actor });
        return { kind: 'paid', receipt, seq: fact.seq };
      };
      return settle();
    },
    reason,
  );
}
