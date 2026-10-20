import type { Card } from '../../core/model/state';

/** 机制回归专用配比；正常开局使用标准 + EX 实体牌表。 */
export function mechanicsDeck(): readonly Card[] {
  const names = [
    'slash',
    'slash',
    'slash',
    'jink',
    'jink',
    'peach',
    'duel',
    'ex_nihilo',
    'nullification',
    'nullification',
    'savage_assault',
    'archery_attack',
    'god_salvation',
    'amazing_grace',
    'snatch',
    'dismantlement',
    'crossbow',
    'spear',
    'chitu',
    'dayuan',
    'zixing',
    'jueying',
    'dilu',
    'zhuahuangfeidian',
    'indulgence',
    'lightning',
    'eight_diagram',
    'qinggang_sword',
    'nioh_shield',
    'collateral',
    'blade',
    'axe',
    'halberd',
    'kylin_bow',
    'double_swords',
    'ice_sword',
  ];
  const suits: readonly Card['suit'][] = ['spade', 'heart', 'club', 'diamond'];
  const deck: Card[] = Array.from({ length: names.length * 8 }, (_, i) => ({
    id: `card-${i + 1}`,
    name: `standard:${names[i % names.length]!}`,
    suit: suits[Math.floor(i / names.length) % 4]!,
    rank: (i % 13) + 1,
  }));
  return deck;
}
