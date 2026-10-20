import type { Card } from '../../core/model/state';
import { immutable } from '../../core/model/value';

/** 标准 + EX 的实体牌表，按本地 FreeKill standard_cards 卡表核对；重复牌保留独立身份。 */
const groups: readonly (readonly [string, Card['suit'], readonly number[]])[] = [
  ['slash', 'spade', [7, 8, 8, 9, 9, 10, 10]],
  ['slash', 'club', [2, 3, 4, 5, 6, 7, 8, 8, 9, 9, 10, 10, 11, 11]],
  ['slash', 'heart', [10, 10, 11]],
  ['slash', 'diamond', [6, 7, 8, 9, 10, 13]],
  ['jink', 'heart', [2, 2, 13]],
  ['jink', 'diamond', [2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11]],
  ['peach', 'heart', [3, 4, 6, 7, 8, 9, 12]],
  ['peach', 'diamond', [12]],
  ['dismantlement', 'spade', [3, 4, 12]],
  ['dismantlement', 'club', [3, 4]],
  ['dismantlement', 'heart', [12]],
  ['snatch', 'spade', [3, 4, 11]],
  ['snatch', 'diamond', [3, 4]],
  ['duel', 'spade', [1]],
  ['duel', 'club', [1]],
  ['duel', 'diamond', [1]],
  ['collateral', 'club', [12, 13]],
  ['ex_nihilo', 'heart', [7, 8, 9, 11]],
  ['nullification', 'spade', [11]],
  ['nullification', 'club', [12, 13]],
  ['nullification', 'diamond', [12]],
  ['savage_assault', 'spade', [7, 13]],
  ['savage_assault', 'club', [7]],
  ['archery_attack', 'heart', [1]],
  ['god_salvation', 'heart', [1]],
  ['amazing_grace', 'heart', [3, 4]],
  ['lightning', 'spade', [1]],
  ['lightning', 'heart', [12]],
  ['indulgence', 'spade', [6]],
  ['indulgence', 'club', [6]],
  ['indulgence', 'heart', [6]],
  ['crossbow', 'club', [1]],
  ['crossbow', 'diamond', [1]],
  ['qinggang_sword', 'spade', [6]],
  ['ice_sword', 'spade', [2]],
  ['double_swords', 'spade', [2]],
  ['blade', 'spade', [5]],
  ['spear', 'spade', [12]],
  ['axe', 'diamond', [5]],
  ['halberd', 'diamond', [12]],
  ['kylin_bow', 'heart', [5]],
  ['eight_diagram', 'spade', [2]],
  ['eight_diagram', 'club', [2]],
  ['nioh_shield', 'club', [2]],
  ['dilu', 'club', [5]],
  ['jueying', 'spade', [5]],
  ['zhuahuangfeidian', 'heart', [13]],
  ['chitu', 'heart', [5]],
  ['dayuan', 'spade', [13]],
  ['zixing', 'diamond', [13]],
];

export function createStandardDeck(): readonly Card[] {
  return immutable(
    groups
      .flatMap(([name, suit, ranks]) =>
        ranks.map((rank) => ({
          name: `standard:${name}`,
          suit,
          rank,
        })),
      )
      .map((card, index) => ({ ...card, id: `standard-card-${index + 1}` })),
  );
}
