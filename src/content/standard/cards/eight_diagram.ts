import type { CardChoice } from '../../../sdk';
import { equipment, equipmentEffectiveFor, judge, on, Response } from '../../../sdk';

const jink: CardChoice = {
  kind: 'generated',
  face: { name: 'standard:jink' },
  materials: [],
  reason: 'standard:eight_diagram',
};

export default equipment(
  'standard:eight_diagram',
  '八卦阵',
  'armor',
  '防具。当你需要使用或打出闪时，可进行判定。若结果为红色，视为按当前用途使用或打出一张闪。',
  on(Response.requested, {
    when: (ctx, request, self) =>
      request.actor === self.owner &&
      equipmentEffectiveFor(ctx, self, request.to, 'armor') &&
      request.canProvide(ctx, jink),
    ask: '是否发动【八卦阵】进行判定？',
    keep: (at, request, self) =>
      equipmentEffectiveFor(at, self, request.to, 'armor') && request.canProvide(at, jink),
    async effect(ctx, request, self) {
      const result = await judge(ctx, {
        player: self.owner,
        reason: 'standard:eight_diagram',
        match: (_at, card) => card.color === 'red',
      });
      // 发动已宣告，判定期间装备离场不撤销效果；供牌仍重查请求、禁令与材料。
      if (result.matched && request.canProvide(ctx, jink)) await request.provide(ctx, jink);
    },
  }),
);
