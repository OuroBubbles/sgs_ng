import type { Validation } from '../../core/decisions/hub';
import { normalizeChoiceCount } from '../../core/decisions/count';
import type { ChoiceCount } from '../../core/decisions/count';
import { immutable, isStringArray } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { cardDef, defineSkill, queryRule, rulesOf } from '../skills/skills';
import { isGameOver } from '../game/end';
import * as queries from './queries';
import { face } from './face';
import { isResponseProhibited } from './rule';
import { colorOfSuit, ownedCards } from './types';
import type {
  CardChoice,
  CardDefinition,
  CardFace,
  Purpose,
  SemanticCard,
  UseTiming,
  ViewAs,
  ViewAsInput,
} from './types';

/** 一项可选的牌：手中实体牌或当前可用的视为配方。 */
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

export const invalid = (reason: string): { readonly ok: false; readonly reason: string } => ({
  ok: false,
  reason,
});
export const countValid = (count: ChoiceCount, selected: number, total: number): boolean =>
  selected >= count.min && selected <= (count.max === 'all' ? total : count.max);

/** 校验牌定义后直接使用声明本身：不复制、不冻结、不绑定方法。 */
export function defineCard(definition: CardDefinition): CardDefinition {
  const { id, type, nature, equipment, use } = definition;
  if (!id) throw new Error('Duplicate or empty card definition.');
  if (!['basic', 'trick', 'equipment'].includes(type))
    throw new Error('Card definition requires an explicit type.');
  if (nature !== undefined && (typeof nature !== 'string' || !nature.trim()))
    throw new Error('Card nature must be a nonempty string.');
  if (equipment?.skill) defineSkill(equipment.skill);
  if (use) {
    if (!use.resolve && !use.execute) throw new Error('A usable card requires resolve or execute.');
    normalizeChoiceCount(use.count, `${id} target`);
  }
  return definition;
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

/** 这种牌能否用于该用途：打出看 response，使用看 use 与时机。 */
export function supports(ctx: Context, name: string, purpose: Purpose | UseTiming): boolean {
  const definition = rulesOf(ctx).cards.get(name);
  if (purpose === 'response') return definition?.response === true;
  const rules = definition?.use;
  return (
    !!rules &&
    (typeof purpose === 'string' || !rules.timings || rules.timings.includes(purpose.kind))
  );
}

/** 实体牌的语义牌面，不附带用牌/响应牌型资格，也不虚构持有权。 */
export function physicalCard(ctx: Context, id: string): SemanticCard {
  return ctx.query(() => {
    const card = face(ctx, id);
    return immutable({
      name: card.name,
      suit: card.suit,
      rank: card.rank,
      color: card.color,
      nature: rulesOf(ctx).cards.get(card.name)?.nature ?? 'normal',
      materials: [id],
      source: null,
    });
  });
}

function recipeCount(ctx: Context, input: ViewAsInput, recipe: ViewAs): ChoiceCount {
  if (typeof recipe.count !== 'function') return recipe.count ?? { min: 0, max: 0 };
  return normalizeChoiceCount(
    recipe.count(ctx, input),
    `${input.self.skill}/${recipe.id} material`,
  );
}
function recipeNames(ctx: Context, input: ViewAsInput, recipe: ViewAs): readonly string[] {
  return typeof recipe.make === 'function' ? recipe.names!(ctx, input) : [recipe.make.name];
}

/** 由一次选择构造语义牌：实体牌、视为配方或规则生成；同时检查用途与禁令。 */
export function buildCard(
  ctx: Context,
  actor: string,
  choice: CardChoice,
  purpose: Purpose,
): Validation<SemanticCard> {
  return ctx.query(() => build(ctx, actor, choice, purpose));
}

function build(
  ctx: Context,
  actor: string,
  choice: CardChoice,
  purpose: Purpose,
): Validation<SemanticCard> {
  if (!ctx.world.player(actor).alive || isGameOver(ctx.world))
    return invalid('Actor or game is no longer active.');
  if (choice.kind !== 'physical' && !isStringArray(choice.materials))
    return invalid('Expected material IDs.');
  let made: CardFace;
  let materials: readonly string[];
  let source: SemanticCard['source'] = null;
  if (choice.kind === 'physical') {
    if (!ownedCards(ctx.world, actor).includes(choice.card))
      return invalid("Physical card is not in this actor's hand.");
    made = face(ctx, choice.card);
    materials = [choice.card];
  } else if (choice.kind === 'generated') {
    if (!choice.reason) return invalid('Generated card requires a reason.');
    made = choice.face;
    materials = choice.materials;
    source = {
      kind: 'generated',
      reason: choice.reason,
      ...(choice.origin ? { origin: immutable(choice.origin) } : {}),
    };
  } else {
    const binding = rulesOf(ctx).binding(ctx.world, choice.instance);
    if (!binding || binding.self.owner !== actor || !binding.self.active(ctx))
      return invalid('View-as skill is no longer available.');
    const { self, definition } = binding;
    const recipe = definition.viewAs?.find((item) => item.id === choice.recipe);
    if (!recipe) return invalid('Unknown view-as recipe.');
    const input: ViewAsInput = { self, purpose };
    if (recipe.available && !recipe.available(ctx, input))
      return invalid('Recipe is unavailable here.');
    const candidates = recipe.materials?.(ctx, input) ?? [];
    if (
      !countValid(recipeCount(ctx, input, recipe), choice.materials.length, candidates.length) ||
      choice.materials.some((id) => !candidates.includes(id))
    )
      return invalid('Invalid recipe materials.');
    const result =
      typeof recipe.make === 'function'
        ? recipe.make(ctx, {
            ...input,
            materials: choice.materials,
            parameters: choice.parameters ?? null,
          })
        : recipe.make;
    if (!result || !recipeNames(ctx, input, recipe).includes(result.name))
      return invalid('Recipe could not construct this card.');
    made = result;
    materials = choice.materials;
    source = { kind: 'viewAs', skill: self.skill, instance: self.id, recipe: recipe.id };
  }
  if (
    new Set(materials).size !== materials.length ||
    materials.some((id) => !ctx.world.snapshot.cards.some((card) => card.id === id))
  )
    return invalid('Duplicate or unknown material.');
  if (!supports(ctx, made.name, purpose)) return invalid('Card is unavailable for this purpose.');
  // 同次构牌复用实体牌面；转换和生成牌的材料仍按当前状态读取。
  const faces = choice.kind === 'physical' ? [made] : materials.map((id) => face(ctx, id));
  const first = faces.length === 1 ? faces[0]! : null;
  const suit = made.suit ?? first?.suit ?? 'none';
  const colors = faces.map((card) => card.color);
  const materialColor =
    colors.length && colors.every((color) => color === colors[0]) ? colors[0]! : 'none';
  const card: SemanticCard = immutable({
    name: made.name,
    suit,
    color:
      made.color ??
      (made.suit === undefined
        ? (first?.color ?? materialColor)
        : suit === 'none'
          ? materialColor
          : colorOfSuit(suit)),
    rank: made.rank ?? first?.rank ?? 0,
    nature: made.nature ?? cardDef(ctx, made.name).nature ?? 'normal',
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
      ? queryRule(ctx, queries.prohibitUse, { actor, card }, false)
      : isResponseProhibited(ctx, actor, card)
  )
    return invalid('Card is prohibited for this purpose.');
  return { ok: true, value: card };
}

/** 当前可选的牌（手牌与视为配方）；实际材料和目标仍须最终验证。 */
export function cardOffers(
  ctx: Context,
  actor: string,
  purpose: Purpose | UseTiming,
  names?: readonly string[],
): readonly CardOffer[] {
  return ctx.query(() => immutable([...candidates(ctx, actor, purpose, names)]));
}

/** 只判断候选存在性；纯同步过滤可收窄候选，实际材料和目标仍须最终验证。 */
export function hasCardOffers(
  ctx: Context,
  actor: string,
  purpose: Purpose | UseTiming,
  names?: readonly string[],
  accepts?: (offer: CardOffer) => boolean,
): boolean {
  return ctx.query(() => {
    for (const offer of candidates(ctx, actor, purpose, names))
      if (!accepts || accepts(immutable(offer))) return true;
    return false;
  });
}

// 两个公开入口均在 query 内消费迭代器，不让规则回调逃出纯查询边界。
function* candidates(
  ctx: Context,
  actor: string,
  purpose: Purpose | UseTiming,
  names?: readonly string[],
): Iterable<CardOffer> {
  if (!ctx.world.player(actor).alive || isGameOver(ctx.world)) return;
  const operation = typeof purpose === 'string' ? purpose : 'use';
  const wanted = (name: string) => supports(ctx, name, purpose) && (!names || names.includes(name));
  for (const id of ownedCards(ctx.world, actor)) {
    const card = build(ctx, actor, { kind: 'physical', card: id }, operation);
    if (card.ok && wanted(card.value.name))
      yield {
        id: JSON.stringify(['physical', id]),
        kind: 'physical',
        label: cardDef(ctx, card.value.name).label,
        names: [card.value.name],
        materials: [id],
        count: { min: 1, max: 1 },
        choice: { card: id },
      };
  }
  for (const { self, definition } of rulesOf(ctx).bindings(ctx.world)) {
    if (self.owner !== actor || !self.active(ctx)) continue;
    const input: ViewAsInput = { self, purpose: operation };
    for (const recipe of definition.viewAs ?? []) {
      if (recipe.available && !recipe.available(ctx, input)) continue;
      const possible = recipeNames(ctx, input, recipe).filter(wanted);
      const materials = recipe.materials?.(ctx, input) ?? [];
      const count = recipeCount(ctx, input, recipe);
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
