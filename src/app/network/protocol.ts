import type { ReplyResult } from '../../core/decisions/hub';
import type { ChoicePreview, GameSelection, GameView } from '../../core/view/game';
import type { RemoteAsset } from './content';

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

/** 双方核对构建后才入席；不同内容不能通过碰巧相同的版本号混入对局。 */
export interface BuildHello {
  readonly kind: 'hello';
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

export const closedReply = (message: string): ReplyResult => ({
  kind: 'rejected',
  reason: 'closed',
  message,
});
