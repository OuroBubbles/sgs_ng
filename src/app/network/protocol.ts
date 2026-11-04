/** @deprecated 线协议已迁到 `src/protocol`；此处仅作兼容再导出。 */
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
} from '../../protocol/wire';
export { closedReply } from '../../protocol/wire';
