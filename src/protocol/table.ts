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
  readonly icon?: string;
  readonly image?: string;
  /** 当前公开牌定义的装备槽；扩展槽名保持开放。 */
  readonly slot?: string;
  readonly color?: 'red' | 'black' | 'none';
}

/** 选牌身份始终是不透明选项；未知牌只保留标签，不伪造牌面。 */
export interface CardChoiceView {
  readonly id: string;
  readonly label: string;
  readonly face: CardView | null;
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
