import type { CardView, PlayerView } from './table';
export interface SkillView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly effective: boolean;
}

/** 纯展示数据。没有 World、历史原始 detail、执行闭包或其他席位的私有请求。 */
export interface SeatView extends PlayerView {
  readonly chained: boolean;
  readonly shield: number;
  readonly gender: string;
  readonly alive: boolean;
  readonly handCount: number;
  readonly role: string | null;
  readonly equipment: readonly CardView[];
  readonly judgment: readonly CardView[];
  readonly skills: readonly SkillView[];
}
export interface CountView {
  readonly min: number;
  readonly max: number | 'all';
}
export interface PoolView {
  readonly zone: string;
  readonly cards: readonly CardView[];
  readonly visibility: 'public' | 'private';
}
export interface CandidateView {
  readonly id: string;
  readonly label: string;
  readonly selectable: boolean;
}
export interface OfferView {
  readonly description: string;
  readonly id: string;
  readonly label: string;
  readonly kind: 'physical' | 'viewAs' | 'active';
  readonly cards: readonly string[];
  readonly count: CountView;
  readonly cardId: string | null;
}
interface DecisionBase {
  readonly cancelLabel?: string;
  readonly id: string;
  readonly token: number;
  readonly prompt: string;
  readonly optional: boolean;
}
export type DecisionView = DecisionBase &
  (
    | {
        readonly kind: 'play-action' | 'card-response' | 'use-card';
        readonly offers: readonly OfferView[];
        readonly fixedTargets: readonly string[];
        readonly purpose: 'play' | 'response' | 'rescue' | 'counter' | 'effect';
      }
    | {
        readonly kind: 'cards-targets';
        readonly cards: readonly CandidateView[];
        readonly targets: readonly CandidateView[];
        readonly cardCount: CountView;
        readonly targetCount: CountView;
      }
    | { readonly kind: 'invoke' }
    | {
        readonly kind: 'arrange';
        readonly presentation?: 'order' | 'distribution';
        readonly destinations?: Readonly<Record<string, readonly string[]>>;
        readonly items: readonly CandidateView[];
        readonly groups: readonly {
          readonly id: string;
          readonly label: string;
          readonly count: CountView;
          readonly items: readonly string[];
        }[];
      }
    | {
        readonly kind: 'trigger-order' | 'choose-option';
        readonly options: readonly CandidateView[];
      }
    | { readonly kind: 'unsupported'; readonly original: string }
  );
export interface PublicAction {
  readonly seq: number;
  readonly actor: string;
  readonly card: CardView;
  readonly targets: readonly string[];
  readonly kind: 'use' | 'response' | 'judgment' | 'delayed' | 'reveal';
  readonly processing: boolean;
}
export interface LogView {
  readonly seq: number;
  readonly text: string;
}
export interface GameView {
  readonly deckName: string;
  readonly revision: number;
  readonly status: 'idle' | 'running' | 'ended' | 'stopped' | 'faulted';
  readonly viewer: string | null;
  readonly automated: string | null;
  readonly paused: boolean;
  readonly hand: readonly CardView[];
  readonly players: readonly SeatView[];
  readonly decision: DecisionView | null;
  readonly handoff: {
    readonly key: string;
    readonly player: string;
    readonly name: string;
    readonly turn: boolean;
    readonly extra: boolean;
  } | null;
  readonly turn: number;
  readonly extraTurn: boolean;
  readonly active: string | null;
  readonly phase: string | null;
  readonly drawCount: number;
  readonly discardCount: number;
  readonly actions: readonly PublicAction[];
  readonly pools: readonly PoolView[];
  readonly log: readonly LogView[];
  readonly result: { readonly winners: readonly string[]; readonly reason: string } | null;
  readonly error: string;
}
/** UI 的未提交草稿；它不是游戏状态，也不能自行解释规则。 */
export interface GameSelection {
  readonly offer: string | null;
  readonly cards: readonly string[];
  readonly targets: readonly string[];
}
/** 排序面板未提交的分组草稿；最终合法性仍由执行侧决策验证。 */
export interface ArrangementDraft {
  readonly groups: readonly { readonly id: string; readonly items: readonly string[] }[];
}
export interface ChoicePreview {
  readonly valid: boolean;
  readonly reason: string;
  readonly targets: readonly CandidateView[];
  readonly cards: readonly CandidateView[];
  readonly targetCount: CountView;
  readonly fixedTargets: readonly string[];
}
