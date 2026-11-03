import { equipmentCard, modify, cardQueries, ownedCards } from '../../sdk';
import type { CardDefinition } from '../../sdk';
import { eightDiagram, qinggangSword, niohShield } from './armor';
import { advancedWeapons } from './weapons';
import { remainingSwords } from './swords';
import type { SkillDefinition } from '../../sdk';

const crossbow = equipmentCard({
  id: 'standard:crossbow',
  label: '诸葛连弩',
  slot: 'weapon',
  range: 1,
  skill: {
    id: 'standard:crossbow-ability',
    name: '诸葛连弩',
    modifiers: [
      modify(cardQueries.usageLimit, (_ctx, { input: request, self }) =>
        request.actor === self.owner &&
        request.card.name === 'standard:slash' &&
        !request.card.materials.includes(self.origin?.id ?? '')
          ? null
          : undefined,
      ),
    ],
  } satisfies SkillDefinition,
});

const spear = equipmentCard({
  id: 'standard:spear',
  label: '丈八蛇矛',
  slot: 'weapon',
  range: 3,
  skill: {
    id: 'standard:spear-ability',
    name: '丈八蛇矛',
    viewAs: [
      {
        id: 'two-cards-slash',
        count: { min: 2, max: 2 },
        materials: (ctx, { self }) => ownedCards(ctx.world, self.owner),
        // 多材料的花色/点数为空，颜色独立按材料推导；作者只需指定名称。
        make: { name: 'standard:slash' },
      },
    ],
  } satisfies SkillDefinition,
});

function horse(id: string, label: string, defensive: boolean): CardDefinition {
  return equipmentCard({
    id: `standard:${id}`,
    label,
    slot: defensive ? 'defensive-horse' : 'offensive-horse',
    skill: {
      id: `standard:${id}-ability`,
      name: label,
      modifiers: [
        modify(cardQueries.distanceCorrection, (_ctx, { input: request, self }) => {
          if (self.origin && request.card?.materials.includes(self.origin.id)) return undefined;
          return (defensive ? request.to : request.from) === self.owner
            ? defensive
              ? 1
              : -1
            : undefined;
        }),
      ],
    } satisfies SkillDefinition,
  });
}

export const standardEquipment: readonly CardDefinition[] = [
  crossbow,
  spear,
  eightDiagram,
  qinggangSword,
  niohShield,
  ...advancedWeapons,
  ...remainingSwords,
  horse('chitu', '赤兔', false),
  horse('dayuan', '大宛', false),
  horse('zixing', '紫骍', false),
  horse('jueying', '绝影', true),
  horse('dilu', '的卢', true),
  horse('zhuahuangfeidian', '爪黄飞电', true),
];
