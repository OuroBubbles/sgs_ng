import type { Context } from '../../core/runtime/room';
import type { Timing, Trigger, TriggerOccurrence } from '../../core/runtime/event';
import { isGameOver } from '../game/end';
import type { SkillHandle } from './skills';
import { declare, invoke } from './invoke';
import type { Declaration } from './invoke';

type Hook<T, R> = (ctx: Context, event: T, self: SkillHandle) => R;

/**
 * 一个时点上的触发：「谁 / 何时 / 询问或代价 / 宣告 / 效果」。
 * - 非锁定技默认由玩家安排顺序（order: 'choose'）；locked 不询问、自动排序；
 * - ask：询问「是否发动」后宣告；cost：先做选择（返回 null/false 视为不发动），再宣告；
 * - declare：宣告附带的数据、变更或代价；keep：宣告时的合法条件（与「未终局」一同检查）；
 * - 宣告即生效：其后条件改变或失去技能不撤销，只在终局时截断 effect。
 * 持续效果（带 skill 的标记）里的触发通常写 locked：它们不询问、不宣告。
 */
export interface TriggerSpec<T, V = true> {
  /** 默认使用时点 ID；同一技能中重名的处理器须显式区分。 */
  readonly id?: string;
  /** 事件的主体；仅当它是来源拥有者时触发。 */
  readonly who?: (event: T) => string | null | undefined;
  readonly when?: (ctx: Context, event: T, self: SkillHandle, at: TriggerOccurrence) => boolean;
  /** 本窗口有限次数的快照；每次独立重查、选择与结算。 */
  readonly times?: Hook<T, number>;
  /** 锁定技：不询问、不宣告、自动排序。 */
  readonly locked?: boolean;
  /** 覆盖默认排序（非锁定 choose，锁定 automatic）。 */
  readonly order?: 'automatic' | 'choose';
  readonly group?: string;
  /** 来源不再可用（失去、失效或拥有者阵亡）时仍可处理本次事件；不恢复所有权，只为本次结算提供发动资格。 */
  readonly retain?: Hook<T, boolean>;
  readonly ask?:
    | string
    | ((ctx: Context, event: T, self: SkillHandle, at: TriggerOccurrence) => string);
  readonly cost?: (
    ctx: Context,
    event: T,
    self: SkillHandle,
    at: TriggerOccurrence,
  ) => Promise<V | null | undefined | false>;
  readonly keep?: (ctx: Context, event: T, self: SkillHandle, value?: V) => boolean;
  readonly declare?: (
    ctx: Context,
    event: T,
    self: SkillHandle,
    value: V,
  ) => Declaration | Promise<Declaration>;
  readonly effect?: (
    ctx: Context,
    event: T,
    self: SkillHandle,
    value: V,
    at: TriggerOccurrence,
  ) => unknown;
}

/** on 的结果：触发声明，由规则目录绑定到具体技能实例。 */
export interface TriggerHook {
  readonly id: string;
  readonly window: object;
  bind(self: SkillHandle): Trigger<unknown>;
}

export function on<T, V = true>(window: Timing<T, unknown>, spec: TriggerSpec<T, V>): TriggerHook {
  const {
    id = window.id,
    who,
    when,
    times,
    locked,
    ask,
    cost,
    keep,
    declare: extra,
    effect,
  } = spec;
  if (!id) throw new Error('Trigger requires an ID.');
  const staged = ask !== undefined || cost !== undefined;
  const matches = (ctx: Context, payload: T, self: SkillHandle, at: TriggerOccurrence) =>
    (!who || who(payload) === self.owner) && (when?.(ctx, payload, self, at) ?? true);

  async function resolve(ctx: Context, payload: T, self: SkillHandle, at: TriggerOccurrence) {
    const going = (c: Context, value?: V) =>
      !isGameOver(c.world) && (keep?.(c, payload, self, value) ?? true);
    let value = true as V;
    if (cost) {
      const chosen = await cost(ctx, payload, self, at);
      if (chosen === null || chosen === undefined || chosen === false) return;
      value = chosen;
      const more = (await extra?.(ctx, payload, self, value)) ?? {};
      const declared = await declare(ctx, self, {
        ...more,
        legal: (c) => going(c, value) && (more.legal?.(c) ?? true),
      });
      if (!declared) return;
    } else if (ask !== undefined) {
      const prompt = typeof ask === 'string' ? ask : ask(ctx, payload, self, at);
      const declared = await invoke(
        ctx,
        self,
        prompt,
        (c) => going(c),
        extra && ((c) => extra(c, payload, self, value)),
      );
      if (!declared) return;
    }
    // 宣告即生效：其后失去技能、条件改变都不撤销，只有终局会截断。
    if (staged && isGameOver(ctx.world)) return;
    await effect?.(ctx, payload, self, value, at);
  }

  function bindSkill(self: SkillHandle): Trigger<unknown> {
    const available = (ctx: Context, payload: T) =>
      self.active(ctx) || (spec.retain?.(ctx, payload, self) ?? false);
    return {
      id: JSON.stringify([self.id, id]),
      owner: self.owner,
      ...(spec.group === undefined ? {} : { group: spec.group }),
      order: spec.order ?? (locked ? 'automatic' : 'choose'),
      ...(times === undefined
        ? {}
        : { times: (ctx: Context, payload: unknown) => times(ctx, payload as T, self) }),
      eligible: (ctx, payload, at) =>
        available(ctx, payload as T) && matches(ctx, payload as T, self, at),
      async run(ctx, payload, at) {
        // 本次结算的发动资格只属于这次结算及其子流程。
        let active = true;
        const bound: SkillHandle = Object.freeze({
          id: self.id,
          owner: self.owner,
          skill: self.skill,
          name: self.name,
          origin: self.origin,
          active: (c: Context) =>
            active &&
            c.world === ctx.world &&
            c.cause.scopePath.includes(ctx.scope.id) &&
            available(c, payload as T),
        });
        try {
          await resolve(ctx, payload as T, bound, at);
        } finally {
          active = false;
        }
      },
    };
  }

  return Object.freeze({
    id,
    window,
    bind: bindSkill,
  });
}
