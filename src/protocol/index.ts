/** 前后端共享的纯数据契约：视图、意图、握手哈希形状。不含规则函数或内容模块。 */
export type { CardKind, CardView, CardChoiceView, PlayerView } from './table';
export type {
  SkillView,
  SeatView,
  CountView,
  PoolView,
  CandidateView,
  CardChoiceGroupView,
  OfferView,
  DecisionView,
  PublicAction,
  LogView,
  GameView,
  GameSelection,
  ArrangementDraft,
  ChoicePreview,
} from './game';
export { emptyPreview } from './game';
export type {
  RemoteAsset,
  ReplyResult,
  ClientCommand,
  ClientCommandMessage,
  BuildHello,
  ClientMessage,
  LobbyView,
  CommandResult,
  ServerMessage,
} from './wire';
export { closedReply } from './wire';
