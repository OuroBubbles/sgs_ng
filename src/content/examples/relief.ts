/** 作者接口探针“周济”，不是某个历史版本的遗计。只从当前牌堆取牌，尚无洗牌。 */
import { defineSkill, on, damageReceived, JointSelection, moveCards } from '../../sdk';

export const relief = defineSkill({
  id: 'demo:relief',
  name: '周济',
  effects: [
    on(damageReceived, {
      id: 'give-after-damage',
      when: (_ctx, hit, self) => hit.input.to === self.owner,
      async run(ctx, _hit, self) {
        const invoke = await ctx.ask({
          player: self.owner,
          kind: 'invoke',
          prompt: '是否发动周济？',
          data: { skill: self.skill },
          optional: true,
          validate: (input) =>
            typeof input === 'boolean'
              ? { ok: true, value: input }
              : { ok: false, reason: 'Expected a boolean.' },
        });
        if (invoke.kind !== 'chosen' || !invoke.value || !self.effective(ctx.world)) return;

        const hand = ctx.world.snapshot.zones.find(
          (zone) => zone.kind === 'hand' && zone.owner === self.owner,
        );
        if (!hand) throw new Error('Relief requires a hand zone.');
        const cards = ctx.world.zone('draw').cards.slice(0, 2);
        if (cards.length)
          await moveCards(ctx, [{ cards, from: 'draw', to: hand.id, place: 'bottom' }], self.skill);
        if (!ctx.world.player(self.owner).alive || !self.effective(ctx.world)) return;

        const selection = new JointSelection({
          cards: () =>
            ctx.world.zone(hand.id).cards.map((id) => ({
              id,
              label: ctx.world.snapshot.cards.find((card) => card.id === id)?.name ?? id,
            })),
          targets: () =>
            ctx.world.snapshot.players
              .filter(
                (player) =>
                  player.alive &&
                  player.id !== self.owner &&
                  ctx.world.snapshot.zones.some(
                    (zone) => zone.kind === 'hand' && zone.owner === player.id,
                  ),
              )
              .map((player) => ({ id: player.id, label: player.id })),
          cardCount: { min: 1, max: 'all' },
          targetCount: { min: 1, max: 1 },
        });
        const choice = await ctx.ask(selection.decision(self.owner, '选择手牌和接收者', true));
        if (choice.kind !== 'chosen' || !self.effective(ctx.world)) return;
        const target = choice.value.targets[0];
        const destination = ctx.world.snapshot.zones.find(
          (zone) => zone.kind === 'hand' && zone.owner === target,
        );
        if (!destination) throw new Error('Recipient requires a hand zone.');
        // 回复已由执行侧验证；移动仍对当前起点作最终校验。
        await moveCards(
          ctx,
          [{ cards: choice.value.cards, from: hand.id, to: destination.id, place: 'bottom' }],
          self.skill,
        );
      },
    }),
  ],
});
