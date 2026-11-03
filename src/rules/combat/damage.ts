import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineWindow } from '../../core/runtime/window';
import type { EffectRef, Nature } from '../cards/types';
import { effectReference } from '../cards/types';
import { enterDying } from './life';
import { isGameOver } from '../game/end';
import { chainChange, chainChanged, isChained } from './chain';
import { shieldOf, shieldChange, shieldChanged } from './shield';
import type { PaymentIntent } from '../costs/pay';

export type DamageOrigin =
  | { readonly kind: 'chain'; readonly damage: string }
  | { readonly kind: 'transfer'; readonly damage: string; readonly chain?: string };

export interface DamageTransfer {
  readonly to: string;
  readonly reason: string;
  /** 子伤害的身份；若派发前已中止则为 null，不恢复原目标伤害。 */
  readonly damage: string | null;
}
export type DamageTransferResult =
  | { readonly kind: 'transferred'; readonly damage: DamageResult }
  | { readonly kind: 'unavailable'; readonly damage: null };

/** 费用提交时确定原伤害已转移；费用后效结束后再结算接收方。 */
export interface DamageTransferIntent extends PaymentIntent {
  readonly data: {
    readonly damage: string;
    readonly player: string;
    readonly target: string;
    readonly reason: string;
  };
  resolve(ctx: Context): Promise<DamageTransferResult>;
}

interface Continuation {
  readonly sourceSnapshot: DamageInput;
  readonly shieldBypass: string | null;
  readonly started: (id: string) => void;
}

export interface DamageInput {
  readonly from: string | null;
  readonly to: string;
  readonly amount: number;
  readonly nature: Nature;
  readonly card?: EffectRef;
  readonly origin?: DamageOrigin;
  /** 默认火/雷传导。扩展属性或特殊伤害可明确覆盖，不把所有非普通属性都当成连环。 */
  readonly conducts?: boolean;
  /** 只忽略本次伤害的护盾，不沿连环自动传播。 */
  readonly bypassShield?: boolean;
}

export interface DamageEdit {
  readonly reason: string;
  readonly before: number;
  readonly after: number;
}

export interface DamageDraft {
  readonly id: string;
  readonly input: DamageInput;
  readonly amount: number;
  readonly prevented: boolean;
  readonly pending: boolean;
  readonly sourceSnapshot: DamageInput | null;
  readonly shieldBypass: string | null;
  adjust(delta: number, reason: string): void;
  setAmount(amount: number, reason: string): void;
  prevent(reason: string): void;
  ignoreShield(reason: string): void;
  canTransfer(ctx: Context, to: string): boolean;
  prepareTransfer(ctx: Context, to: string, reason: string): DamageTransferIntent;
  transfer(ctx: Context, to: string, reason: string): Promise<DamageTransferResult>;
}

export interface DamageResult {
  readonly id: string;
  readonly kind: 'dealt' | 'prevented' | 'zero' | 'unavailable' | 'transferred';
  readonly input: DamageInput;
  readonly sourceSnapshot: DamageInput;
  readonly amount: number;
  readonly hpLoss: number;
  readonly shieldLost: number;
  readonly beforeShield: number;
  readonly afterShield: number;
  readonly shieldBypass: string | null;
  readonly beforeHp: number;
  readonly afterHp: number;
  readonly edits: readonly DamageEdit[];
  readonly prevention: string | null;
  readonly unchained: boolean;
  /** 提交伤害时冻结的计划；各目标执行前还会重查存活/连环，未必都实际受伤。 */
  readonly chainPlan: readonly string[];
  readonly transfer: DamageTransfer | null;
}

/** 牌的直接伤害与传播伤害分开；牌关联仍保留，供奸雄、日志等读取。 */
export function isDirectDamage(input: DamageInput): boolean {
  return input.origin === undefined;
}

function chainOrigin(input: DamageInput): string | undefined {
  return input.origin?.kind === 'chain' ? input.origin.damage : input.origin?.chain;
}

/** 传播被转移后仍属于原传播，不能因此重新扩张连环计划。 */
export function isChainDamage(input: DamageInput): boolean {
  return chainOrigin(input) !== undefined;
}

export const damageCausing = defineWindow<DamageDraft>('damage.causing');
export const damageReplacing = defineWindow<DamageDraft>('damage.replacing');
export const damageInflicting = defineWindow<DamageDraft>('damage.inflicting');
export const damageDealt = defineWindow<DamageResult>('damage.dealt');
export const damageReceived = defineWindow<DamageResult>('damage.received');
export const damageSettled = defineWindow<DamageResult>('damage.settled');

class Draft implements DamageDraft {
  #amount: number;
  #open = true;
  #prevention: string | null = null;
  #sourceSnapshot: DamageInput | null = null;
  #edits: DamageEdit[] = [];
  #shieldBypass: string | null;
  #redirection: DamageTransfer | null = null;

  constructor(
    readonly id: string,
    readonly input: DamageInput,
    private readonly ctx: Context,
    continuation?: Continuation,
  ) {
    this.#amount = input.amount;
    this.#shieldBypass = continuation?.shieldBypass ?? (input.bypassShield ? 'request' : null);
    this.#sourceSnapshot = continuation?.sourceSnapshot ?? null;
  }
  get amount(): number {
    return this.#amount;
  }
  get prevented(): boolean {
    return this.#prevention !== null;
  }
  get pending(): boolean {
    return this.#open && !this.prevented && this.#redirection === null;
  }
  get redirection(): DamageTransfer | null {
    return this.#redirection;
  }
  get sourceSnapshot(): DamageInput | null {
    return this.#sourceSnapshot;
  }
  get shieldBypass(): string | null {
    return this.#shieldBypass;
  }

  ignoreShield(reason: string): void {
    this.ctx.assertActive();
    if (!this.#open || !reason.trim()) throw new Error('Invalid or sealed shield bypass.');
    this.#shieldBypass ??= reason;
  }

  adjust(delta: number, reason: string): void {
    if (!Number.isSafeInteger(delta)) throw new Error('Damage adjustment must be an integer.');
    this.setAmount(Math.max(0, this.#amount + delta), reason);
  }

  setAmount(amount: number, reason: string): void {
    this.ctx.assertActive();
    if (!this.#open) throw new Error('Damage draft is already sealed.');
    if (!Number.isSafeInteger(amount) || amount < 0 || !reason)
      throw new Error('Invalid damage edit.');
    this.#edits.push({ before: this.#amount, after: amount, reason });
    this.#amount = amount;
  }

  prevent(reason: string): void {
    this.ctx.assertActive();
    if (!this.#open || !reason) throw new Error('Invalid damage prevention.');
    this.#prevention = reason;
  }

  snapshotSource(): void {
    this.#sourceSnapshot = immutable({ ...this.input, amount: this.#amount });
  }

  canTransfer(ctx: Context, to: string): boolean {
    return ctx.query(
      () =>
        this.ctx.scope.active &&
        ctx.world === this.ctx.world &&
        ctx.cause.scopePath.includes(this.ctx.scope.id) &&
        this.pending &&
        this.#sourceSnapshot !== null &&
        this.#amount > 0 &&
        to !== this.input.to &&
        ctx.world.player(this.input.to).alive &&
        ctx.world.snapshot.players.some((player) => player.id === to && player.alive) &&
        !isGameOver(ctx.world),
    );
  }

  transfer(ctx: Context, to: string, reason: string): Promise<DamageTransferResult> {
    return ctx.flow<DamageTransferResult>('damage.transfer', async (at) => {
      const intent = this.prepareTransfer(at, to, reason);
      if (!intent.available(at)) return { kind: 'unavailable', damage: null };
      intent.committed(at);
      return await intent.resolve(at);
    });
  }

  #assertTransferContext(ctx: Context): void {
    ctx.assertActive();
    if (
      !this.ctx.scope.active ||
      ctx.world !== this.ctx.world ||
      !ctx.cause.scopePath.includes(this.ctx.scope.id)
    )
      throw new Error('Damage transfer requires its active descendant Context.');
  }

  prepareTransfer(ctx: Context, to: string, reason: string): DamageTransferIntent {
    this.#assertTransferContext(ctx);
    const sourceSnapshot = this.#sourceSnapshot;
    if (sourceSnapshot === null) throw new Error('Damage source stage has not completed.');
    if (!reason.trim()) throw new Error('Damage transfer requires a reason.');
    const data = immutable({ damage: this.id, player: this.input.to, target: to, reason });
    let declared = false;
    let executed = false;
    let amount = this.#amount;

    return Object.freeze({
      data,
      available: (at: Context) => !declared && this.canTransfer(at, to),
      committed: (at: Context) => {
        this.#assertTransferContext(at);
        if (declared || !this.pending)
          throw new Error('Damage transfer is already declared or closed.');
        declared = true;
        amount = this.#amount;
        this.#redirection = immutable({ to, reason, damage: null });
        this.#open = false;
        at.commit('damage.transferring', [], { ...data, amount });
      },
      resolve: (at: Context) =>
        at.flow<DamageTransferResult>('damage.transfer.resolve', async (inside) => {
          this.#assertTransferContext(inside);
          if (!declared || executed) return { kind: 'unavailable', damage: null };
          executed = true;
          const chain = chainOrigin(this.input);
          const outcome = await resolveDamage(
            inside,
            {
              ...this.input,
              to,
              amount,
              origin: {
                kind: 'transfer',
                damage: this.id,
                ...(chain === undefined ? {} : { chain }),
              },
            },
            {
              sourceSnapshot,
              shieldBypass: this.#shieldBypass,
              started: (id) => {
                this.#redirection = immutable({ to, reason, damage: id });
              },
            },
          );
          return { kind: 'transferred', damage: outcome };
        }),
    });
  }

  seal(
    kind: DamageResult['kind'],
    beforeHp: number,
    beforeShield: number,
    unchained = false,
    chainPlan: readonly string[] = [],
  ): DamageResult {
    this.#open = false;
    const shieldLost =
      kind === 'dealt' && this.#shieldBypass === null ? Math.min(beforeShield, this.#amount) : 0;
    const hpLoss = kind === 'dealt' ? this.#amount - shieldLost : 0;
    return immutable({
      id: this.id,
      kind,
      input: this.input,
      sourceSnapshot: this.#sourceSnapshot ?? this.input,
      amount: this.#amount,
      hpLoss,
      shieldLost,
      beforeShield,
      afterShield: beforeShield - shieldLost,
      shieldBypass: this.#shieldBypass,
      beforeHp,
      afterHp: beforeHp - hpLoss,
      edits: this.#edits,
      prevention: this.#prevention,
      unchained,
      chainPlan,
      transfer: this.#redirection,
    });
  }
}

/** 提交伤害并完整处理濒死/后效，再按固定计划传导；各次有独立草案，不共享防御结果。 */
export function damage(ctx: Context, request: DamageInput): Promise<DamageResult> {
  return resolveDamage(ctx, request);
}

function resolveDamage(
  ctx: Context,
  request: DamageInput,
  continuation?: Continuation,
): Promise<DamageResult> {
  return ctx.flow('damage', async (child) => {
    const input = immutable({
      ...request,
      ...(request.card === undefined ? {} : { card: effectReference(request.card) }),
    });
    if (!Number.isSafeInteger(input.amount) || input.amount < 1)
      throw new Error('Damage requires a positive integer.');
    if (
      typeof input.nature !== 'string' ||
      !input.nature.trim() ||
      (input.conducts !== undefined && typeof input.conducts !== 'boolean') ||
      (input.bypassShield !== undefined && typeof input.bypassShield !== 'boolean') ||
      (input.origin !== undefined &&
        (!['chain', 'transfer'].includes(input.origin.kind) ||
          typeof input.origin.damage !== 'string' ||
          !input.origin.damage.trim() ||
          (input.origin.kind === 'transfer' &&
            input.origin.chain !== undefined &&
            (typeof input.origin.chain !== 'string' || !input.origin.chain.trim()))))
    )
      throw new Error('Invalid damage nature or origin.');
    if (input.from !== null) child.world.player(input.from);
    const draft = new Draft(child.cause.flowId, input, child, continuation);
    continuation?.started(draft.id);
    if (isGameOver(child.world))
      return draft.seal(
        'unavailable',
        child.world.player(input.to).hp,
        shieldOf(child.world, input.to),
      );
    if (child.world.player(input.to).alive) {
      const active = (at: Context) =>
        draft.pending && at.world.player(input.to).alive && !isGameOver(at.world);
      if (!continuation) {
        await child.window(damageCausing, draft, {
          ...(input.from === null ? {} : { subject: input.from }),
          active,
        });
        draft.snapshotSource();
      }
      if (
        !continuation &&
        draft.pending &&
        draft.amount > 0 &&
        child.world.player(input.to).alive &&
        !isGameOver(child.world)
      )
        await child.window(damageReplacing, draft, {
          ...(input.from === null ? {} : { subject: input.from }),
          active,
        });
      if (draft.pending) await child.window(damageInflicting, draft, { subject: input.to, active });
    }

    const target = child.world.player(input.to);
    const kind =
      draft.redirection !== null
        ? 'transferred'
        : !target.alive || isGameOver(child.world)
          ? 'unavailable'
          : draft.prevented
            ? 'prevented'
            : draft.amount === 0
              ? 'zero'
              : 'dealt';
    const conducts = input.conducts ?? (input.nature === 'fire' || input.nature === 'thunder');
    const unchained = kind === 'dealt' && conducts && isChained(child.world, input.to);
    const chainPlan =
      unchained && !isChainDamage(input)
        ? child
            .actionOrder(input.to)
            .filter(
              (player) =>
                player !== input.to &&
                child.world.player(player).alive &&
                isChained(child.world, player),
            )
        : [];
    const result = draft.seal(
      kind,
      target.hp,
      shieldOf(child.world, input.to),
      unchained,
      chainPlan,
    );
    if (kind === 'dealt') {
      const fact = child.commit(
        'damage.dealt',
        [
          { kind: 'vitality', player: input.to, hp: result.afterHp },
          ...(unchained ? [chainChange(child, input.to, false)] : []),
          ...(result.shieldLost ? [shieldChange(child, input.to, result.afterShield)] : []),
        ],
        result,
      );
      if (result.shieldLost)
        await child.window(
          shieldChanged,
          immutable({
            player: input.to,
            before: result.beforeShield,
            after: result.afterShield,
            amount: -result.shieldLost,
            reason: 'damage',
            damage: result.id,
          }),
          { subject: input.to },
        );
      if (unchained)
        await child.window(
          chainChanged,
          immutable({
            player: input.to,
            before: true,
            after: false,
            reason: result.id,
          }),
          { subject: input.to },
        );
      if (result.hpLoss > 0 && result.afterHp <= 0) {
        await enterDying(child, {
          player: input.to,
          killer: input.from,
          cause: { kind: 'damage', seq: fact.seq, data: result },
        });
      }
      if (!isGameOver(child.world)) {
        await child.window(damageDealt, result, input.from === null ? {} : { subject: input.from });
        await child.window(damageReceived, result, { subject: input.to });
      }
    } else {
      child.commit(`damage.${kind}`, [], result);
    }
    await child.window(damageSettled, result, { subject: input.to });
    for (const player of result.chainPlan) {
      if (isGameOver(child.world)) break;
      if (!child.world.player(player).alive || !isChained(child.world, player)) continue;
      await damage(child, {
        from: input.from,
        to: player,
        amount: result.amount,
        nature: input.nature,
        ...(input.card === undefined ? {} : { card: input.card }),
        ...(input.conducts === undefined ? {} : { conducts: input.conducts }),
        origin: { kind: 'chain', damage: result.id },
      });
    }
    return result;
  });
}
