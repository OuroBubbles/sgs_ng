import { definePackage, defineSkill, defineGeneral, on, useDeclared, invoke, draw } from '@sgs/sdk';
import type { Card, CardDefinition, CardBook } from '@sgs/sdk';
import portrait from './guest.jpg';

/** 普通源码模块：SDK 由构建工具保持为宿主引用，作者无需了解加载器。 */
const provision: CardDefinition = {
  id: 'harbor:provision',
  label: '备航',
  type: 'trick',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, request, target) => target === request.actor,
    async resolve(ctx, effect) {
      ctx.unwrap(await draw(ctx, { player: effect.target, count: 2, reason: provision.id }));
    },
  },
};
function tide(book: CardBook) {
  return defineSkill({
    id: 'harbor:tide',
    name: '潮声',
    description: '当你使用锦囊牌时，你可以摸一张牌。',
    effects: [
      on(useDeclared, {
        id: 'draw',
        order: 'choose',
        when: (_ctx, use, self) =>
          use.actor === self.owner && book.definition(use.card.name).type === 'trick',
        async run(ctx, _use, self) {
          if (ctx.unwrap(await invoke(ctx, self, '是否发动【潮声】摸一张牌？')))
            ctx.unwrap(await draw(ctx, { player: self.owner, count: 1, reason: self.skill }));
        },
      }),
    ],
  });
}
export default definePackage({
  manifest: {
    id: 'harbor',
    name: '渡口',
    version: '0.1.1',
    requires: [{ id: 'standard', version: '0.1.20' }],
  },
  cards: [provision],
  skills: (book) => [tide(book)],
  generals: [
    defineGeneral({
      id: 'harbor:guest',
      name: '渡客',
      kingdom: '群',
      gender: 'male',
      maxHp: 4,
      skills: ['harbor:tide', 'standard:wusheng'],
    }),
  ],
  generalViews: [{ id: 'harbor:guest', portrait }],
  cardViews: [
    {
      id: provision.id,
      kind: 'trick',
      description: '对自己使用，摸两张牌。可以被无懈可击。渡客使用时可先发动潮声摸一张牌。',
    },
  ],
  decks: [
    {
      id: 'harbor:crossing',
      label: '渡口演练（40 张）',
      create() {
        const names = [
          ...Array<string>(8).fill(provision.id),
          ...Array<string>(12).fill('standard:slash'),
          ...Array<string>(8).fill('standard:jink'),
          ...Array<string>(4).fill('standard:peach'),
          ...Array<string>(4).fill('standard:duel'),
          ...Array<string>(4).fill('standard:ex_nihilo'),
        ];
        const suits: readonly Card['suit'][] = ['spade', 'heart', 'club', 'diamond'];
        return names.map((name, i) => ({
          id: `harbor-card-${i + 1}`,
          name,
          suit: suits[i % 4]!,
          rank: (i % 13) + 1,
        }));
      },
    },
  ],
});
