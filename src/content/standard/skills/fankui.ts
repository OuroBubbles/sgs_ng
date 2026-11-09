import type { SkillHandle } from '../../../sdk';
import { alive, chooseOwnedCard, HE, ownedCards, skill, takeCard, on, Damage } from '../../../sdk';

const areas = (source: string, self: SkillHandle) =>
  source === self.owner ? ['equipment' as const] : HE;

export default skill(
  'standard:fankui',
  '反馈',
  '受到一次伤害后，你可以获得伤害来源的一张手牌或装备。若伤害来源是你，只能选择装备。',
  on(Damage.received, {
    who: (hit) => hit.input.to,
    when: (ctx, hit, self) => {
      const source = hit.input.from;
      return (
        source !== null &&
        alive(ctx, source) &&
        ownedCards(ctx.world, source, areas(source, self)).length > 0
      );
    },
    // 先选牌，确认即发动；takeCard 只取仍在原位的所选牌。
    async cost(ctx, hit, self) {
      const source = hit.input.from!;
      const chosen = await chooseOwnedCard(ctx, {
        actor: self.owner,
        target: source,
        areas: areas(source, self),
        reason: self.skill,
        prompt: '反馈：选择伤害来源的一张牌，确认后发动',
        optional: true,
      });
      return chosen.kind === 'chosen' ? chosen : null;
    },
    effect: (ctx, hit, self, { card, from }) =>
      takeCard(ctx, {
        actor: self.owner,
        target: hit.input.from!,
        card,
        from,
        reason: self.skill,
      }),
  }),
);
