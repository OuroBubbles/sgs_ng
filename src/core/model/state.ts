export type PlayerId = string;
export type CardId = string;
export type ZoneId = string;

export interface Player {
  readonly id: PlayerId;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
}

export interface SkillSource {
  readonly kind: 'general' | 'equipment' | 'effect';
  readonly id: string;
}

export interface SkillGrant {
  readonly source: SkillSource;
  readonly scopeId: string | null;
}

/** 同一角色/技能共享一个实例，多个来源各自授予，最后一个来源消失时实例结束。 */
export interface SkillInstance {
  readonly id: string;
  readonly skill: string;
  readonly owner: PlayerId;
  readonly grants: readonly SkillGrant[];
}

export interface StateEntry {
  readonly id: string;
  readonly key: string;
  readonly owner: PlayerId | null;
  readonly source: string | null;
  readonly scopeId: string | null;
  readonly value: unknown;
}

export interface Card {
  readonly id: CardId;
  readonly name: string;
  readonly suit: 'spade' | 'heart' | 'club' | 'diamond' | 'none';
  readonly rank: number;
}

export interface Zone {
  readonly id: ZoneId;
  readonly kind: 'draw' | 'discard' | 'hand' | 'equipment' | 'judgment' | 'processing' | 'special';
  readonly owner: PlayerId | null;
  readonly scopeId: string | null;
  readonly cards: readonly CardId[];
}

export interface WorldSeed {
  readonly players: readonly Player[];
  readonly cards: readonly Card[];
  readonly zones: readonly Zone[];
  readonly skills: readonly SkillInstance[];
  readonly states: readonly StateEntry[];
}

export interface WorldSnapshot extends WorldSeed {
  readonly revision: number;
}

/** 内容只能读取这个门面，不能取得提交器或内部数组。 */
export interface WorldReader {
  readonly snapshot: WorldSnapshot;
  player(id: PlayerId): Player;
  card(id: CardId): Card;
  /** 局内状态按 ID 读取；未设置或已移除时返回 undefined。 */
  state(id: string): StateEntry | undefined;
  zone(id: ZoneId): Zone;
  position(id: CardId): ZoneId;
}

export interface CardMove {
  readonly cards: readonly CardId[];
  readonly from: ZoneId;
  readonly to: ZoneId;
  readonly place: 'top' | 'bottom';
}

/** 一个批次中的所有变更先校验，再一次性生效；这里没有内容回调。 */
export type Change =
  | ({ readonly kind: 'move' } & CardMove)
  | {
      readonly kind: 'vitality';
      readonly player: PlayerId;
      readonly hp: number;
      readonly maxHp?: number;
      readonly alive?: boolean;
    }
  | { readonly kind: 'setSkill'; readonly skill: SkillInstance }
  | { readonly kind: 'removeSkill'; readonly instance: string }
  | { readonly kind: 'setState'; readonly state: StateEntry }
  | { readonly kind: 'removeState'; readonly state: string }
  | { readonly kind: 'createZone'; readonly zone: Zone }
  | { readonly kind: 'removeZone'; readonly zone: ZoneId };
