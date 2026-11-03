import {
  JointSelection,
  recover,
  ownedCards,
  chooseOwnedCard,
  discardCards,
  withRevealedCards,
  delayedCards,
  moveDelayed,
  resolveAttack,
  CardEvent,
  takeCard,
  obtain,
} from '../../sdk';
import type { CardDefinition, Context, CardEffect, CardFixedTargetsInput } from '../../sdk';

const otherLiving = (ctx: Context, { actor }: CardFixedTargetsInput) =>
  ctx.world.snapshot.players
    .filter((player) => player.alive && player.id !== actor)
    .map((player) => player.id);
const allLiving = (ctx: Context) =>
  ctx.world.snapshot.players.filter((player) => player.alive).map((player) => player.id);
const areas = ['hand', 'equipment', 'judgment'];
const hasCards = (ctx: Context, player: string) =>
  ownedCards(ctx.world, player, areas).length > 0 || delayedCards(ctx.world, player).length > 0;

async function takeOrDiscard(ctx: Context, effect: CardEffect, take: boolean): Promise<void> {
  const { actor, target } = effect;
  const reason = effect.card.name;
  const chosen = await chooseOwnedCard(ctx, { actor, target, areas, reason, discard: !take });
  if (chosen.kind === 'unavailable') return;
  if (chosen.kind === 'delayed') {
    const moved = take
      ? await moveDelayed(ctx, chosen.id, `${actor}:hand`)
      : await discardCards(ctx, { actor, owner: target, cards: [chosen.id], reason });
    if (moved.kind !== 'unavailable')
      ctx.commit(take ? CardEvent.takenDelayed : CardEvent.discardedDelayed, [], {
        actor,
        target,
        card: chosen.card,
        cards: moved.cards,
      });
    return;
  }
  const { card, from } = chosen;
  if (take) {
    await takeCard(ctx, { actor, target, card, from, reason });
    return;
  }
  const open = ctx.world.zone(from).kind !== 'hand';
  const moved = await discardCards(ctx, { actor, owner: target, cards: [card], reason });
  if (moved.kind === 'discarded')
    ctx.commit(CardEvent.discardedByEffect, [], { actor, target, card, open, reason });
}

export const trickCards: readonly CardDefinition[] = [
  {
    id: 'standard:savage_assault',
    type: 'trick',
    label: '南蛮入侵',
    counterable: true,
    use: {
      count: { min: 0, max: 0 },
      fixedTargets: otherLiving,
      target: (_ctx, { request, target }) => target !== request.actor,
      resolve: (ctx, { effect, book }) =>
        resolveAttack(ctx, effect, book, { name: 'standard:slash', purpose: 'response' }),
    },
  },
  {
    id: 'standard:archery_attack',
    type: 'trick',
    label: '万箭齐发',
    counterable: true,
    use: {
      count: { min: 0, max: 0 },
      fixedTargets: otherLiving,
      target: (_ctx, { request, target }) => target !== request.actor,
      resolve: (ctx, { effect, book }) =>
        resolveAttack(ctx, effect, book, { name: 'standard:jink', purpose: 'response' }),
    },
  },
  {
    id: 'standard:god_salvation',
    type: 'trick',
    label: '桃园结义',
    counterable: true,
    use: {
      count: { min: 0, max: 0 },
      fixedTargets: allLiving,
      target: () => true,
      canResolve: (ctx, { effect }) =>
        ctx.world.player(effect.target).hp < ctx.world.player(effect.target).maxHp,
      resolve: (ctx, { effect }) =>
        recover(ctx, { from: effect.actor, to: effect.target, amount: 1, card: effect }),
    },
  },
  {
    id: 'standard:dismantlement',
    type: 'trick',
    label: '过河拆桥',
    counterable: true,
    use: {
      count: { min: 1, max: 1 },
      target: (ctx, { request, target }) => target !== request.actor && hasCards(ctx, target),
      canResolve: (ctx, { effect }) =>
        ctx.world.player(effect.actor).alive && hasCards(ctx, effect.target),
      resolve: (ctx, { effect }) => takeOrDiscard(ctx, effect, false),
    },
  },
  {
    id: 'standard:snatch',
    type: 'trick',
    label: '顺手牵羊',
    counterable: true,
    use: {
      count: { min: 1, max: 1 },
      target: (ctx, { request, target, book }) =>
        target !== request.actor &&
        hasCards(ctx, target) &&
        book.withinDistance(ctx, request, target, 1),
      canResolve: (ctx, { effect }) =>
        ctx.world.player(effect.actor).alive && hasCards(ctx, effect.target),
      resolve: (ctx, { effect }) => takeOrDiscard(ctx, effect, true),
    },
  },
  {
    id: 'standard:amazing_grace',
    type: 'trick',
    label: '五谷丰登',
    counterable: true,
    use: {
      count: { min: 0, max: 0 },
      fixedTargets: allLiving,
      target: () => true,
      async execute(ctx, { use, book, resolveTargets }) {
        await withRevealedCards(
          ctx,
          {
            // 后席的确认窗口也可能令已经 ready 的前席死亡或被禁止。
            count: use.effects.filter(
              (effect) =>
                effect.state === 'ready' &&
                ctx.world.player(effect.target).alive &&
                !book.isTargetProhibited(ctx, use.actor, effect.target, use.card),
            ).length,
            reason: 'standard:amazing_grace',
          },
          async (at, pool) => {
            await resolveTargets(at, async (child, { effect }) => {
              const model = new JointSelection({
                cards: () =>
                  pool.remaining().map((id) => ({
                    id,
                    label: `${book.definition(child.world.card(id).name).label} · ${child.world.card(id).suit} ${child.world.card(id).rank}`,
                  })),
                cardCount: { min: 1, max: 1 },
              });
              const answer = await child.ask(
                model.decision(effect.target, '五谷丰登：选择一张公开牌'),
              );
              if (answer.kind !== 'chosen') return;
              await obtain(child, effect.target, answer.value.cards, 'standard:amazing_grace', {
                kind: CardEvent.takenPublic,
                data: {
                  actor: effect.target,
                  cards: answer.value.cards,
                  reason: 'standard:amazing_grace',
                },
              });
            });
          },
        );
      },
    },
  },
];
