import type { Context, DamageDraft, SkillHandle } from '../../../sdk';
import {
  canDiscard,
  isDirectDamage,
  JointSelection,
  on,
  ownedCards,
  payDiscard,
  skill,
  Damage,
  Skill,
} from '../../../sdk';

function selection(ctx: Context, draft: DamageDraft, self: SkillHandle) {
  return new JointSelection({
    cards: () =>
      ownedCards(ctx.world, self.owner, ['hand'])
        .filter((card) =>
          canDiscard(ctx, {
            actor: self.owner,
            owner: self.owner,
            card,
            reason: self.skill,
          }),
        )
        .map((id) => ({ id, label: ctx.world.card(id).name })),
    targets: () =>
      ctx.world.snapshot.players
        .filter((player) => draft.canTransfer(ctx, player.id))
        .map((player) => player.id),
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 1, max: 1 },
  });
}

/** 自定义作者探针，不冒充某版天香。传播/转移包不再发动，演示局保持有限。 */
export default skill(
  'workshop:relay',
  '代受',
  '你即将受到直接伤害时，可以弃置一张手牌，将当前伤害转移给一名其他角色。接收方重新结算防御；连环传播或已转移的伤害不能发动。',
  on(Damage.inflicting, {
    when: (ctx, draft, self) =>
      draft.input.to === self.owner &&
      isDirectDamage(draft.input) &&
      draft.pending &&
      draft.amount > 0 &&
      selection(ctx, draft, self).available(),
    async effect(ctx, draft, self) {
      const model = selection(ctx, draft, self);
      const answer = await ctx.ask(
        model.decision(self.owner, '代受：弃置一张手牌，选择伤害接收方', {
          optional: true,
          reason: self.skill,
          cancelLabel: '不发动代受',
        }),
      );
      if (answer.kind !== 'chosen') return;
      const intent = draft.prepareTransfer(ctx, answer.value.targets[0]!, self.skill);
      const paid = await payDiscard(ctx, {
        skill: self,
        cards: answer.value.cards,
        areas: ['hand'],
        reason: self.skill,
        legal: () => model.validate(answer.value).ok,
        intent,
        factKind: Skill.invoked,
        declaration: { label: self.name, ...intent.data },
      });
      if (paid.kind === 'paid') await intent.resolve(ctx);
    },
  }),
);
