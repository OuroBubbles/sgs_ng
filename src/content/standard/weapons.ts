import {
  cardQueries,
  equipmentCard,
  equipmentInSlot,
  isGameOver,
  isDirectDamage,
  JointSelection,
  modify,
  discardCards,
  on,
  ownedCards,
  pay,
  payDiscard,
  rulesOf,
  cardLabel,
  Attack,
  Damage,
} from '../../sdk';
import type { CardDefinition, Context, SkillHandle } from '../../sdk';
import type { SkillDefinition } from '../../sdk';

function axeMaterials(ctx: Context, self: SkillHandle): readonly string[] {
  return ownedCards(ctx.world, self.owner, ['hand', 'equipment']).filter(
    (id) =>
      id !== self.origin?.id &&
      rulesOf(ctx).canDiscard(ctx, {
        actor: self.owner,
        owner: self.owner,
        card: id,
        reason: self.skill,
      }),
  );
}

const blade = equipmentCard({
  id: 'standard:blade',
  label: '青龙偃月刀',
  slot: 'weapon',
  range: 3,
  skill: {
    id: 'standard:blade-ability',
    name: '青龙偃月刀',
    triggers: [
      on(Attack.defended, {
        when: (ctx, draft, self) =>
          !draft.broken &&
          draft.effect.card.name === 'standard:slash' &&
          draft.effect.actor === self.owner &&
          ctx.world.player(draft.effect.target).alive,
        async effect(ctx, draft, self) {
          const used = await rulesOf(ctx).askUse(ctx, {
            actor: self.owner,
            names: ['standard:slash'],
            targets: [draft.effect.target],
            timing: { kind: 'effect', ignoreDistance: true },
            prompt: `青龙偃月刀：可对 ${draft.effect.target} 再使用一张杀（忽略距离与阶段次数）`,
            available: (at) =>
              self.active(at) && !draft.broken && at.world.player(draft.effect.target).alive,
          });
          if (used.kind === 'used')
            ctx.commit('weapon.follow-up', [], {
              actor: self.owner,
              name: self.name,
              fromEffect: draft.effect.effectId,
              use: used.use.id,
            });
        },
      }),
    ],
  } satisfies SkillDefinition,
});

const axe = equipmentCard({
  id: 'standard:axe',
  label: '贯石斧',
  slot: 'weapon',
  range: 3,
  skill: {
    id: 'standard:axe-ability',
    name: '贯石斧',
    triggers: [
      on(Attack.defended, {
        when: (ctx, draft, self) =>
          !draft.broken &&
          draft.effect.actor === self.owner &&
          draft.effect.card.name === 'standard:slash' &&
          ctx.world.player(draft.effect.target).alive &&
          axeMaterials(ctx, self).length >= 2,
        async effect(ctx, draft, self) {
          const model = new JointSelection({
            cards: () =>
              axeMaterials(ctx, self).map((id) => ({
                id,
                label: cardLabel(ctx, id),
              })),
            cardCount: { min: 2, max: 2 },
          });
          const answer = await ctx.ask(
            model.decision(self.owner, '贯石斧：弃置两张其他牌，使此杀仍造成伤害', {
              optional: true,
              cancelLabel: '不发动',
            }),
          );
          if (answer.kind !== 'chosen') return;
          const paid = await payDiscard(ctx, {
            skill: self,
            cards: answer.value.cards,
            reason: self.skill,
            factKind: 'skill.invoked',
            declaration: { label: self.name, effect: draft.effect.effectId },
            legal: (at) =>
              !draft.broken &&
              at.world.player(draft.effect.target).alive &&
              answer.value.cards.every((id) => axeMaterials(at, self).includes(id)),
          });
          if (paid.kind === 'paid') draft.breakDefense(self.skill);
        },
      }),
    ],
  } satisfies SkillDefinition,
});

const halberd = equipmentCard({
  id: 'standard:halberd',
  label: '方天画戟',
  slot: 'weapon',
  range: 4,
  skill: {
    id: 'standard:halberd-ability',
    name: '方天画戟',
    modifiers: [
      modify(cardQueries.extraTargets, (ctx, { input: request, self }) => {
        const hand = ownedCards(ctx.world, self.owner);
        return request.actor === self.owner &&
          request.card.name === 'standard:slash' &&
          !request.card.materials.includes(self.origin?.id ?? '') &&
          hand.length > 0 &&
          hand.every((id) => request.card.materials.includes(id))
          ? 2
          : undefined;
      }),
    ],
  } satisfies SkillDefinition,
});

const kylinBow = equipmentCard({
  id: 'standard:kylin_bow',
  label: '麒麟弓',
  slot: 'weapon',
  range: 5,
  skill: {
    id: 'standard:kylin_bow-ability',
    name: '麒麟弓',
    triggers: [
      on(Damage.causing, {
        when: (ctx, draft, self) =>
          isDirectDamage(draft.input) &&
          draft.input.from === self.owner &&
          draft.input.card?.actor === self.owner &&
          draft.input.card.card.name === 'standard:slash' &&
          !draft.prevented &&
          draft.amount > 0 &&
          ctx.world.player(draft.input.to).alive &&
          horses(ctx, self.owner, draft.input.to).length > 0,
        async effect(ctx, draft, self) {
          const target = draft.input.to;
          const model = new JointSelection({
            cards: () =>
              horses(ctx, self.owner, target).map((id) => ({
                id,
                label: cardLabel(ctx, id),
              })),
            cardCount: { min: 1, max: 1 },
          });
          const answer = await ctx.ask(
            model.decision(self.owner, `麒麟弓：可弃置 ${target} 的一张坐骑`, {
              optional: true,
              cancelLabel: '不发动',
            }),
          );
          if (answer.kind !== 'chosen') return;
          const card = answer.value.cards[0]!;
          const paid = await pay(ctx, {
            skill: self,
            reason: self.skill,
            factKind: 'skill.invoked',
            declaration: { label: self.name, card, target },
            legal: (at) =>
              !draft.prevented &&
              draft.amount > 0 &&
              at.world.player(target).alive &&
              horses(at, self.owner, target).includes(card),
          });
          if (
            paid.kind !== 'paid' ||
            isGameOver(ctx.world) ||
            !ctx.world.player(target).alive ||
            !horses(ctx, self.owner, target).includes(card)
          )
            return;
          const discarded = await discardCards(ctx, {
            actor: self.owner,
            owner: target,
            cards: [card],
            reason: self.skill,
          });

          if (discarded.kind !== 'discarded') return;
          ctx.commit('weapon.horse-discarded', [], {
            actor: self.owner,
            name: self.name,
            target,
            card,
          });
        },
      }),
    ],
  } satisfies SkillDefinition,
});

export const advancedWeapons: readonly CardDefinition[] = [blade, axe, halberd, kylinBow];

function horses(ctx: Context, actor: string, target: string): readonly string[] {
  return [
    ...equipmentInSlot(ctx.world, rulesOf(ctx), target, 'offensive-horse'),
    ...equipmentInSlot(ctx.world, rulesOf(ctx), target, 'defensive-horse'),
  ].filter((card) =>
    rulesOf(ctx).canDiscard(ctx, {
      actor,
      owner: target,
      card,
      reason: 'standard:kylin_bow-ability',
    }),
  );
}
