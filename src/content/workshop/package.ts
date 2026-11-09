import type { Card, PackDefinition } from '../../sdk';

/** 按 [牌名, 张数] 依次展开；花色默认四色轮转，点数 1–13 循环。 */
function deck(
  prefix: string,
  counts: readonly (readonly [string, number])[],
  suit = (index: number): Card['suit'] =>
    (['spade', 'heart', 'club', 'diamond'] as const)[index % 4]!,
): () => readonly Card[] {
  return () =>
    counts
      .flatMap(([name, count]) => Array<string>(count).fill(name))
      .map((name, index) => ({
        id: `${prefix}-${index + 1}`,
        name,
        suit: suit(index),
        rank: (index % 13) + 1,
      }));
}

/**
 * 机制演武包：依赖标准包的牌与技能，只在演武中启用。generals/、cards/、skills/ 下每个文件
 * 即一名武将、一种牌或一个技能（余响不属于任何武将，由拾慧授予）。
 */
export default {
  practice: true,
  order: ['quartermaster', 'inquirer', 'vermilion_guest', 'guardian', 'guest'],
  decks: [
    {
      id: 'workshop:faces',
      label: '牌面演练（40 张）',
      // 全黑桃便于观察印刷牌与当前牌面差别；配比仍能完成真实基础 AI 对局。
      create: deck(
        'face-card',
        [
          ['standard:slash', 18],
          ['standard:jink', 8],
          ['standard:peach', 8],
          ['standard:ex_nihilo', 4],
          ['standard:eight_diagram', 2],
        ],
        () => 'spade',
      ),
    },
    {
      id: 'workshop:defense',
      label: '护盾与转移（48 张）',
      create: deck('defense-card', [
        ['workshop:ward', 8],
        ['workshop:bind', 8],
        ['workshop:ember', 8],
        ['standard:slash', 12],
        ['standard:jink', 6],
        ['standard:peach', 6],
      ]),
    },
    {
      id: 'workshop:chains',
      label: '连环演练（48 张）',
      create: deck('chain-card', [
        ['workshop:bind', 12],
        ['workshop:ember', 8],
        ['standard:slash', 12],
        ['standard:jink', 8],
        ['standard:peach', 8],
      ]),
    },
    {
      id: 'workshop:showcase',
      label: '机制演武（44 张）',
      create: deck('workshop-card', [
        ['standard:slash', 12],
        ['standard:jink', 12],
        ['standard:peach', 8],
        ['standard:duel', 4],
        ['standard:ex_nihilo', 4],
        ['workshop:prepare', 4],
      ]),
    },
    {
      id: 'workshop:relics',
      label: '遗玉演练（40 张）',
      create: deck('relic-card', [
        ['workshop:relic_jade', 8],
        ['standard:eight_diagram', 8],
        ['standard:slash', 12],
        ['standard:jink', 8],
        ['standard:peach', 4],
      ]),
    },
  ],
} satisfies PackDefinition;
