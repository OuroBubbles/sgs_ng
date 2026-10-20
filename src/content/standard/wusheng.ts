import { defineSkill, viewAs, ownedCards } from '../../sdk';

/** 本地 FreeKill 标准武圣机制：红色手牌/装备作为杀，统一复用杀的规则。 */
export const wusheng = defineSkill({
  id: 'standard:wusheng',
  name: '武圣',
  description: '将一张红色手牌或装备牌当杀使用或打出；沿用杀的距离、次数与目标条件。',
  effects: [],
  viewAs: [
    viewAs({
      id: 'red-slash',
      label: '武圣',
      names: () => ['standard:slash'],
      count: { min: 1, max: 1 },
      materials: (ctx, self, book) =>
        ownedCards(ctx.world, self.owner, ['hand', 'equipment']).filter(
          (id) => book.face(ctx, id).color === 'red',
        ),
      make: () => ({ name: 'standard:slash' }),
    }),
  ],
});
