import { defineState } from '../state/state';

export type TurnOrigin =
  | { readonly kind: 'normal' }
  | { readonly kind: 'extra'; readonly id: string; readonly reason: string };
export interface ActiveTurn {
  readonly id: string;
  readonly owner: string;
  readonly origin: TurnOrigin;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';
export function validTurnOrigin(value: unknown): value is TurnOrigin {
  return (
    isRecord(value) &&
    (value.kind === 'normal' ||
      (value.kind === 'extra' &&
        typeof value.id === 'string' &&
        value.id.length > 0 &&
        typeof value.reason === 'string' &&
        value.reason.length > 0))
  );
}
export const activeTurn = defineState<ActiveTurn | null>(
  'core:active-turn',
  null,
  (value): value is ActiveTurn | null =>
    value === null ||
    (isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.owner === 'string' &&
      validTurnOrigin(value.origin)),
);
export const activeTarget = Object.freeze({ owner: null, source: 'mode', lifetime: null });
