import { immutable } from '../../core/model/value';
import type { WorldReader } from '../../core/model/state';
import type { Context } from '../../core/runtime/room';
import { defineState, stateChange } from '../state/state';
import { isGameOver } from '../game/end';
import { withProcessing } from './processing';
import type { Processing, ProcessingCleanup } from './processing';
import { moveCards } from './move';
import { reshuffle } from './draw';

const privatePool = defineState(
  'core:private-pool',
  false,
  (value): value is boolean => typeof value === 'boolean',
);

export interface PrivatePoolInput {
  readonly player: string;
  readonly count: number;
  readonly reason: string;
}

/** 从仍有效的区域与可见者元数据派生；不从私有历史重建一个可被 UI 误透传的牌表。 */
export function privateCardPools(
  world: WorldReader,
  viewer: string | null,
): readonly { readonly zone: string; readonly cards: readonly string[] }[] {
  if (viewer === null) return [];
  return world.snapshot.states
    .filter(
      (state) => state.key === privatePool.id && state.owner === viewer && state.value === true,
    )
    .flatMap((state) => {
      const zone = world.snapshot.zones.find(
        (zone) => zone.id === state.source && zone.kind === 'processing',
      );
      return zone ? [{ zone: zone.id, cards: zone.cards }] : [];
    });
}

/** 私取牌堆顶并暂存；可见者状态归处理区生存期所有，默认余牌弃置，可指定领域善后。 */
export function withPrivateTopCards<T>(
  ctx: Context,
  request: PrivatePoolInput,
  body: (ctx: Context, pool: Processing) => T | Promise<T>,
  cleanup: string | ProcessingCleanup = 'discard',
): Promise<T> {
  const input = immutable(request);
  if (!Number.isSafeInteger(input.count) || input.count < 0 || !input.reason)
    throw new Error('Invalid private pool request.');
  ctx.world.player(input.player);
  return withProcessing(
    ctx,
    [],
    async (at, pool) => {
      const live = () => at.world.player(input.player).alive && !isGameOver(at.world);
      if (live()) {
        if (
          at.world.zone('draw').cards.length < input.count &&
          at.world.zone('discard').cards.length
        ) {
          await reshuffle(at);
        }
        const cards = live() ? at.world.zone('draw').cards.slice(0, input.count) : [];
        await moveCards(
          at,
          cards.length ? [{ cards, from: 'draw', to: pool.zone, place: 'bottom' }] : [],
          input.reason,
          {
            kind: 'cards.peeked',
            data: { ...input, zone: pool.zone, cards },
            changes: [
              stateChange(
                at,
                privatePool,
                { owner: input.player, source: pool.zone, lifetime: pool.lifetime },
                true,
              ),
            ],
          },
        );
      }
      return body(at, pool);
    },
    cleanup,
  );
}
