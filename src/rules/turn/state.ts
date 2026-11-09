import { defineMark } from '../state/mark';

export type TurnOrigin =
  | { readonly kind: 'normal' }
  | { readonly kind: 'extra'; readonly id: string; readonly reason: string };
export interface ActiveTurn {
  readonly id: string;
  readonly owner: string;
  readonly origin: TurnOrigin;
}
/** 正在进行的回合（全局标记）；嵌套回合结束时恢复外层。 */
export const activeTurn = defineMark<ActiveTurn | null>('core:active-turn', null);
