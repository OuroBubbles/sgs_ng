import { defineQuery } from '../skills/query';
import type { SemanticCard, UseRequest, EffectRef } from './types';
import type { DiscardQuery } from './discard';

export { cardFace } from './face';

export const distanceCorrection = defineQuery<
  {
    readonly from: string;
    readonly to: string;
    readonly card: SemanticCard | null;
  },
  number
>('card.distance', (a, b) => a + b);

export const attackRange = defineQuery<
  {
    readonly actor: string;
    readonly card: SemanticCard;
  },
  number
>('card.attack-range', Math.max);

export const handLimitCorrection = defineQuery<{ readonly actor: string }, number>(
  'card.hand-limit',
  (a, b) => a + b,
);

/**
 * 用牌规则的修正：各项都是在牌面声明之上的加法，Infinity 即不限。
 * - times：额外次数（咆哮 Infinity）；targets：额外目标（方天画戟 2）；range：额外距离（奇才 Infinity）。
 */
export interface UseRule {
  readonly times?: number;
  readonly targets?: number;
  readonly range?: number;
}
export const useRule = defineQuery<UseRequest, UseRule>('card.use-rule', (a, b) => ({
  times: (a.times ?? 0) + (b.times ?? 0),
  targets: (a.targets ?? 0) + (b.targets ?? 0),
  range: (a.range ?? 0) + (b.range ?? 0),
}));

export const prohibitUse = defineQuery<
  { readonly actor: string; readonly card: SemanticCard },
  boolean
>('card.prohibit-use', (a, b) => a || b);
export const prohibitResponse = defineQuery<
  { readonly actor: string; readonly card: SemanticCard },
  boolean
>('card.prohibit-response', (a, b) => a || b);
export const prohibitDiscard = defineQuery<DiscardQuery, boolean>(
  'card.prohibit-discard',
  (a, b) => a || b,
);
export const prohibitTarget = defineQuery<
  {
    readonly actor: string;
    readonly target: string;
    readonly card: SemanticCard;
  },
  boolean
>('card.prohibit-target', (a, b) => a || b);

export const responseCount = defineQuery<
  {
    readonly effect: EffectRef;
    readonly actor: string;
    readonly name: string;
  },
  number
>('card.response-count', Math.max);
