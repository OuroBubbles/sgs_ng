import {
  card,
  cardDef,
  deckOf,
  defineEvent,
  timing,
  defineQuery,
  draw,
  general,
  rulesOf,
  skill,
  on,
  Use,
} from '../../../src/sdk';
import type { ContentDefinition } from '../../../src/sdk';
import wusheng from '../../../src/content/standard/skills/wusheng';
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
const provision = card({
  id: 'harbor:provision',
  type: 'trick',
  label: '备航',
  description: '对自己使用，摸两张牌。可以被无懈可击。渡客使用时可先发动潮声摸一张牌。',
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
});
export const tide = skill(
  'harbor:tide',
  '潮声',
  '当你使用锦囊牌时，你可以摸一张牌。',
  on(Use.declared, {
    who: (use) => use.actor,
    when: (ctx, use) => cardDef(ctx, use.card.name).type === 'trick',
    ask: '是否发动【潮声】摸一张牌？',
    effect: (ctx, _use, self) =>
      draw(ctx, {
        player: self.owner,
        count: 1 + rulesOf(ctx).query(ctx, tideDrawBonus, { actor: self.owner }, 0),
        reason: self.skill,
      }),
  }),
);
export default {
  cards: [provision],
  generals: [general('harbor:guest', '渡客', '群', 4, [tide, wusheng])],
  generalViews: [{ id: 'harbor:guest', portrait }],
  decks: [
    {
      id: 'harbor:crossing',
      label: '渡口演练（40 张）',
      create: deckOf('harbor-card', [
        [provision.id, 8],
        ['standard:slash', 12],
        ['standard:jink', 8],
        ['standard:peach', 4],
        ['standard:duel', 4],
        ['standard:ex_nihilo', 4],
      ]),
    },
  ],
} satisfies ContentDefinition;
