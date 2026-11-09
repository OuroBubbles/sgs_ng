import type { Context, SkillHandle } from '../../../sdk';
import { Attack, discardable, equipment, HE, on, select, selection } from '../../../sdk';
import { slashDefended } from '../card-kit';

function axeMaterials(ctx: Context, self: SkillHandle): readonly string[] {
  return discardable(ctx, self.owner, self.skill, HE).filter((id) => id !== self.origin?.id);
}

export default equipment(
  'standard:axe',
  '贯石斧',
  { weapon: 3 },
  '武器，攻击范围 3。你的杀被闪抵消后，可弃置两张其他手牌或装备，使此杀仍造成伤害。',
  on(Attack.defended, {
    when: (ctx, draft, self) =>
      slashDefended(ctx, draft, self) && axeMaterials(ctx, self).length >= 2,
    cost: (ctx, _draft, self) =>
      select(
        ctx,
        self.owner,
        selection(ctx, { cards: () => axeMaterials(ctx, self), cardCount: { min: 2, max: 2 } }),
        '贯石斧：弃置两张其他牌，使此杀仍造成伤害',
        { cancel: '不发动' },
      ),
    declare: (_ctx, draft, self, picked) => ({
      discard: picked.cards,
      data: { effect: draft.effect.effectId },
      legal: (at) =>
        !draft.broken &&
        at.world.player(draft.effect.target).alive &&
        picked.cards.every((id) => axeMaterials(at, self).includes(id)),
    }),
    effect: (_ctx, draft, self) => draft.breakDefense(self.skill),
  }),
);
