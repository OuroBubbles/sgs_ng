import { delayedCard, placeDelayed, canPlaceDelayed, judge, damage, isGameOver } from '../../sdk';
import type { CardUseRef, Context, CardBook, EffectRef } from '../../sdk';

function reference(effect: EffectRef): CardUseRef {
  return {
    useId: effect.useId,
    actor: effect.actor,
    card: effect.card,
    processing: effect.processing,
  };
}

async function passLightning(ctx: Context, effect: EffectRef, book: CardBook): Promise<void> {
  const players = ctx.world.snapshot.players.map((player) => player.id);
  const index = players.indexOf(effect.target);
  const source = reference(effect);
  for (const owner of [...players.slice(index + 1), ...players.slice(0, index + 1)]) {
    if (!ctx.world.player(owner).alive) continue;
    if (!canPlaceDelayed(ctx, book, source, owner)) continue;
    const placed = await placeDelayed(ctx, book, source, owner);
    if (placed.kind === 'aborted') return ctx.abort(placed.reason);
    if (placed.value === 'placed') return;
  }
}

export const standardDelayed = [
  delayedCard({
    id: 'standard:indulgence',
    label: '乐不思蜀',
    async resolve(ctx, effect, book, phase) {
      const result = await judge(ctx, book, {
        player: effect.target,
        reason: effect.card.name,
        match: (_ctx, card) => card.suit === 'heart',
      });
      if (result.kind === 'aborted') return ctx.abort(result.reason);
      if (
        result.value.kind === 'judged' &&
        result.value.matched === false &&
        !isGameOver(ctx.world) &&
        ctx.world.player(effect.target).alive
      )
        phase.turn?.skipNext(ctx, 'play', 'standard:indulgence');
    },
  }),
  delayedCard({
    id: 'standard:lightning',
    label: '闪电',
    self: true,
    async resolve(ctx, effect, book) {
      const result = await judge(ctx, book, {
        player: effect.target,
        reason: effect.card.name,
        match: (_ctx, card) => card.suit === 'spade' && card.rank >= 2 && card.rank <= 9,
      });
      if (result.kind === 'aborted') return ctx.abort(result.reason);
      if (result.value.kind !== 'judged') return;
      if (result.value.matched) {
        const dealt = await damage(ctx, {
          from: null,
          to: effect.target,
          amount: 3,
          nature: 'thunder',
          card: effect,
        });
        if (dealt.kind === 'aborted') return ctx.abort(dealt.reason);
      } else await passLightning(ctx, effect, book);
    },
    cancelled: (ctx, effect, book) => passLightning(ctx, effect, book),
  }),
];
