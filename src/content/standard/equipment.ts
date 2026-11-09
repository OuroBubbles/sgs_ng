import type { CardDefinition } from '../../sdk';
import { equipment, modify, cardQueries, ownedCards } from '../../sdk';
import { eightDiagram, qinggangSword, niohShield } from './armor';
import { advancedWeapons } from './weapons';
import { remainingSwords } from './swords';

const crossbow = equipment(
  'standard:crossbow',
  '诸葛连弩',
  { weapon: 1 },
  modify(cardQueries.usageLimit, (_ctx, { input: request, self }) =>
    request.actor === self.owner &&
    request.card.name === 'standard:slash' &&
    !request.card.materials.includes(self.origin?.id ?? '')
      ? null
      : undefined,
  ),
);

const spear = equipment(
  'standard:spear',
  '丈八蛇矛',
  { weapon: 3 },
  {
    id: 'two-cards-slash',
    count: { min: 2, max: 2 },
    materials: (ctx, { self }) => ownedCards(ctx.world, self.owner),
    // 多材料的花色/点数为空，颜色独立按材料推导；作者只需指定名称。
    make: { name: 'standard:slash' },
  },
);

function horse(id: string, label: string, defensive: boolean): CardDefinition {
  return equipment(
    `standard:${id}`,
    label,
    defensive ? 'defensive-horse' : 'offensive-horse',
    modify(cardQueries.distanceCorrection, (_ctx, { input: request, self }) => {
      if (self.origin && request.card?.materials.includes(self.origin.id)) return undefined;
      return (defensive ? request.to : request.from) === self.owner
        ? defensive
          ? 1
          : -1
        : undefined;
    }),
  );
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
