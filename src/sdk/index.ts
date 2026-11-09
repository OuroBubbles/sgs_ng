/**
 * 内容作者的唯一入口：写武将、技能与牌所需的全部名字。分组即用法——
 * 定义（skill / general / card …）、时点（on 的第一个参数）、查询、动词与选择模型。
 * 测试、主持端与内核之间直接引用各自模块，不经过这里。
 */

// ───────────────────────── 定义
export { skill, general, equipment, action, convert, dealtWith, landing } from '../rules/author';
export { card, deckOf } from '../content/catalog';
export type { ContentDefinition, PackDefinition } from '../content/catalog';
export { delayedCard } from '../rules/cards/delayed';
export type { DelayedInput } from '../rules/cards/delayed';
export { on } from '../rules/skills/on';
export { defineQuery, modify } from '../rules/skills/query';
export * as cardQueries from '../rules/cards/queries';
export { defineMark } from '../rules/state/mark';
export type { Mark } from '../rules/state/mark';
export { defineEvent, timing } from '../core/runtime/event';
export type { Context } from '../core/runtime/room';
export type { SkillHandle } from '../rules/skills/skills';
export type { ActiveInput } from '../rules/skills/active';
export type {
  CardChoice,
  CardDefinition,
  CardEffect,
  CardFixedTargetsInput,
  EffectRef,
  SemanticCard,
  UseIntent,
  ViewAsInput,
} from '../rules/cards/types';

// ───────────────────────── 时点：on(Damage.inflicting, …)
export { Skill } from '../rules/skills/skills';
export { Lifetime } from '../rules/scopes/lifetime';
export { Cost } from '../rules/costs/pay';
export { Cards, CardEvent } from '../rules/cards/move';
export { Use, Target, Resolve } from '../rules/cards/use';
export { Response } from '../rules/cards/response';
export { Counter } from '../rules/cards/counter';
export { Judgment } from '../rules/cards/judge';
export { Equipment } from '../rules/cards/equipment';
export { Damage } from '../rules/combat/damage';
export { Attack } from '../rules/combat/attack';
export { Hp } from '../rules/combat/recover';
export { Chain } from '../rules/combat/chain';
export { Shield } from '../rules/combat/shield';
export { Dying, Death } from '../rules/combat/life-events';
export { Phase, Turn } from '../rules/turn/turn';
export { Game } from '../rules/game/end';

// ───────────────────────── 查询
export {
  HE,
  alive,
  others,
  peers,
  wounded,
  isMale,
  turnOwner,
  cardLabel,
  discardable,
  nth,
} from '../rules/author';
export { kingdomOf } from '../rules/characters/kingdom';
export { differentGender } from '../rules/characters/gender';
export { currentPhase } from '../rules/turn/turn';
export type { PhaseView } from '../rules/turn/turn';
export { isGameOver } from '../rules/game/end';
export { rulesOf, cardDef } from '../rules/skills/skills';
export { face } from '../rules/cards/face';
export { physicalCard } from '../rules/cards/card';
export { ownedCards } from '../rules/cards/types';
export { canDiscard, discardCards } from '../rules/cards/discard';
export {
  distance,
  withinDistance,
  attackRange,
  responseTimes,
  isTargetProhibited,
  isResponseProhibited,
} from '../rules/cards/rule';
export { equipmentInSlot, equipmentLost, equipmentEffectiveFor } from '../rules/cards/equipment';
export { isChained, setChained } from '../rules/combat/chain';
export { isDirectDamage, damage } from '../rules/combat/damage';
export type { DamageDraft } from '../rules/combat/damage';
export { cardActivities } from '../rules/cards/activity';
export type { UsePlanView } from '../rules/cards/plan';

// ───────────────────────── 动词（自带存活与终局检查）
export {
  obtain,
  obtainJudgment,
  takeCard,
  give,
  askDiscard,
  useSupplied,
  select,
  selection,
} from '../rules/author';
export { draw } from '../rules/cards/draw';
export { recover } from '../rules/combat/recover';
export { loseHp } from '../rules/combat/lose-hp';
export { changeShield } from '../rules/combat/shield';
export { moveCards, declared } from '../rules/cards/move';
export type { MoveResult } from '../rules/cards/move';
export { judge } from '../rules/cards/judge';
export { useCard, validateUse, askUse } from '../rules/cards/use';
export { respond } from '../rules/cards/response';
export type { ResponseOpportunity } from '../rules/cards/response';
export { resolveAttack } from '../rules/combat/attack';
export type { DefenseDraft } from '../rules/combat/attack';
export { resolveCounter } from '../rules/cards/counter';
export { delayedCards, placeDelayed, moveDelayed, canPlaceDelayed } from '../rules/cards/delayed';
export { withPrivateTopCards } from '../rules/cards/private-pool';
export { withRevealedCards } from '../rules/cards/reveal';
export type { Processing } from '../rules/cards/processing';
export { chooseOwnedCard } from '../rules/cards/choose';
export { scheduleExtraTurn } from '../rules/turn/extra';
export { declare, askInvoke } from '../rules/skills/invoke';
export { payDiscard } from '../rules/costs/pay';

// ───────────────────────── 选择模型
export { chooseOne } from '../core/decisions/choice';
export { JointSelection } from '../core/decisions/selection';
export type { JointChoice } from '../core/decisions/selection';
export { ArrangementSelection } from '../core/decisions/arrangement';
