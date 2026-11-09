import {
  CardEvent,
  JointSelection,
  card,
  cardDef,
  isTargetProhibited,
  obtain,
  withRevealedCards,
} from '../../../sdk';
import { allLiving } from '../card-kit';

export default card({
  id: 'standard:amazing_grace',
  type: 'trick',
  label: '五谷丰登',
  description: '按目标数展示牌堆顶牌，各目标依次选择一张获得。未被获得的余牌置入弃牌堆。',
  counterable: true,
  use: {
    count: { min: 0, max: 0 },
    fixedTargets: allLiving,
    target: () => true,
    async execute(ctx, { use, resolveTargets }) {
      await withRevealedCards(
        ctx,
        {
          // 后席的确认窗口也可能令已经 ready 的前席死亡或被禁止。
          count: use.effects.filter(
            (effect) =>
              effect.state === 'ready' &&
              ctx.world.player(effect.target).alive &&
              !isTargetProhibited(ctx, use.actor, effect.target, use.card),
          ).length,
          reason: 'standard:amazing_grace',
        },
        async (at, pool) => {
          await resolveTargets(at, async (child, { effect }) => {
            const model = new JointSelection({
              cards: () =>
                pool.remaining().map((id) => ({
                  id,
                  label: `${cardDef(ctx, child.world.card(id).name).label} · ${child.world.card(id).suit} ${child.world.card(id).rank}`,
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
});
