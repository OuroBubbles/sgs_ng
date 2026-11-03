import { on, useDeclared, invoke, draw } from '../../src/sdk';
import type { CardBook, ContentDefinition } from '../../src/sdk';
import type { SkillDefinition } from '../../src/sdk';

function study(book: CardBook) {
  return {
    id: 'study',
    name: '研习',
    description: '当你使用锦囊牌时，你可以摸一张牌。',
    triggers: [
      on(useDeclared, {
        order: 'choose',
        when: (_ctx, { payload: use, self }) =>
          use.actor === self.owner && book.definition(use.card.name).type === 'trick',
        async run(ctx, { self }) {
          if (await invoke(ctx, self, '是否发动【研习】摸一张牌？'))
            await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
        },
      }),
    ],
  } satisfies SkillDefinition;
}

export default {
  skills: [study],
  generals: [
    {
      id: 'scholar',
      name: '学士',
      kingdom: '群',
      gender: 'male',
      maxHp: 3,
      skills: ['study'],
    },
  ],
} satisfies ContentDefinition;
