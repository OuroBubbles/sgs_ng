/** 内容开发门面：共享实际规则对象与操作；普通源码和未来扩展使用同一接口。 */
export { defineWindow } from '../core/runtime/window';
export type {
  Trigger,
  WindowType,
  TriggerOccurrence,
  WindowOptions,
  ActionAnchor,
  TriggerSource,
  WindowRef,
  WindowAdmission,
} from '../core/runtime/window';
export { turnActionAnchor } from '../rules/turn/order';
export type { Context, FlowBody, FlowResult } from '../core/runtime/room';
export type { Decision, DecisionSpec, DecisionResult, Validation } from '../core/decisions/hub';
export type {
  Card,
  Player,
  Zone,
  CardMove,
  SkillInstance,
  SkillSource,
  SkillGrant,
  WorldReader,
} from '../core/model/state';
export type { Fact, HistoryReader } from '../core/history/journal';
export type { DeepReadonly } from '../core/model/value';
export { JointSelection } from '../core/decisions/selection';
export { chooseOne } from '../core/decisions/choice';
export { ArrangementSelection } from '../core/decisions/arrangement';
export type {
  ArrangementChoice,
  ArrangementGroup,
  ArrangementSpec,
} from '../core/decisions/arrangement';
export type {
  JointChoice,
  ChoiceItem,
  SelectionFeedback,
  JointSelectionSpec,
} from '../core/decisions/selection';
export {
  defineSkill,
  on,
  SkillBook,
  skillEffective,
  skillAvailable,
  skillLost,
  blockSkill,
  skillsChanged,
  rulesOf,
} from '../rules/skills/skills';
export type {
  SkillDefinition,
  SkillTrigger,
  SkillTriggerDefinition,
  SkillTriggerInput,
  SkillTriggerOccurrenceInput,
  SkillHandle,
  SkillBinding,
  SkillProvider,
  SkillChange,
  SkillAi,
  AiView,
  AiSeat,
} from '../rules/skills/skills';
export { defineQuery, modify } from '../rules/skills/query';
export { genderOf, genderChange, setGender, differentGender } from '../rules/characters/gender';
export type { Gender } from '../rules/characters/gender';
export { kingdomOf, kingdomChange, setKingdom } from '../rules/characters/kingdom';
export { askInvoke, invoke, declare } from '../rules/skills/invoke';
export type { Declaration } from '../rules/skills/invoke';
// 作者门面：多数武将只需要这一组。
export {
  HE,
  alive,
  others,
  otherAlive,
  face,
  cardDef,
  cardLabel,
  handOf,
  canDiscard,
  discardable,
  wounded,
  isMale,
  peers,
  turnOwner,
  nth,
  obtain,
  obtainJudgment,
  takeCard,
  give,
  select,
  selection,
  askDiscard,
  trigger,
  action,
  convert,
  skill,
  general,
} from '../rules/author';
export type {
  Areas,
  MoveFact,
  AskOptions,
  Picked,
  TriggerSpec,
  ActionContext,
  ActionSpec,
  AuthoredGeneral,
} from '../rules/author';
export { activeOffers, validateActive, activate } from '../rules/skills/active';
export type {
  ActiveSkill,
  ActiveInput,
  ActiveRunInput,
  ActiveChoice,
  ActiveOffer,
} from '../rules/skills/active';
export { defineGeneral, GeneralBook, generalOf, generalChange } from '../rules/characters/general';
export type { GeneralDefinition } from '../rules/characters/general';
export { responseRequested, isResponseSatisfied } from '../rules/cards/response';
export {
  EffectBook,
  defineEffect,
  effectOn,
  effectModify,
  effectAdded,
  effectChanged,
  effectEnded,
} from '../rules/effects/effects';
export type {
  EffectRecord,
  EffectHandle,
  EffectDefinition,
  EffectInput,
  EffectBehavior,
  EffectTrigger,
  EffectTriggerInput,
  EffectTriggerOccurrenceInput,
  EffectTriggerDefinition,
  EffectModifier,
  PreparedEffect,
  EffectEnd,
} from '../rules/effects/effects';
export type { ResponseOpportunity } from '../rules/cards/response';
export type { QueryType, SkillModifier, ModifyInput } from '../rules/skills/query';
export * as cardQueries from '../rules/cards/queries';
export type { PhysicalCardFace, CardFaceRequest, CardFaceChange } from '../rules/cards/face';
export {
  equipmentCard,
  equip,
  equippedCards,
  equipmentInSlot,
  equipmentLost,
  equipmentEffectiveFor,
} from '../rules/cards/equipment';
export type { EquipmentSlot, EquipmentDefinition, EquipResult } from '../rules/cards/equipment';
export { defineState, readState, setState, stateChange } from '../rules/state/state';
export type { StateKey, StateTarget } from '../rules/state/state';
export { withCardSupply } from '../rules/cards/supply';
export type { CardSupplyInput, SuppliedCard, SupplyResult } from '../rules/cards/supply';
export { withLifetime, lifetimeEnded } from '../rules/scopes/lifetime';
export type { Lifetime } from '../rules/scopes/lifetime';
export { pay, payDiscard, costPaid, used } from '../rules/costs/pay';
export type {
  UsageLimit,
  PaymentResult,
  PaymentSpec,
  PaymentReceipt,
  PaymentIntent,
} from '../rules/costs/pay';
export { moveCards, cardsMoved } from '../rules/cards/move';
export type { MoveResult, MoveDeclaration } from '../rules/cards/move';
export { discardCards } from '../rules/cards/discard';
export type { DiscardRequest, DiscardQuery, DiscardResult } from '../rules/cards/discard';
export { withProcessing } from '../rules/cards/processing';
export type { Processing, ProcessingCleanup } from '../rules/cards/processing';
export { withPrivateTopCards, privateCardPools } from '../rules/cards/private-pool';
export type { PrivatePoolInput } from '../rules/cards/private-pool';
export {
  damage,
  damageCausing,
  damageReplacing,
  damageInflicting,
  damageDealt,
  damageReceived,
  damageSettled,
} from '../rules/combat/damage';
export type {
  DamageInput,
  DamageDraft,
  DamageTransferIntent,
  DamageResult,
  DamageOrigin,
  DamageTransfer,
  DamageTransferResult,
} from '../rules/combat/damage';
export { isDirectDamage, isChainDamage } from '../rules/combat/damage';
export { chainChange, chainChanged, isChained, setChained } from '../rules/combat/chain';
export type { ChainChange, ChainResult } from '../rules/combat/chain';
export { shieldOf, shieldChange, changeShield, shieldChanged } from '../rules/combat/shield';
export type { ShieldInput, ShieldChange, ShieldResult } from '../rules/combat/shield';
export { resolveAttack, attackDefended } from '../rules/combat/attack';
export type { DefenseDraft, AttackResult, AttackDamage } from '../rules/combat/attack';
export { recover, recovering, recovered } from '../rules/combat/recover';
export type {
  RecoveryInput,
  RecoveryResult,
  RecoveryDraft,
  RecoveryEdit,
} from '../rules/combat/recover';
export { cardActivities } from '../rules/cards/activity';
export type { CardActivity, CardActivityPhase } from '../rules/cards/activity';
export {
  CardBook,
  useDeclared,
  targetsConfirming,
  targetSpecifying,
  targetSpecified,
  targetConfirming,
  targetConfirmed,
  effectStarting,
  effectFinished,
  useFinished,
} from '../rules/cards/book';
export { responseFinished } from '../rules/cards/played';
export type { CardResponse, ResponseSubject } from '../rules/cards/played';
export type {
  UseResult,
  ResponseResult,
  CardOffer,
  UseOfferRequest,
  AskedUseResult,
  UseFeedback,
} from '../rules/cards/book';
export {
  ownedCards,
  viewAs,
  effectReference,
  isResponseBlocked,
  useReference,
  timingSnapshot,
  colorOfSuit,
} from '../rules/cards/types';
export {
  contestCounter,
  resolveCounter,
  installCounterspells,
  counterOpening,
  counterFinished,
} from '../rules/cards/counter';
export type { CounterResult, CounterOutcome, CounterRequest } from '../rules/cards/counter';
export type {
  CardChoice,
  CardDefinition,
  SemanticCard,
  CardFace,
  CardColor,
  Nature,
  ViewAs,
  ViewAsInput,
  ViewAsMakeInput,
  ViewAsUseInput,
  UseIntent,
  UseRequest,
  UseTiming,
  ResponseUseOpportunity,
  CardEffect,
  EffectRef,
  ResponseBlock,
  UseSnapshot,
  CardPolicy,
  CounterOpportunity,
  CounterSubject,
  CardUseRef,
  TimingSnapshot,
  ResolveTargets,
  TargetResolver,
  UseRules,
  CardUseInput,
  CardTargetInput,
  CardSelectionInput,
  CardFixedTargetsInput,
  CardEffectInput,
  CardExecuteInput,
  TargetOptions,
  TargetStage,
} from '../rules/cards/types';
export type { UsePlanView } from '../rules/cards/plan';
export { useDeclarations } from '../rules/cards/plan';
export { draw, drawing, cardsDrawn, reshuffle } from '../rules/cards/draw';
export type { DrawInput, DrawRequest, DrawDraft, DrawResult } from '../rules/cards/draw';
export { withRevealedCards, cardsRevealed } from '../rules/cards/reveal';
export {
  delayedCard,
  delayedCards,
  placeDelayed,
  moveDelayed,
  canPlaceDelayed,
  installDelayedCards,
  resolveJudgmentPhase,
} from '../rules/cards/delayed';
export type { DelayedRules, DelayedInput, DelayedCard } from '../rules/cards/delayed';
export { judge, judgmentRevealed, judgmentRetrial, judgmentFinished } from '../rules/cards/judge';
export type {
  Judgment,
  JudgmentInput,
  JudgmentCard,
  JudgmentResult,
  RetrialInput,
} from '../rules/cards/judge';
export type { RevealInput, RevealedCards } from '../rules/cards/reveal';
export { chooseOwnedCard } from '../rules/cards/choose';
export type { OwnedCardChoice, ChosenOwnedCard } from '../rules/cards/choose';
export {
  runTurn,
  runPhase,
  currentPhase,
  defaultPhaseBody,
  playPhase,
  phaseKinds,
  phaseBefore,
  phaseStarted,
  phaseEnding,
  turnStarted,
  turnEnding,
  activeTurn,
  activePhase,
  activeTarget,
} from '../rules/turn/turn';
export {
  enterDying,
  kill,
  isDying,
  dyingStarted,
  rescueRequested,
  dyingFinishing,
  dyingFinished,
  beforeDeath,
  playerDied,
  playerBuried,
  deathFinished,
} from '../rules/combat/life';
export type {
  HealthCause,
  DyingInput,
  DyingEvent,
  DyingResult,
  DeathInput,
  DeathEvent,
  BurialEvent,
  DeathDraft,
  DeathResult,
} from '../rules/combat/life';
export { installRescue } from '../rules/combat/rescue';
export { loseHp, hpLost } from '../rules/combat/lose-hp';
export type { HpLossInput, HpLossResult } from '../rules/combat/lose-hp';
export { finishGame, resultOf, isGameOver, gameFinished } from '../rules/game/end';
export type { GameResult } from '../rules/game/end';
export {
  assignRoles,
  roleOf,
  roleSeats,
  roleRoster,
  judgeRoles,
  installRoleMode,
} from '../rules/game/roles';
export type { Role, RoleSeat } from '../rules/game/roles';
export type {
  PhaseKind,
  PhaseView,
  PhaseSnapshot,
  PhaseResult,
  TurnView,
  TurnResult,
  TurnOrigin,
  TurnOptions,
  PhaseBody,
} from '../rules/turn/turn';
export {
  pendingExtraTurns,
  scheduleExtraTurn,
  cancelExtraTurn,
  takeExtraTurn,
} from '../rules/turn/extra';
export type { ExtraTurn, ExtraTurnRequest } from '../rules/turn/extra';
export { createContent } from '../content/catalog';
export type {
  ContentDefinition,
  ContentCatalog,
  CardPresentation,
  GeneralPresentation,
  DeckDefinition,
} from '../content/catalog';
