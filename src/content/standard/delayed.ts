import type { CardUseRef, Context, EffectRef, DelayedInput } from '../../sdk';
import { delayedCard, placeDelayed, canPlaceDelayed, judge, damage, isGameOver } from '../../sdk';

function reference(effect: EffectRef): CardUseRef {
  return {
    useId: effect.useId,
    actor: effect.actor,
    card: effect.card,
    processing: effect.processing,
  };
}

async function passLightning(ctx: Context, { effect }: DelayedInput<EffectRef>): Promise<void> {
  const players = ctx.world.snapshot.players.map((player) => player.id);
  const index = players.indexOf(effect.target);
  const source = reference(effect);
  for (const owner of [...players.slice(index + 1), ...players.slice(0, index + 1)]) {
    if (!ctx.world.player(owner).alive) continue;
    if (!canPlaceDelayed(ctx, source, owner)) continue;
    const placed = await placeDelayed(ctx, source, owner);

    if (placed === 'placed') return;
  }
}

export const standardDelayed = [
  delayedCard({
    id: 'standard:indulgence',
    label: '乐不思蜀',
    async resolve(ctx, { effect, phase }) {
      const result = await judge(ctx, {
        player: effect.target,
        reason: effect.card.name,
        match: (_ctx, card) => card.suit === 'heart',
      });

      if (
        result.kind === 'judged' &&
        result.matched === false &&
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
    async resolve(ctx, input) {
      const { effect } = input;
      const result = await judge(ctx, {
        player: effect.target,
        reason: effect.card.name,
        match: (_ctx, card) => card.suit === 'spade' && card.rank >= 2 && card.rank <= 9,
      });

      if (result.kind !== 'judged') return;
      if (result.matched) {
        await damage(ctx, {
          from: null,
          to: effect.target,
          amount: 3,
          nature: 'thunder',
          card: effect,
        });
      } else await passLightning(ctx, input);
    },
    cancelled: passLightning,
  }),
];
