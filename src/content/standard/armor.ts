import type { CardChoice } from '../../sdk';
import {
  equipment,
  equipmentEffectiveFor,
  on,
  judge,
  Target,
  Resolve,
  Response,
  Equipment,
} from '../../sdk';

const jink: CardChoice = {
  kind: 'generated',
  face: { name: 'standard:jink' },
  materials: [],
  reason: 'standard:eight_diagram',
};

export const eightDiagram = equipment(
  'standard:eight_diagram',
  '八卦阵',
  'armor',
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

export const qinggangSword = equipment(
  'standard:qinggang_sword',
  '青釭剑',
  { weapon: 2 },
  on(Target.specified, {
    locked: true,
    when: (_ctx, { effect }, self) =>
      effect.actor === self.owner &&
      effect.card.name === 'standard:slash' &&
      effect.state === 'targeting',
    effect(ctx, { use, effect }, self) {
      effect.ignoreEquipment(ctx, 'armor', 'standard:qinggang_sword');
      ctx.commit(Equipment.ignored, [], {
        actor: self.owner,
        name: 'standard:qinggang_sword',
        use: use.id,
        effect: effect.effectId,
        target: effect.target,
        slot: 'armor',
      });
    },
  }),
);

export const niohShield = equipment(
  'standard:nioh_shield',
  '仁王盾',
  'armor',
  on(Resolve.starting, {
    locked: true,
    when: (ctx, { effect }, self) =>
      effect.target === self.owner &&
      effect.state === 'ready' &&
      effect.card.name === 'standard:slash' &&
      effect.card.color === 'black' &&
      equipmentEffectiveFor(ctx, self, effect, 'armor'),
    effect(ctx, { effect }, self) {
      effect.cancel(ctx, 'standard:nioh_shield');
      ctx.commit(Equipment.blocked, [], {
        actor: self.owner,
        name: 'standard:nioh_shield',
        effect: effect.effectId,
      });
    },
  }),
);
