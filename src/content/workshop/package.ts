import { deckOf } from '../../sdk';
import type { PackDefinition } from '../../sdk';

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
      // 全黑桃便于观察印刷牌与当前牌面差别；配比仍能完成真实托管 AI 对局。
      create: deckOf(
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
      create: deckOf('defense-card', [
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
      create: deckOf('chain-card', [
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
      create: deckOf('workshop-card', [
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
      create: deckOf('relic-card', [
        ['workshop:relic_jade', 8],
        ['standard:eight_diagram', 8],
        ['standard:slash', 12],
        ['standard:jink', 8],
        ['standard:peach', 4],
      ]),
    },
  ],
} satisfies PackDefinition;
