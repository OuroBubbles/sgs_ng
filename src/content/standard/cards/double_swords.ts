import {
  differentGender,
  discardable,
  discardCards,
  draw,
  equipment,
  isGameOver,
  on,
  ownedCards,
  select,
  selection,
  Target,
} from '../../../sdk';

export default equipment(
  'standard:double_swords',
  '雌雄双股剑',
  { weapon: 2 },
  '武器，攻击范围 2。使用杀指定异性目标时，可令其弃置一张手牌，否则你摸一张牌。双性与有性别角色可构成异性，无性别不构成异性。',
  on(Target.specified, {
    when: (ctx, { effect }, self) =>
      effect.actor === self.owner &&
      effect.state === 'targeting' &&
      effect.card.name === 'standard:slash' &&
      differentGender(ctx.world, self.owner, effect.target),
    ask: (_ctx, { effect }) => `是否对 ${effect.target} 发动【雌雄双股剑】？`,
    keep: (at, { effect }, self) =>
      effect.state === 'targeting' &&
      at.world.player(effect.target).alive &&
      differentGender(at.world, self.owner, effect.target),
    async effect(ctx, { effect: { target } }, self) {
      const picked = await select(
        ctx,
        target,
        selection(ctx, {
          cards: () =>
            !ctx.world.player(target).alive || isGameOver(ctx.world)
              ? []
              : discardable(ctx, target, self.skill),
          cardCount: { min: 1, max: 1 },
        }),
        `雌雄双股剑：弃置一张手牌，否则 ${self.owner} 摸一张牌`,
        { cancel: '令对方摸牌' },
      );
      const card = picked?.cards[0];
      if (card && ctx.world.player(target).alive && ownedCards(ctx.world, target).includes(card)) {
        const moved = await discardCards(ctx, {
          actor: target,
          owner: target,
          cards: [card],
          reason: self.skill,
        });
        if (moved.kind === 'discarded') return;
      }
      await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
    },
  }),
);
