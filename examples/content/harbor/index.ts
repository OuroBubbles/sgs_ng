import type { ContentDefinition } from '../../../src/content/catalog';
import {
  cardDef,
  defineEvent,
  timing,
  defineQuery,
  draw,
  rulesOf,
  skill,
  on,
  Use,
} from '../../../src/sdk';
import type { Card, CardDefinition } from '../../../src/sdk';
import portrait from './guest.jpg';

export interface ProvisionResult {
  readonly actor: string;
  readonly target: string;
  readonly cards: readonly string[];
}
/** 真实备航摸牌完成后的公共后效；导出对象供其他模块直接订阅。 */
export const Provision = defineEvent('provision', { finished: timing<ProvisionResult>() });
export const tideDrawBonus = defineQuery<{ readonly actor: string }, number>(
  'harbor.tideDrawBonus',
  (a, b) => a + b,
);
export function provisionBy(event: ProvisionResult, owner: string): boolean {
  return event.actor === owner;
}

/** 普通源码模块：通过普通 import 共享实际规则对象。 */
const provision: CardDefinition = {
  id: 'harbor:provision',
  label: '备航',
  type: 'trick',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => target === request.actor,
    async resolve(ctx, { effect }) {
      const result = await draw(ctx, { player: effect.target, count: 2, reason: provision.id });
      await ctx.window(
        Provision.finished,
        Object.freeze({ actor: effect.actor, target: effect.target, cards: result.cards }),
        { subject: effect.target },
      );
    },
  },
};
const tide = skill({
  id: 'harbor:tide',
  name: '潮声',
  description: '当你使用锦囊牌时，你可以摸一张牌。',
  triggers: [
    on(Use.declared, {
      who: (use) => use.actor,
      when: (ctx, use) => cardDef(ctx, use.card.name).type === 'trick',
      ask: '是否发动【潮声】摸一张牌？',
      effect: (ctx, _use, self) =>
        draw(ctx, {
          player: self.owner,
          count: 1 + rulesOf(ctx).skills.query(ctx, tideDrawBonus, { actor: self.owner }, 0),
          reason: self.skill,
        }),
    }),
  ],
});
export default {
  cards: [provision],
  skills: [tide],
  generals: [
    {
      id: 'harbor:guest',
      name: '渡客',
      kingdom: '群',
      gender: 'male',
      maxHp: 4,
      skills: ['harbor:tide', 'standard:wusheng'],
    },
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
} satisfies ContentDefinition;
