import { obtain, skill, on, Damage, Use } from '../../../sdk';
import type { Context, EffectRef } from '../../../sdk';

const materialsHere = (ctx: Context, card: EffectRef | undefined): card is EffectRef =>
  !!card &&
  card.card.materials.length > 0 &&
  card.card.materials.every((id) => ctx.world.position(id) === card.processing);

export default skill(
  'standard:jianxiong',
  '奸雄',
  '受到一次伤害后，你可以获得造成此伤害的牌。其全部实体材料须仍在此次用牌的处理区中；没有实体材料的牌无法获得。',
  on(Damage.received, {
    who: (hit) => hit.input.to,
    when: (ctx, hit) => materialsHere(ctx, hit.input.card),
    ask: '是否发动【奸雄】获得造成伤害的牌？',
    keep: (ctx, hit) => materialsHere(ctx, hit.input.card),
    effect(ctx, hit, self) {
      // 材料只认这次用牌的处理区，宣告后被移走的实体不能追回。
      if (!materialsHere(ctx, hit.input.card)) return;
      const { useId, card } = hit.input.card;
      return obtain(ctx, self.owner, card.materials, self.skill, {
        kind: Use.materialsObtained,
        data: { actor: self.owner, useId, cards: card.materials, reason: self.skill },
      });
    },
  }),
);
