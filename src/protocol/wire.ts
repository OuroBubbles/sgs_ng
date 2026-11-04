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
  | { readonly kind: 'cancel'; readonly id: string; readonly token: number }
  /** 仅单机：暂停（AI 停步并藏牌）或恢复。 */
  | { readonly kind: 'pause'; readonly enabled: boolean }
  /** 仅单机手动演练：确认热坐交接，钥匙来自 GameView.handoff。 */
  | { readonly kind: 'confirm-seat'; readonly key: string };

export interface ClientCommandMessage {
  readonly sequence: number;
  readonly round: number;
  readonly command: ClientCommand;
}

/** 握手：protocol 强制相等；content 记入房间/回放，客户端不强求持有同内容代码。 */
export interface BuildHello {
  readonly kind: 'hello';
  readonly protocol: string;
  readonly content: string;
}

/** 房间创建草稿；人数由阵容长度确定，不保存另一份可矛盾的席位数。 */
export interface RoomSetup {
  readonly practice?: boolean;
  readonly seed: number;
  readonly preset: string;
  readonly lineup: readonly string[];
  readonly humans: number;
}

export const defaultRoomSetup: RoomSetup = {
  seed: 42,
  preset: 'standard:identity',
  lineup: ['standard:guanyu', 'standard:caocao', 'standard:zhangfei', 'standard:zhaoyun'],
  humans: 2,
};

/**
 * 单机开局草稿：本机主持端据此装配一局，连接即对局、断开即结束。
 * 给出阵容时甲席由你执掌、其余为基础 AI；只给人数时为手动多席演练（热坐交接）。
 */
export type SoloSetup = {
  readonly practice?: boolean;
  readonly seed: number;
  readonly preset: string;
} & (
  | { readonly lineup: readonly string[]; readonly count?: never }
  | { readonly count: number; readonly lineup?: never }
);

/** 客户端握手：resume 回到联机席位；solo 请主持端开一局单机。两者互斥。 */
export type ClientHello = BuildHello & {
  readonly resume?: string;
  readonly solo?: SoloSetup;
};

export type ClientMessage = ClientHello | ClientCommandMessage;

/** 大厅展示目录：主持端从内容装配摘出的普通数据；客户端不持有内容模块。 */
export interface ContentSummary {
  readonly cards: number;
  readonly decks: readonly { readonly id: string; readonly label: string }[];
  readonly generals: readonly {
    readonly id: string;
    readonly name: string;
    readonly kingdom: string;
    readonly maxHp: number;
    readonly portrait?: string;
    readonly skills: readonly {
      readonly id: string;
      readonly name: string;
      readonly lord: boolean;
      readonly description: string;
    }[];
  }[];
}

/** GET /catalog 的响应。 */
export interface HostCatalog {
  readonly seats: readonly string[];
  readonly standard: ContentSummary;
  readonly practice: ContentSummary;
}

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
  /** lobby 为 null 表示单机连接：没有房间，只有这一局。 */
  | { readonly kind: 'view'; readonly lobby: LobbyView | null; readonly view: GameView | null }
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
