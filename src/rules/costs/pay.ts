import type { CardMove, Change, WorldReader, Zone } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context, FlowResult } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import { cardsMoved } from '../cards/move';
import { assertLifetime } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';
import type { SkillHandle } from '../skills/skills';
import { skillAvailable } from '../skills/skills';
import { readState, stateChange, useCount } from '../state/state';
import { isGameOver } from '../game/end';

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

export interface PaymentSpec {
  readonly actor: string;
  readonly cards: readonly string[];
  readonly to: string;
  readonly reason: string;
  readonly skill?: SkillHandle;
  readonly limit?: UsageLimit;
  readonly areas?: readonly Zone['kind'][];
  readonly legal?: (ctx: Context) => boolean;
  readonly declaration?: unknown;
  /** 待决规则意图：费用提交前重查，同步确定后才开放支付后效；不写入事实。 */
  readonly intent?: PaymentIntent;
  readonly factKind?: string;
  readonly materialAllowed?: (ctx: Context, card: string, zone: Zone) => boolean;
  readonly changes?: readonly Change[];
}

export interface PaymentIntent {
  /** 纯查询；失效时不支付任何费用。 */
  available(ctx: Context): boolean;
  /** 费用已提交，尚未开放 cardsMoved/costPaid；必须同步，不可等待。 */
  committed(ctx: Context): void;
}

export interface PaymentReceipt {
  readonly actor: string;
  readonly cards: readonly string[];
  readonly reason: string;
  readonly skill: string | null;
  readonly instance: string | null;
  readonly declaration: unknown;
}

export type PaymentResult =
  | { readonly kind: 'paid'; readonly receipt: PaymentReceipt; readonly seq: number }
  | { readonly kind: 'unavailable'; readonly reason: string };

export const costPaid = defineWindow<PaymentReceipt>('cost.paid');

/** 费用、次数和宣告同步提交；支付后效完整结束后返回，不承诺整条技能事务回滚。 */
export function pay(ctx: Context, spec: PaymentSpec): Promise<FlowResult<PaymentResult>> {
  return ctx.flow(
    'pay',
    async (child) => {
      const intent = spec.intent;
      if (isGameOver(child.world)) return { kind: 'unavailable', reason: 'Game has finished.' };
      const limit = spec.limit;
      if (limit) {
        assertLifetime(child, limit.lifetime);
        if (!limit.key || !Number.isSafeInteger(limit.max) || limit.max < 0)
          throw new Error('Invalid usage limit.');
      }
      child.world.zone(spec.to);
      if (
        spec.skill
          ? spec.skill.owner !== spec.actor || !skillAvailable(child, spec.skill)
          : !child.world.player(spec.actor).alive
      )
        return { kind: 'unavailable', reason: 'Actor or skill is no longer available.' };
      if (limit && used(child.world, spec.actor, limit) >= limit.max)
        return { kind: 'unavailable', reason: 'Usage limit reached.' };
      if (spec.legal && !child.query(() => spec.legal?.(child)))
        return { kind: 'unavailable', reason: 'Final cost conditions changed.' };
      if (intent && !child.query(() => intent.available(child)))
        return { kind: 'unavailable', reason: 'Declaration is no longer available.' };
      const ids = immutable(spec.cards);
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !child.world.snapshot.cards.some((card) => card.id === id))
      )
        return { kind: 'unavailable', reason: 'Invalid cost materials.' };
      const before: Zone[] = [];
      const moves: CardMove[] = [];
      for (const id of ids) {
        const zone = child.world.zone(child.world.position(id));
        const allowed = spec.materialAllowed
          ? child.query(() => spec.materialAllowed?.(child, id, zone))
          : zone.owner === spec.actor && (spec.areas ?? ['hand', 'equipment']).includes(zone.kind);
        if (!allowed)
          return {
            kind: 'unavailable',
            reason: 'Cost materials are no longer owned or selectable.',
          };
        const existing = moves.find((move) => move.from === zone.id);
        if (existing)
          moves[moves.indexOf(existing)] = { ...existing, cards: [...existing.cards, id] };
        else {
          before.push(zone);
          moves.push({ cards: [id], from: zone.id, to: spec.to, place: 'bottom' });
        }
      }
      const changes: Change[] = moves.map((move) => ({ kind: 'move', ...move }));
      if (limit)
        changes.push(
          stateChange(
            child,
            useCount,
            usageTarget(spec.actor, limit),
            used(child.world, spec.actor, limit) + 1,
          ),
        );
      changes.push(...(spec.changes ?? []));
      const receipt = immutable({
        actor: spec.actor,
        cards: ids,
        reason: spec.reason,
        skill: spec.skill?.skill ?? null,
        instance: spec.skill?.id ?? null,
        declaration: spec.declaration ?? null,
      });
      const fact = child.commit(spec.factKind ?? 'cost.paid', changes, receipt);
      const declared: unknown = intent?.committed(child);
      if (declared !== null && typeof declared === 'object' && 'then' in declared) {
        void Promise.resolve(declared).catch(() => undefined);
        throw new Error('Payment declaration must be synchronous.');
      }
      if (moves.length)
        await child.window(
          cardsMoved,
          immutable({
            kind: 'moved',
            moves,
            before,
            after: child.world.snapshot.zones.filter(
              (zone) => zone.id === spec.to || before.some((old) => old.id === zone.id),
            ),
          }),
          { subject: receipt.actor },
        );
      await child.window(costPaid, receipt, { subject: receipt.actor });
      return { kind: 'paid', receipt, seq: fact.seq };
    },
    spec.reason,
  );
}
