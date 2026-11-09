import type { Context } from '../../../sdk';
import {
  canDiscard,
  Damage,
  dealtWith,
  discardCards,
  equipment,
  equipmentInSlot,
  landing,
  on,
  select,
  selection,
} from '../../../sdk';

function horses(ctx: Context, actor: string, target: string): readonly string[] {
  return [
    ...equipmentInSlot(ctx, target, 'offensive-horse'),
    ...equipmentInSlot(ctx, target, 'defensive-horse'),
  ].filter((card) =>
    canDiscard(ctx, {
      actor,
      owner: target,
      card,
      reason: 'standard:kylin_bow-ability',
    }),
  );
}

export default equipment(
  'standard:kylin_bow',
  '麒麟弓',
  { weapon: 5 },
  '武器，攻击范围 5。你的杀造成伤害时，可弃置受伤角色的一张坐骑。',
  on(Damage.causing, {
    when: (ctx, draft, self) =>
      dealtWith(draft, self.owner, 'standard:slash') &&
      landing(ctx, draft) &&
      horses(ctx, self.owner, draft.input.to).length > 0,
    cost: (ctx, draft, self) =>
      select(
        ctx,
        self.owner,
        selection(ctx, {
          cards: () => horses(ctx, self.owner, draft.input.to),
          cardCount: { min: 1, max: 1 },
        }),
        `麒麟弓：可弃置 ${draft.input.to} 的一张坐骑`,
        { cancel: '不发动' },
      ),
    declare: (_ctx, draft, self, picked) => ({
      data: { card: picked.cards[0], target: draft.input.to },
      legal: (at) =>
        landing(at, draft) && horses(at, self.owner, draft.input.to).includes(picked.cards[0]!),
    }),
    async effect(ctx, draft, self, picked) {
      const [target, card] = [draft.input.to, picked.cards[0]!];
      if (!ctx.world.player(target).alive || !horses(ctx, self.owner, target).includes(card))
        return;
      await discardCards(ctx, {
        actor: self.owner,
        owner: target,
        cards: [card],
        reason: self.skill,
      });
    },
  }),
);
