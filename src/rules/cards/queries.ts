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

export const usageLimit = defineQuery<UseRequest, number | null>('card.usage-limit', (a, b) =>
  a === null || b === null ? null : Math.max(a, b),
);
export const extraTargets = defineQuery<UseRequest, number>('card.extra-targets', (a, b) => a + b);
export const ignoreDistance = defineQuery<UseRequest, boolean>(
  'card.ignore-distance',
  (a, b) => a || b,
);

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
