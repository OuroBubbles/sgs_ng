/**
 * 作者门面：在内核原语之上提供武将/技能的高层写法。
 * - trigger：「谁 / 何时 / 询问或代价 / 宣告 / 效果」分段，发动记录与终局重查由引擎负责；
 * - action：出牌阶段主动技能，声明选牌、选目标、次数与代价；
 * - convert：视为技；
 * - 动词：obtain / takeCard / give / askDiscard / select，自带存活与终局 no-op。
 */
import type { Context } from '../core/runtime/room';
import type { TriggerOccurrence } from '../core/runtime/event';
import { JointSelection } from '../core/decisions/selection';
import type { JointChoice, JointSelectionSpec } from '../core/decisions/selection';
import type { Decision } from '../core/decisions/hub';
import type { CardMove, Zone } from '../core/model/state';
import { isGameOver } from './game/end';
import { CardEvent, Cards, moveCards } from './cards/move';
import type { MoveDeclaration, MoveResult } from './cards/move';
import { ownedCards } from './cards/types';
import type { ViewAs, ViewAsInput } from './cards/types';
import type { PhysicalCardFace } from './cards/face';
import { payDiscard, used } from './costs/pay';
import { rulesOf } from './skills/skills';
import type { SkillDefinition, SkillHandle } from './skills/skills';
import type { ActiveInput, ActiveSkill } from './skills/active';
import { declare } from './skills/invoke';
import type { Declaration } from './skills/invoke';
import type { GeneralDefinition } from './characters/general';
import { genderOf } from './characters/gender';
import type { Gender } from './characters/gender';
import { kingdomOf } from './characters/kingdom';
import type { JudgmentResult } from './cards/judge';
import { readState } from './state/state';
import { activeTarget, activeTurn } from './turn/state';
import type { PhaseView } from './turn/turn';
import { Judgment } from './cards/judge';

export type Areas = readonly Zone['kind'][];
/** 手牌与装备区。 */
export const HE: Areas = ['hand', 'equipment'];

// ───────────────────────── 查询

export const alive = (ctx: Context, player: string): boolean => ctx.world.player(player).alive;
/** 本局行动顺序中除 owner 外的席位（含已阵亡者，由调用者筛选）。 */
export const others = (ctx: Context, owner: string): readonly string[] =>
  ctx.actionOrder(owner).filter((id) => id !== owner);
/** 存活的其他角色，按座位顺序。 */
export const otherAlive = (ctx: Context, owner: string): readonly string[] =>
  ctx.world.snapshot.players.filter((p) => p.alive && p.id !== owner).map((p) => p.id);
/** 当前牌面（含锁定视为）。 */
export const face = (ctx: Context, card: string, judgmentPlayer?: string) =>
  rulesOf(ctx).face(ctx, card, judgmentPlayer);
/** 牌名（如 standard:slash）对应的定义。 */
export const cardDef = (ctx: Context, name: string) => rulesOf(ctx).definition(name);
/** 实体牌的印刷名。 */
export const cardLabel = (ctx: Context, card: string): string =>
  rulesOf(ctx).definition(ctx.world.card(card).name).label;
export const handOf = (ctx: Context, player: string): string =>
  ctx.world.snapshot.zones.find((zone) => zone.owner === player && zone.kind === 'hand')!.id;
export const canDiscard = (ctx: Context, actor: string, card: string, reason: string) =>
  rulesOf(ctx).canDiscard(ctx, { actor, owner: actor, card, reason });
/** actor 自己可以弃置的牌。 */
export const discardable = (ctx: Context, actor: string, reason: string, areas: Areas = ['hand']) =>
  ownedCards(ctx.world, actor, areas).filter((card) => canDiscard(ctx, actor, card, reason));

export const wounded = (ctx: Context, player: string): boolean => {
  const seat = ctx.world.player(player);
  return seat.hp < seat.maxHp;
};
export const isMale = (ctx: Context, player: string): boolean =>
  ['male', 'dual'].includes(genderOf(ctx.world, player));
/** 存活的其他同势力角色，按行动顺序。 */
export const peers = (ctx: Context, owner: string, kingdom: string): readonly string[] =>
  others(ctx, owner).filter((id) => alive(ctx, id) && kingdomOf(ctx.world, id) === kingdom);
/** 当前回合角色；不在回合内时为 null。 */
export const turnOwner = (ctx: Context): string | null =>
  readState(ctx.world, activeTurn, activeTarget)?.owner ?? null;
/** 多次触发时的进度后缀，如「（第 1/2 次）」。 */
export const nth = (at: TriggerOccurrence): string =>
  at.total > 1 ? `（第 ${at.index}/${at.total} 次）` : '';

// ───────────────────────── 动词

/** 牌从当前位置进入 player 的手牌；接收者阵亡或终局时不移动。 */
export async function obtain(
  ctx: Context,
  player: string,
  cards: string | readonly string[],
  reason: string,
  fact?: MoveDeclaration,
): Promise<MoveResult | null> {
  const ids = typeof cards === 'string' ? [cards] : cards;
  if (!ids.length || !alive(ctx, player) || isGameOver(ctx.world)) return null;
  const to = handOf(ctx, player);
  const moves: (CardMove & { cards: string[] })[] = [];
  for (const card of ids) {
    const from = ctx.world.position(card);
    const move = moves.find((entry) => entry.from === from);
    if (move) move.cards.push(card);
    else moves.push({ cards: [card], from, to, place: 'bottom' });
  }
  return moveCards(ctx, moves, reason, fact);
}

/** actor 获得 target 区域中已选定的一张牌（card.taken）；非手牌公开。 */
export function takeCard(
  ctx: Context,
  input: { actor: string; target: string; card: string; from: string; reason: string },
) {
  const { actor, target, card, from, reason } = input;
  if (ctx.world.position(card) !== from) return Promise.resolve(null);
  const open = ctx.world.zone(from).kind !== 'hand';
  return obtain(ctx, actor, card, reason, {
    kind: CardEvent.taken,
    data: { actor, target, card, open, reason },
  });
}

/** player 获得仍在处理区中的判定牌（judgment.card-obtained）。 */
export function obtainJudgment(
  ctx: Context,
  player: string,
  judgment: JudgmentResult,
  reason: string,
) {
  const card = judgment.card;
  if (!card || ctx.world.position(card.id) !== judgment.processing) return Promise.resolve(null);
  return obtain(ctx, player, card.id, reason, {
    kind: Judgment.cardObtained,
    data: { judgment: judgment.id, player, reason, card: card.id },
  });
}

/** actor 将牌交给 target（cards.given）；visible 时公开牌面。 */
export function give(
  ctx: Context,
  input: {
    actor: string;
    target: string;
    cards: readonly string[];
    reason: string;
    visible?: boolean;
  },
) {
  const { actor, target, cards, reason, visible } = input;
  return obtain(ctx, target, cards, reason, {
    kind: Cards.given,
    data: {
      actor,
      target,
      count: cards.length,
      ...(visible ? { cards, visible } : {}),
      reason,
    },
  });
}

export interface AskOptions {
  readonly reason?: string;
  /** 取消按钮文字；提供即表示可取消。 */
  readonly cancel?: string;
  readonly optional?: boolean;
  /** 在默认描述上追加给界面 / AI 的字段。 */
  readonly describe?: () => Record<string, unknown>;
}
/** 选择结果，valid() 按当前局面重新校验。 */
export type Picked = JointChoice & { readonly valid: () => boolean };

/** 让 player 在一个联合选择上作答；放弃或无效时返回 null。默认可取消。 */
export async function select(
  ctx: Context,
  player: string,
  model: JointSelection,
  prompt: string,
  options: AskOptions = {},
): Promise<Picked | null> {
  const decision: Decision<JointChoice> = model.decision(player, prompt, {
    optional: options.optional ?? true,
    ...(options.cancel === undefined ? {} : { cancelLabel: options.cancel }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  });
  const extra = options.describe;
  const answer = await ctx.ask(
    extra
      ? {
          ...decision,
          describe: () => ({ ...(decision.describe!() as Record<string, unknown>), ...extra() }),
        }
      : decision,
  );
  if (answer.kind !== 'chosen') return null;
  const choice = answer.value;
  return { ...choice, valid: () => model.validate(choice).ok };
}

/** 构造联合选择：cards / targets 直接返回 ID 列表，牌以印刷名作标签。 */
export function selection(ctx: Context, spec: JointSelectionSpec): JointSelection {
  const { cards } = spec;
  if (!cards) return new JointSelection(spec);
  return new JointSelection({
    ...spec,
    cards: () =>
      cards().map((card) =>
        typeof card === 'string' ? { id: card, label: cardLabel(ctx, card) } : card,
      ),
  });
}

/** 令 player 弃置 count 张牌；可拒绝。返回是否确实弃置。 */
export async function askDiscard(
  ctx: Context,
  player: string,
  spec: AskOptions & {
    readonly count: number;
    readonly prompt: string;
    readonly reason: string;
    readonly areas?: Areas;
  },
): Promise<boolean> {
  const { count, prompt, reason, areas = ['hand'] } = spec;
  const live = () => alive(ctx, player) && !isGameOver(ctx.world);
  if (!live()) return false;
  const model = selection(ctx, {
    cards: () => (live() ? discardable(ctx, player, reason, areas) : []),
    cardCount: { min: count, max: count },
  });
  const picked = await select(ctx, player, model, prompt, spec);
  if (!picked) return false;
  const paid = await payDiscard(ctx, {
    actor: player,
    cards: picked.cards,
    areas,
    reason,
    factKind: Cards.discarded,
    legal: () => live() && picked.valid(),
  });
  return paid.kind === 'paid';
}

// ───────────────────────── 触发技

// ───────────────────────── 主动技

export interface ActionContext extends ActiveInput {
  readonly cards: readonly string[];
  readonly targets: readonly string[];
}
type CountSpec = number | readonly [number, number | 'all'];
const count = (spec: CountSpec) =>
  typeof spec === 'number' ? { min: spec, max: spec } : { min: spec[0], max: spec[1] };

/** 出牌阶段主动技：声明式选牌 / 选目标 / 每阶段次数 / 代价，然后 effect。 */
export interface ActionSpec {
  readonly id: string;
  readonly label?: string;
  /** 每个出牌阶段的发动次数上限。 */
  readonly limit?: number;
  readonly when?: (ctx: Context, input: ActiveInput) => boolean;
  readonly cards?: {
    readonly count: CountSpec;
    readonly areas?: Areas;
    /** 只列出可被自己弃置的牌（代价为弃牌时默认开启）。 */
    readonly discardable?: boolean;
    readonly filter?: (ctx: Context, card: string, input: ActiveInput) => boolean;
  };
  readonly targets?: {
    readonly count: CountSpec;
    /** 候选默认是存活角色（按座位）；filter 进一步筛选。 */
    readonly filter?: (ctx: Context, player: string, input: ActiveInput) => boolean;
  };
  /** 选中的牌如何作为代价：弃置，或交给唯一目标。 */
  readonly pay?: 'discard' | 'give';
  /** 需要跨牌和目标的联合约束时，直接给出完整选择。 */
  readonly selection?: (ctx: Context, input: ActiveInput) => JointSelection;
  readonly declare?: (ctx: Context, input: ActionContext) => Declaration;
  readonly effect: (ctx: Context, input: ActionContext) => unknown;
}

const phaseLimit = (self: SkillHandle, phase: PhaseView, id: string, max: number) => ({
  key: id,
  source: self.skill,
  lifetime: phase.lifetime,
  max,
});

export function action(spec: ActionSpec): ActiveSkill {
  const { id, label, limit, when, cards, targets, pay, effect } = spec;
  const key = (self: SkillHandle) => self.skill.split(':').pop()!;
  const live = (ctx: Context, { self, phase }: ActiveInput) =>
    alive(ctx, self.owner) && !phase.turn?.ended && !isGameOver(ctx.world);
  const build = (ctx: Context, input: ActiveInput): JointSelection => {
    if (spec.selection) return spec.selection(ctx, input);
    const { self } = input;
    const discardOnly = cards?.discardable ?? pay === 'discard';
    return new JointSelection({
      ...(cards
        ? {
            cards: () =>
              live(ctx, input)
                ? ownedCards(ctx.world, self.owner, cards.areas ?? ['hand'])
                    .filter(
                      (card) =>
                        (!discardOnly || canDiscard(ctx, self.owner, card, self.skill)) &&
                        (cards.filter?.(ctx, card, input) ?? true),
                    )
                    .map((card) => ({ id: card, label: ctx.world.card(card).name }))
                : [],
            cardCount: count(cards.count),
          }
        : {}),
      ...(targets
        ? {
            targets: () =>
              live(ctx, input)
                ? ctx.world.snapshot.players
                    .filter((p) => p.alive && (targets.filter?.(ctx, p.id, input) ?? true))
                    .map((p) => p.id)
                : [],
            targetCount: count(targets.count),
          }
        : {}),
    });
  };
  return {
    id,
    ...(label === undefined ? {} : { label }),
    ...(limit !== undefined || when
      ? {
          available: (ctx: Context, input: ActiveInput) =>
            (limit === undefined ||
              used(
                ctx.world,
                input.self.owner,
                phaseLimit(input.self, input.phase, key(input.self), limit),
              ) < limit) &&
            (when?.(ctx, input) ?? true),
        }
      : {}),
    ...(cards || targets || spec.selection ? { selection: build } : {}),
    async run(ctx, input) {
      const { self, phase, choice, selection: model } = input;
      const args: ActionContext = {
        self,
        phase,
        book: input.book,
        cards: choice.cards,
        targets: choice.targets,
      };
      const more = spec.declare?.(ctx, args) ?? {};
      const declared = await declare(ctx, self, {
        ...more,
        data: { ...(choice.targets.length ? { targets: choice.targets } : {}), ...more.data },
        ...(limit === undefined ? {} : { limit: phaseLimit(self, phase, key(self), limit) }),
        ...(pay === 'discard' ? { discard: choice.cards, areas: cards?.areas ?? ['hand'] } : {}),
        ...(pay === 'give'
          ? {
              give: { cards: choice.cards, to: handOf(ctx, choice.targets[0]!) },
              areas: cards?.areas ?? ['hand'],
            }
          : {}),
        legal: (at) => model.validate(choice).ok && (more.legal?.(at) ?? true),
      });
      if (declared && !isGameOver(ctx.world)) await effect(ctx, args);
    },
  };
}

// ───────────────────────── 视为技

/** 将一张符合条件的自有牌当作 as 使用或打出。 */
export function convert(
  id: string,
  spec: {
    readonly as: string;
    readonly match: (card: PhysicalCardFace) => boolean;
    readonly areas?: Areas;
    readonly label?: string;
    readonly when?: (ctx: Context, input: ViewAsInput) => boolean;
  },
): ViewAs {
  return {
    id,
    ...(spec.label === undefined ? {} : { label: spec.label }),
    count: { min: 1, max: 1 },
    ...(spec.when ? { available: spec.when } : {}),
    materials: (ctx, { self }) =>
      ownedCards(ctx.world, self.owner, spec.areas ?? ['hand']).filter((card) =>
        spec.match(face(ctx, card)),
      ),
    make: { name: spec.as },
  };
}

// ───────────────────────── 技能与武将

/** 技能定义；类型检查用，原样返回。 */
export const skill = <const S extends SkillDefinition>(definition: S): S => definition;

export interface AuthoredGeneral extends GeneralDefinition {
  /** 由内容装配自动登记的技能定义。 */
  readonly abilities: readonly SkillDefinition[];
}
/** 一个武将：直接引用技能对象，装配时自动登记；性别默认男性。 */
export function general(spec: {
  readonly id: string;
  readonly name: string;
  readonly kingdom: string;
  readonly hp: number;
  readonly gender?: Gender;
  readonly skills: readonly SkillDefinition[];
}): AuthoredGeneral {
  return {
    id: spec.id,
    name: spec.name,
    kingdom: spec.kingdom,
    gender: spec.gender ?? 'male',
    maxHp: spec.hp,
    skills: spec.skills.map((entry) => entry.id),
    abilities: spec.skills,
  };
}
