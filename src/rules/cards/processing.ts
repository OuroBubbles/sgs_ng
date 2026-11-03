import type { CardMove } from '../../core/model/state';
import { immutable } from '../../core/model/value';
import type { Context } from '../../core/runtime/room';
import { moveCards, Cards } from './move';
import { withLifetime } from '../scopes/lifetime';
import type { Lifetime } from '../scopes/lifetime';

export interface Processing {
  readonly zone: string;
  readonly scopeId: string;
  readonly lifetime: Lifetime;
  /** 实时读取当前仍归属于这个处理区的牌，不能缓存最初材料作为善后集合。 */
  remaining(): readonly string[];
}

export interface ProcessingInput {
  readonly cards: readonly string[];
  readonly from: string;
}

export type ProcessingCleanup = (
  ctx: Context,
  processing: Processing,
  exit: 'resolved' | 'aborted',
) => unknown;

/**
 * 正常结束、正常终局和 body 子流程中止均清理余牌；故障/立即中止整局只释放运行资源。
 * 每次处理区具有独立身份。向这个 zone 显式移动牌表示将其归入本次处理。
 * 默认将余牌弃置；特殊目的区域或领域善后放在最后一个参数。
 */
export async function withProcessing<T>(
  ctx: Context,
  input: readonly ProcessingInput[],
  body: (ctx: Context, processing: Processing) => T | Promise<T>,
  cleanup: string | ProcessingCleanup = 'discard',
): Promise<T> {
  return withLifetime(ctx, 'processing', async (owner, lifetime) => {
    const zone = `processing:${lifetime.id}`;
    const moves: readonly CardMove[] = immutable(
      input
        .filter((item) => item.cards.length)
        .map((item) => ({ ...item, to: zone, place: 'bottom' as const })),
    );
    const before = owner.world.snapshot.zones.filter((item) =>
      moves.some((move) => move.from === item.id),
    );
    owner.commit(
      'processing.opened',
      [
        {
          kind: 'createZone',
          zone: { id: zone, kind: 'processing', owner: null, scopeId: lifetime.id, cards: [] },
        },
        ...moves.map((move) => ({ kind: 'move' as const, ...move })),
      ],
      { zone, moves, before },
    );
    if (moves.length)
      await owner.window(
        Cards.moved,
        immutable({
          kind: 'moved',
          moves,
          before,
          after: owner.world.snapshot.zones.filter(
            (item) => item.id === zone || before.some((old) => old.id === item.id),
          ),
        }),
      );

    const processing: Processing = Object.freeze({
      zone,
      scopeId: lifetime.id,
      lifetime,
      remaining: () => {
        if (!owner.scope.active) throw new Error('Processing scope is closed.');
        return owner.world.zone(zone).cards;
      },
    });
    const result = await owner.attempt('processing.body', (child) => body(child, processing));
    if (typeof cleanup === 'string') {
      const remaining = processing.remaining();
      if (remaining.length)
        await moveCards(
          owner,
          [{ cards: remaining, from: zone, to: cleanup, place: 'bottom' }],
          'processing cleanup',
        );
    } else {
      const cleaned = await owner.attempt('processing.cleanup', (child) =>
        cleanup(child, processing, result.kind),
      );
      if (cleaned.kind === 'aborted') throw new Error('Processing cleanup cannot abort.');
    }
    if (processing.remaining().length) throw new Error('Processing cleanup left cards behind.');
    owner.commit('processing.closed', [{ kind: 'removeZone', zone }], { zone });
    if (result.kind === 'aborted') return owner.abort(result.reason);
    return result.value;
  });
}
