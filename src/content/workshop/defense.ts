import type { CardDefinition, Context, DamageDraft, SkillHandle, SkillDefinition } from '../../sdk';
import {
  changeShield,
  isDirectDamage,
  JointSelection,
  on,
  ownedCards,
  payDiscard,
  Damage,
  Skill,
  canDiscard,
} from '../../sdk';

export const ward: CardDefinition = {
  id: 'workshop:ward',
  label: '凝障',
  description:
    '作者演示牌。对自己使用，获得 2 点护盾。伤害先消耗护盾，余量才扣体力；完全吸收仍属于受到伤害，不阻断连环。失去体力不消耗护盾。可被无懈可击。',
  type: 'trick',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => target === request.actor,
    resolve: (ctx, { effect }) =>
      changeShield(ctx, { player: effect.target, amount: 2, reason: ward.id }),
  },
};

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
export const relay = {
  id: 'workshop:relay',
  name: '代受',
  description:
    '你即将受到直接伤害时，可以弃置一张手牌，将当前伤害转移给一名其他角色。接收方重新结算防御；连环传播或已转移的伤害不能发动。',
  triggers: [
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
  ],
} satisfies SkillDefinition;
