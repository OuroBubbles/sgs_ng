import { cardDef, draw, general, skill, on, Use } from '../../src/sdk';
import type { ContentDefinition } from '../../src/sdk';

const study = skill({
  id: 'study',
  name: '研习',
  description: '当你使用锦囊牌时，你可以摸一张牌。',
  triggers: [
    on(Use.declared, {
      who: (use) => use.actor,
      when: (ctx, use) => cardDef(ctx, use.card.name).type === 'trick',
      ask: '是否发动【研习】摸一张牌？',
      effect: (ctx, _use, self) => draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
    }),
  ],
});

export default {
  generals: [general('scholar', '学士', '群', 3, [study])],
} satisfies ContentDefinition;
