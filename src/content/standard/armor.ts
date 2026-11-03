import {
  equipmentCard,
  equipmentEffectiveFor,
  on,
  invoke,
  judge,
  responseRequested,
  targetSpecified,
  effectStarting,
} from '../../sdk';
import type { CardChoice } from '../../sdk';
import type { SkillDefinition } from '../../sdk';

const jink: CardChoice = {
  kind: 'generated',
  face: { name: 'standard:jink' },
  materials: [],
  reason: 'standard:eight_diagram',
};

export const eightDiagram = equipmentCard({
  id: 'standard:eight_diagram',
  label: '八卦阵',
  slot: 'armor',
  skill: (book) =>
    ({
      id: 'standard:eight_diagram-ability',
      name: '八卦阵',
      triggers: [
        on(responseRequested, {
          order: 'choose',
          when: (ctx, { payload: request, self }) =>
            request.actor === self.owner &&
            equipmentEffectiveFor(ctx.world, self, request.to, 'armor') &&
            request.canProvide(ctx, jink),
          async run(ctx, { payload: request, self }) {
            const invoked = await invoke(
              ctx,
              self,
              '是否发动【八卦阵】进行判定？',
              (at) =>
                equipmentEffectiveFor(at.world, self, request.to, 'armor') &&
                request.canProvide(at, jink),
            );
            if (!invoked) return;
            const result = await judge(ctx, book, {
              player: self.owner,
              reason: 'standard:eight_diagram',
              match: (_at, card) => card.color === 'red',
            });
            // 发动已宣告，判定期间装备离场不撤销效果；供牌仍重查请求、禁令与材料。
            if (result.matched && request.canProvide(ctx, jink)) await request.provide(ctx, jink);
          },
        }),
      ],
    }) satisfies SkillDefinition,
});

export const qinggangSword = equipmentCard({
  id: 'standard:qinggang_sword',
  label: '青釭剑',
  slot: 'weapon',
  range: 2,
  skill: {
    id: 'standard:qinggang_sword-ability',
    name: '青釭剑',
    triggers: [
      on(targetSpecified, {
        when: (_ctx, { payload: { effect }, self }) =>
          effect.actor === self.owner &&
          effect.card.name === 'standard:slash' &&
          effect.state === 'targeting',
        run(ctx, { payload: { use, effect }, self }) {
          effect.ignoreEquipment(ctx, 'armor', 'standard:qinggang_sword');
          ctx.commit('equipment.ignored', [], {
            actor: self.owner,
            name: 'standard:qinggang_sword',
            use: use.id,
            effect: effect.effectId,
            target: effect.target,
            slot: 'armor',
          });
        },
      }),
    ],
  } satisfies SkillDefinition,
});

export const niohShield = equipmentCard({
  id: 'standard:nioh_shield',
  label: '仁王盾',
  slot: 'armor',
  skill: {
    id: 'standard:nioh_shield-ability',
    name: '仁王盾',
    triggers: [
      on(effectStarting, {
        when: (ctx, { payload: { effect }, self }) =>
          effect.target === self.owner &&
          effect.state === 'ready' &&
          effect.card.name === 'standard:slash' &&
          effect.card.color === 'black' &&
          equipmentEffectiveFor(ctx.world, self, effect, 'armor'),
        run(ctx, { payload: { effect }, self }) {
          effect.cancel(ctx, 'standard:nioh_shield');
          ctx.commit('equipment.blocked', [], {
            actor: self.owner,
            name: 'standard:nioh_shield',
            effect: effect.effectId,
          });
        },
      }),
    ],
  } satisfies SkillDefinition,
});
