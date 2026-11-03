import {
  ArrangementSelection,
  on,
  phaseStarted,
  invoke,
  withPrivateTopCards,
  moveCards,
  isGameOver,
  modify,
  cardQueries,
} from '../../sdk';
import type { CardBook, Context, Processing } from '../../sdk';
import type { SkillDefinition } from '../../sdk';

/** 私有区正常/局部中止的余牌回顶；不能用遗计的默认弃置善后。 */
async function returnRemaining(ctx: Context, pool: Processing): Promise<void> {
  const cards = pool.remaining();
  if (!cards.length) return;
  await moveCards(
    ctx,
    [{ cards, from: pool.zone, to: 'draw', place: 'top' }],
    'standard:guanxing cleanup',
  );
}

export function guanxing(book: CardBook) {
  return {
    id: 'standard:guanxing',
    name: '观星',
    description:
      '准备阶段，你可以观看牌堆顶 X 张牌（X 为存活角色数，至多 5），将任意张以任意顺序放回牌顶，其余以任意顺序置于牌底。',
    triggers: [
      on(phaseStarted, {
        order: 'choose',
        when: (_ctx, { payload: phase, self }) =>
          phase.owner === self.owner && phase.kind === 'prepare',
        async run(ctx, { self }) {
          const invoked = await invoke(ctx, self, '观星：是否观看并整理牌堆顶？');

          if (!invoked) return;
          const live = (at: Context) => at.world.player(self.owner).alive && !isGameOver(at.world);
          await withPrivateTopCards(
            ctx,
            {
              player: self.owner,
              reason: self.skill,
              count: Math.min(5, ctx.world.snapshot.players.filter((p) => p.alive).length),
            },
            async (at, pool) => {
              if (!live(at) || !pool.remaining().length) return;
              const model = new ArrangementSelection({
                items: () =>
                  pool.remaining().map((id) => ({
                    id,
                    label: `${book.definition(at.world.card(id).name).label} · ${at.world.card(id).suit} ${at.world.card(id).rank}`,
                  })),
                groups: [
                  { id: 'top', label: '牌顶', count: { min: 0, max: 'all' } },
                  { id: 'bottom', label: '牌底', count: { min: 0, max: 'all' } },
                ],
              });
              const decision = model.decision(self.owner, '观星：整理牌顶与牌底的顺序', {
                reason: self.skill,
              });
              const answer = await at.ask({
                ...decision,
                available: () => live(at) && decision.available!(),
              });
              if (answer.kind !== 'chosen' || !live(at)) return;
              const top = answer.value.groups.find((g) => g.id === 'top')!.items;
              const bottom = answer.value.groups.find((g) => g.id === 'bottom')!.items;
              await moveCards(
                at,
                [
                  { cards: top, from: pool.zone, to: 'draw', place: 'top' },
                  { cards: bottom, from: pool.zone, to: 'draw', place: 'bottom' },
                ],
                self.skill,
                {
                  kind: 'cards.arranged',
                  data: { player: self.owner, reason: self.skill, top, bottom },
                },
              );
            },
            returnRemaining,
          );
        },
      }),
    ],
  } satisfies SkillDefinition;
}

export const kongcheng = {
  id: 'standard:kongcheng',
  name: '空城',
  description: '锁定技，若你没有手牌，你不能成为杀或决斗的目标。装备不影响空城。',
  modifiers: [
    modify(cardQueries.prohibitTarget, (ctx, { input: request, self }) =>
      request.target === self.owner &&
      ctx.world.zone(`${self.owner}:hand`).cards.length === 0 &&
      ['standard:slash', 'standard:duel'].includes(request.card.name)
        ? true
        : undefined,
    ),
  ],
} satisfies SkillDefinition;
