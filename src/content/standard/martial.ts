import { ownedCards, modify, cardQueries } from '../../sdk';
import type { SkillDefinition } from '../../sdk';

/** 标准龙胆拆成两个明确配方；生成牌的距离、次数与响应资格仍由 CardBook 决定。 */
export const longdan = {
  id: 'standard:longdan',
  name: '龙胆',
  description: '可以将一张杀当闪使用或打出，或将一张闪当杀使用或打出。',
  viewAs: [
    {
      id: 'jink-slash',
      label: '龙胆 · 杀',
      count: { min: 1, max: 1 },
      materials: (ctx, { self, book }) =>
        ownedCards(ctx.world, self.owner).filter(
          (id) => book.face(ctx, id).name === 'standard:jink',
        ),
      make: { name: 'standard:slash' },
    },
    {
      id: 'slash-jink',
      label: '龙胆 · 闪',
      count: { min: 1, max: 1 },
      materials: (ctx, { self, book }) =>
        ownedCards(ctx.world, self.owner).filter(
          (id) => book.face(ctx, id).name === 'standard:slash',
        ),
      make: { name: 'standard:jink' },
    },
  ],
} satisfies SkillDefinition;

export const paoxiao = {
  id: 'standard:paoxiao',
  name: '咆哮',
  description: '锁定技，你使用杀没有次数限制。距离、目标与响应条件不变。',
  modifiers: [
    modify(cardQueries.usageLimit, (_ctx, { input: request, self }) =>
      request.actor === self.owner && request.card.name === 'standard:slash' ? null : undefined,
    ),
  ],
} satisfies SkillDefinition;

export const qixi = {
  id: 'standard:qixi',
  name: '奇袭',
  description: '可以将一张黑色手牌或装备牌当过河拆桥使用。',
  viewAs: [
    {
      id: 'black-dismantlement',
      count: { min: 1, max: 1 },
      materials: (ctx, { self, book }) =>
        ownedCards(ctx.world, self.owner, ['hand', 'equipment']).filter(
          (id) => book.face(ctx, id).color === 'black',
        ),
      make: { name: 'standard:dismantlement' },
    },
  ],
} satisfies SkillDefinition;
