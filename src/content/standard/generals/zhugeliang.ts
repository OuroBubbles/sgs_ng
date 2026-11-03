import {
  alive,
  ArrangementSelection,
  cardLabel,
  cardQueries,
  general,
  isGameOver,
  modify,
  moveCards,
  skill,
  on,
  withPrivateTopCards,
  Phase,
} from '../../../sdk';
import type { Context, Processing } from '../../../sdk';
import { Cards } from '../../../sdk';

/** 私有区正常/局部中止的余牌回顶；不能用遗计的默认弃置善后。 */
async function returnRemaining(ctx: Context, pool: Processing): Promise<void> {
  const cards = pool.remaining();
  if (cards.length)
    await moveCards(
      ctx,
      [{ cards, from: pool.zone, to: 'draw', place: 'top' }],
      'standard:guanxing cleanup',
    );
}

export const guanxing = skill({
  id: 'standard:guanxing',
  name: '观星',
  description:
    '准备阶段，你可以观看牌堆顶 X 张牌（X 为存活角色数，至多 5），将任意张以任意顺序放回牌顶，其余以任意顺序置于牌底。',
  triggers: [
    on(Phase.started, {
      who: (phase) => phase.owner,
      when: (_ctx, phase) => phase.kind === 'prepare',
      ask: '观星：是否观看并整理牌堆顶？',
      effect: (ctx, _phase, self) =>
        withPrivateTopCards(
          ctx,
          {
            player: self.owner,
            reason: self.skill,
            count: Math.min(5, ctx.world.snapshot.players.filter((p) => p.alive).length),
          },
          async (at, pool) => {
            const live = () => alive(at, self.owner) && !isGameOver(at.world);
            if (!live() || !pool.remaining().length) return;
            const model = new ArrangementSelection({
              items: () =>
                pool.remaining().map((id) => {
                  const card = at.world.card(id);
                  return { id, label: `${cardLabel(at, id)} · ${card.suit} ${card.rank}` };
                }),
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
              available: () => live() && decision.available!(),
            });
            if (answer.kind !== 'chosen' || !live()) return;
            const group = (id: string) => answer.value.groups.find((g) => g.id === id)!.items;
            const [top, bottom] = [group('top'), group('bottom')];
            await moveCards(
              at,
              [
                { cards: top, from: pool.zone, to: 'draw', place: 'top' },
                { cards: bottom, from: pool.zone, to: 'draw', place: 'bottom' },
              ],
              self.skill,
              {
                kind: Cards.arranged,
                data: { player: self.owner, reason: self.skill, top, bottom },
              },
            );
          },
          returnRemaining,
        ),
    }),
  ],
});

export const kongcheng = skill({
  id: 'standard:kongcheng',
  name: '空城',
  description: '锁定技，若你没有手牌，你不能成为杀或决斗的目标。装备不影响空城。',
  modifiers: [
    modify(cardQueries.prohibitTarget, (ctx, { input, self }) =>
      input.target === self.owner &&
      ctx.world.zone(`${self.owner}:hand`).cards.length === 0 &&
      ['standard:slash', 'standard:duel'].includes(input.card.name)
        ? true
        : undefined,
    ),
  ],
});

export default general({
  id: 'standard:zhugeliang',
  name: '诸葛亮',
  kingdom: '蜀',
  hp: 3,
  skills: [guanxing, kongcheng],
});
