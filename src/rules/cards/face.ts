import type { Card } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { defineQuery } from '../skills/query';
import { queryRule } from '../skills/skills';
import { colorOfSuit } from './types';
import type { CardColor } from './types';

export interface PhysicalCardFace extends Card {
  readonly color: CardColor;
}
export interface CardFaceChange {
  readonly name?: string | undefined;
  readonly suit?: Card['suit'] | undefined;
  readonly rank?: number | undefined;
  readonly color?: CardColor | undefined;
}
export interface CardFaceRequest {
  /** 原始印刷牌面；所有贡献读同一输入，不按技能登记顺序反复变换。 */
  readonly card: Card;
  /** 普通查询为当前手牌/装备持有者；判定明确使用被判定者；其他区域为 null。 */
  readonly player: string | null;
  readonly judgment: boolean;
}

const fields = ['name', 'suit', 'rank', 'color'] as const;
/** 独立字段组合、同值合并、冲突报错；不使用隐式优先级或最后登记者覆盖。 */
export const cardFace = defineQuery<CardFaceRequest, CardFaceChange>('card.face', (left, right) => {
  if (
    !right ||
    typeof right !== 'object' ||
    Array.isArray(right) ||
    Object.keys(right).some((field) => !fields.includes(field as (typeof fields)[number])) ||
    (right.name !== undefined && (typeof right.name !== 'string' || !right.name.trim())) ||
    (right.suit !== undefined &&
      !['spade', 'heart', 'club', 'diamond', 'none'].includes(right.suit)) ||
    (right.rank !== undefined &&
      (!Number.isSafeInteger(right.rank) || right.rank < 0 || right.rank > 13)) ||
    (right.color !== undefined && !['red', 'black', 'none'].includes(right.color))
  )
    throw new Error('Invalid card face contribution.');
  for (const field of fields) {
    if (left[field] !== undefined && right[field] !== undefined && left[field] !== right[field])
      throw new Error(`Conflicting card face field: ${field}`);
  }
  const patch: CardFaceChange = {
    ...(right.name === undefined ? {} : { name: right.name }),
    ...(right.suit === undefined ? {} : { suit: right.suit }),
    ...(right.rank === undefined ? {} : { rank: right.rank }),
    ...(right.color === undefined ? {} : { color: right.color }),
  };
  return immutable({ ...left, ...patch });
});

const active = new WeakMap<Context['world'], Set<string>>();

/**
 * 实体牌的当前牌面（含锁定视为）；判定显式指定被判定者，不借用改判供牌者的过滤。
 * 当前牌面是纯投影，实体牌和位置不变；提交宣告时由调用者保存返回值快照。
 */
export function face(ctx: Context, id: string, judgmentPlayer?: string): PhysicalCardFace {
  const key = JSON.stringify([id, judgmentPlayer ?? null]);
  const running = active.get(ctx.world) ?? new Set<string>();
  if (running.has(key)) throw new Error('Recursive card face query; read the printed input card.');
  active.set(ctx.world, running);
  running.add(key);
  try {
    return project(ctx, id, judgmentPlayer);
  } finally {
    running.delete(key);
    if (!running.size) active.delete(ctx.world);
  }
}

function project(ctx: Context, id: string, judgmentPlayer?: string): PhysicalCardFace {
  return ctx.query(() => {
    const card = ctx.world.card(id);
    const zone = ctx.world.zone(ctx.world.position(id));
    if (judgmentPlayer !== undefined) ctx.world.player(judgmentPlayer);
    const input: CardFaceRequest = Object.freeze({
      card,
      player: judgmentPlayer ?? (['hand', 'equipment'].includes(zone.kind) ? zone.owner : null),
      judgment: judgmentPlayer !== undefined,
    });
    const change = queryRule(ctx, cardFace, input, {});
    const suit = change.suit ?? card.suit;
    const result = immutable({
      id,
      name: change.name ?? card.name,
      suit,
      rank: change.rank ?? card.rank,
      color: change.color ?? colorOfSuit(suit),
    });
    if (
      !result.name ||
      !['spade', 'heart', 'club', 'diamond', 'none'].includes(result.suit) ||
      !Number.isSafeInteger(result.rank) ||
      result.rank < 0 ||
      result.rank > 13 ||
      !['red', 'black', 'none'].includes(result.color)
    )
      throw new Error('Invalid physical card face.');
    return result;
  });
}
