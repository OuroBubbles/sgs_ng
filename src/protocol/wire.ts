import type { ChoicePreview, GameSelection, GameView } from './game';

/** 房间资源清单项；展示用，永不为可执行内容模块。 */
export interface RemoteAsset {
  /** 房间内稳定的资源 URI；各客户端替换为自己的 Blob URL。 */
  readonly url: string;
  readonly type: string;
  readonly data: string;
}

/** 传输侧的决策回执；与 DecisionHub 结果同形，但不依赖 hub 实现。 */
export type ReplyResult =
  | { readonly kind: 'accepted' }
  | {
      readonly kind: 'rejected';
      readonly reason: 'closed' | 'stale' | 'invalid' | 'required';
      readonly message: string;
    };

export const closedReply = (message: string): ReplyResult => ({
  kind: 'rejected',
  reason: 'closed',
  message,
});

/** 传输普通数据，绝不传递规则闭包、World 或原始决策描述。 */
export type ClientCommand =
  | { readonly kind: 'ready'; readonly enabled: boolean }
  | { readonly kind: 'choose-general'; readonly general: string }
  | { readonly kind: 'prepare' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'end-round' }
  | { readonly kind: 'delegate'; readonly enabled: boolean }
  | {
      readonly kind: 'inspect';
      readonly id: string;
      readonly token: number;
      readonly selection: GameSelection;
    }
  | {
      readonly kind: 'inspect-answer';
      readonly id: string;
      readonly token: number;
      readonly value: unknown;
    }
  | {
      readonly kind: 'reply';
      readonly id: string;
      readonly token: number;
      readonly selection: GameSelection;
    }
  | {
      readonly kind: 'answer';
      readonly id: string;
      readonly token: number;
      readonly value: unknown;
    }
  | { readonly kind: 'cancel'; readonly id: string; readonly token: number };

export interface ClientCommandMessage {
  readonly sequence: number;
  readonly round: number;
  readonly command: ClientCommand;
}

/**
 * 握手：protocol 强制相等；content 记入房间/回放，客户端不强求持有同内容代码。
 * `build` 保留为 protocol 别名，兼容旧字段阅读；新代码应读 `protocol`。
 */
export interface BuildHello {
  readonly kind: 'hello';
  readonly protocol: string;
  readonly content: string;
  /** @deprecated 与 protocol 相同；过渡期双写。 */
  readonly build: string;
}

export type ClientMessage = (BuildHello & { readonly resume?: string }) | ClientCommandMessage;

export interface LobbyView {
  readonly seat: string;
  readonly round: number;
  readonly phase: 'preparing' | 'playing' | 'finished';
  readonly editing: boolean;
  readonly seed: number;
  readonly deckName: string;
  readonly error: string;
  readonly generals: readonly { readonly id: string; readonly name: string }[];
  readonly waitingFor: string | null;
  /** 房间的下局阵容草稿，不包含随机身份或起手牌。 */
  readonly lineup: readonly {
    readonly id: string;
    readonly generalId: string;
    readonly general: string;
    readonly portrait?: string;
  }[];
  readonly seats: readonly {
    readonly id: string;
    readonly connected: boolean;
    readonly ready: boolean;
    readonly editing: boolean;
  }[];
}

export type CommandResult =
  | ReplyResult
  | ChoicePreview
  | { readonly valid: boolean; readonly reason: string };

export type ServerMessage =
  | { readonly kind: 'pulse' }
  | (BuildHello & { readonly assets: readonly RemoteAsset[] })
  | { readonly kind: 'seat'; readonly seat: string; readonly key: string }
  | { readonly kind: 'view'; readonly lobby: LobbyView; readonly view: GameView | null }
  | {
      readonly kind: 'response';
      readonly sequence: number;
      readonly round: number;
      readonly result: CommandResult;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly code?: 'replaced' | 'resume-expired';
    };
