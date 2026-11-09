import type { Context, DelayedInput, EffectRef } from '../../../sdk';
import { canPlaceDelayed, damage, delayedCard, judge, placeDelayed } from '../../../sdk';

/** 未命中或被无懈时，按座次传给下一名可放置的角色（可绕回自己）。 */
async function passLightning(ctx: Context, { effect }: DelayedInput<EffectRef>): Promise<void> {
  const players = ctx.world.snapshot.players.map((player) => player.id);
  const index = players.indexOf(effect.target);
  const { useId, actor, card, processing } = effect;
  const source = { useId, actor, card, processing };
  for (const owner of [...players.slice(index + 1), ...players.slice(0, index + 1)]) {
    if (!ctx.world.player(owner).alive || !canPlaceDelayed(ctx, source, owner)) continue;
    if ((await placeDelayed(ctx, source, owner)) === 'placed') return;
  }
}

export default delayedCard({
  id: 'standard:lightning',
  label: '闪电',
  description:
    '放入自己的判定区。判定黑桃 2–9 时受到无来源的 3 点雷电伤害；否则或被无懈时传给下一名合法角色。',
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
});
