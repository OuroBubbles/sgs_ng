import type { EffectRef, SemanticCard } from './types';

/** 打出牌的用途显式区分，改判不伪造一个杀/锦囊效果。 */
export type ResponseSubject =
  | { readonly kind: 'effect'; readonly effect: EffectRef }
  | { readonly kind: 'judgment'; readonly id: string; readonly player: string }
  | {
      readonly kind: 'supply';
      readonly id: string;
      readonly beneficiary: string;
      readonly reason: string;
    };

export interface CardResponse {
  readonly id: string;
  readonly actor: string;
  readonly card: SemanticCard;
  readonly subject: ResponseSubject;
}
