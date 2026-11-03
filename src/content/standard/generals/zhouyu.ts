import {
  action,
  alive,
  chooseOne,
  chooseOwnedCard,
  damage,
  face,
  general,
  give,
  isGameOver,
  ownedCards,
  skill,
  on,
  Cards,
  defineEvent,
  timing,
} from '../../../sdk';

export const Fanjian = defineEvent('fanjian', {
  guessed: timing<unknown>(),
});

export const yingzi = skill({
  id: 'standard:yingzi',
  name: '英姿',
  description: '摸牌阶段，你可以多摸一张牌。',
  triggers: [
    on(Cards.drawing, {
      who: (draft) => draft.input.player,
      when: (_ctx, draft) => draft.phase?.kind === 'draw',
      ask: '是否发动【英姿】多摸一张牌？',
      effect: (_ctx, draft, self) => draft.setCount(draft.count + 1, self.skill),
    }),
  ],
});

const suits = [
  { id: 'spade', label: '♠ 黑桃' },
  { id: 'heart', label: '♥ 红桃' },
  { id: 'club', label: '♣ 梅花' },
  { id: 'diamond', label: '♦ 方块' },
] as const;

export const fanjian = skill({
  id: 'standard:fanjian',
  name: '反间',
  description:
    '出牌阶段限一次，令一名其他角色猜一种花色，再正面朝上获得你的一张手牌。若花色不同，你对其造成一点伤害。手牌由目标暗选。',
  active: [
    action({
      id: 'guess-suit',
      limit: 1,
      targets: {
        count: 1,
        filter: (ctx, id, { self }) =>
          id !== self.owner && ownedCards(ctx.world, self.owner).length > 0,
      },
      async effect(ctx, { self, targets: [target] }) {
        const guess = await ctx.ask(
          chooseOne({
            player: target!,
            prompt: `反间：先猜一种花色，再暗选 ${self.owner} 的一张手牌`,
            options: suits,
            reason: self.skill,
            available: () =>
              alive(ctx, target!) &&
              alive(ctx, self.owner) &&
              ownedCards(ctx.world, self.owner).length > 0 &&
              !isGameOver(ctx.world),
          }),
        );
        if (guess.kind !== 'chosen') return;
        ctx.commit(Fanjian.guessed, [], { actor: target, owner: self.owner, suit: guess.value });
        const picked = await chooseOwnedCard(ctx, {
          actor: target!,
          target: self.owner,
          areas: ['hand'],
          reason: self.skill,
          prompt: '反间：暗选对方的一张手牌，正面朝上获得',
        });
        if (picked.kind !== 'chosen') return;
        if (
          !(await give(ctx, {
            actor: self.owner,
            target: target!,
            cards: [picked.card],
            reason: self.skill,
            visible: true,
          }))
        )
          return;
        // 牌已交出；获得/失去牌后效不会撤销猜错的结果，也不要求来源仍持有技能或存活。
        if (face(ctx, picked.card).suit !== guess.value)
          await damage(ctx, { from: self.owner, to: target!, amount: 1, nature: 'normal' });
      },
    }),
  ],
  ai: {
    value: ({ hand, players, cost, hostility }) =>
      hand.some((card) => cost(card.id) <= 5) && players.some((p) => p.alive && hostility(p.id) > 0)
        ? 12
        : -1,
  },
});

export default general('standard:zhouyu', '周瑜', '吴', 3, [yingzi, fanjian]);
