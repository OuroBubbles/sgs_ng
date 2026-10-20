/** 卡牌与角色的基础绘制数据；不暴露状态写入器或界面实例。 */
export type CardKind =
  | 'slash'
  | 'peach'
  | 'dodge'
  | 'duel'
  | 'draw'
  | 'trick'
  | 'equipment'
  | 'other';

export interface CardView {
  readonly id: string;
  readonly name: string;
  readonly kind: CardKind;
  readonly suit: '♠' | '♥' | '♣' | '♦' | '·';
  readonly rank: string;
  readonly description: string;
  readonly color?: 'red' | 'black' | 'none';
}

export interface PlayerView {
  readonly id: string;
  readonly name: string;
  readonly kingdom: string;
  readonly title: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly self: boolean;
  readonly color: string;
  readonly portrait?: string;
}
