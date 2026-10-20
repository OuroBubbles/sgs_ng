import {
  attackDefended,
  cardQueries,
  damageCausing,
  defineSkill,
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
} from '../../sdk';
import type { CardBook, CardDefinition, Context, SkillHandle } from '../../sdk';

function axeMaterials(ctx: Context, book: CardBook, self: SkillHandle): readonly string[] {
  return ownedCards(ctx.world, self.owner, ['hand', 'equipment']).filter(
    (id) =>
      id !== self.origin?.id &&
      book.canDiscard(ctx, { actor: self.owner, owner: self.owner, card: id, reason: self.skill }),
  );
}

const blade = equipmentCard({
  id: 'standard:blade',
  label: '青龙偃月刀',
  slot: 'weapon',
  range: 3,
  skill: (book) =>
    defineSkill({
      id: 'standard:blade-ability',
      name: '青龙偃月刀',
      effects: [
        on(attackDefended, {
          id: 'follow-up',
          order: 'choose',
          when: (ctx, draft, self) =>
            !draft.broken &&
            draft.effect.card.name === 'standard:slash' &&
            draft.effect.actor === self.owner &&
            ctx.world.player(draft.effect.target).alive,
          async run(ctx, draft, self) {
            const used = await book.askUse(ctx, {
              actor: self.owner,
              names: ['standard:slash'],
              targets: [draft.effect.target],
              timing: { kind: 'effect', ignoreDistance: true },
              prompt: `青龙偃月刀：可对 ${draft.effect.target} 再使用一张杀（忽略距离与阶段次数）`,
              available: (at) =>
                self.effective(at.world) &&
                !draft.broken &&
                at.world.player(draft.effect.target).alive,
            });
            if (used.kind === 'resolved' && used.value.kind === 'used')
              ctx.commit('weapon.follow-up', [], {
                actor: self.owner,
                name: self.name,
                fromEffect: draft.effect.effectId,
                use: used.value.use.id,
              });
          },
        }),
      ],
    }),
});

const axe = equipmentCard({
  id: 'standard:axe',
  label: '贯石斧',
  slot: 'weapon',
  range: 3,
  skill: (book) =>
    defineSkill({
      id: 'standard:axe-ability',
      name: '贯石斧',
      effects: [
        on(attackDefended, {
          id: 'break-defense',
          order: 'choose',
          when: (ctx, draft, self) =>
            !draft.broken &&
            draft.effect.actor === self.owner &&
            draft.effect.card.name === 'standard:slash' &&
            ctx.world.player(draft.effect.target).alive &&
            axeMaterials(ctx, book, self).length >= 2,
          async run(ctx, draft, self) {
            const model = new JointSelection({
              cards: () =>
                axeMaterials(ctx, book, self).map((id) => ({
                  id,
                  label: book.definition(ctx.world.card(id).name).label,
                })),
              targets: () => [],
              cardCount: { min: 2, max: 2 },
              targetCount: { min: 0, max: 0 },
            });
            const answer = await ctx.ask(
              model.decision(self.owner, '贯石斧：弃置两张其他牌，使此杀仍造成伤害', true, {
                cancelLabel: '不发动',
              }),
            );
            if (answer.kind !== 'chosen') return;
            const paid = await payDiscard(ctx, book, {
              actor: self.owner,
              skill: self,
              cards: answer.value.cards,
              reason: self.skill,
              factKind: 'skill.invoked',
              declaration: { label: self.name, effect: draft.effect.effectId },
              legal: (at) =>
                !draft.broken &&
                at.world.player(draft.effect.target).alive &&
                answer.value.cards.every((id) => axeMaterials(at, book, self).includes(id)),
            });
            if (paid.kind === 'resolved' && paid.value.kind === 'paid')
              draft.breakDefense(self.skill);
          },
        }),
      ],
    }),
});

const halberd = equipmentCard({
  id: 'standard:halberd',
  label: '方天画戟',
  slot: 'weapon',
  range: 4,
  skill: defineSkill({
    id: 'standard:halberd-ability',
    name: '方天画戟',
    effects: [],
    modifiers: [
      modify(cardQueries.extraTargets, (ctx, request, self) => {
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
  }),
});

const kylinBow = equipmentCard({
  id: 'standard:kylin_bow',
  label: '麒麟弓',
  slot: 'weapon',
  range: 5,
  skill: (book) =>
    defineSkill({
      id: 'standard:kylin_bow-ability',
      name: '麒麟弓',
      effects: [
        on(damageCausing, {
          id: 'discard-horse',
          order: 'choose',
          when: (ctx, draft, self) =>
            isDirectDamage(draft.input) &&
            draft.input.from === self.owner &&
            draft.input.card?.actor === self.owner &&
            draft.input.card.card.name === 'standard:slash' &&
            !draft.prevented &&
            draft.amount > 0 &&
            ctx.world.player(draft.input.to).alive &&
            horses(ctx, book, self.owner, draft.input.to).length > 0,
          async run(ctx, draft, self) {
            const target = draft.input.to;
            const model = new JointSelection({
              cards: () =>
                horses(ctx, book, self.owner, target).map((id) => ({
                  id,
                  label: book.definition(ctx.world.card(id).name).label,
                })),
              targets: () => [],
              cardCount: { min: 1, max: 1 },
              targetCount: { min: 0, max: 0 },
            });
            const answer = await ctx.ask(
              model.decision(self.owner, `麒麟弓：可弃置 ${target} 的一张坐骑`, true, {
                cancelLabel: '不发动',
              }),
            );
            if (answer.kind !== 'chosen') return;
            const card = answer.value.cards[0]!;
            const paid = await pay(ctx, {
              actor: self.owner,
              skill: self,
              cards: [],
              to: 'discard',
              reason: self.skill,
              factKind: 'skill.invoked',
              declaration: { label: self.name, card, target },
              legal: (at) =>
                !draft.prevented &&
                draft.amount > 0 &&
                at.world.player(target).alive &&
                horses(at, book, self.owner, target).includes(card),
            });
            if (
              paid.kind !== 'resolved' ||
              paid.value.kind !== 'paid' ||
              isGameOver(ctx.world) ||
              !ctx.world.player(target).alive ||
              !horses(ctx, book, self.owner, target).includes(card)
            )
              return;
            const discarded = await discardCards(ctx, book, {
              actor: self.owner,
              owner: target,
              cards: [card],
              reason: self.skill,
            });
            if (discarded.kind === 'aborted') return ctx.abort(discarded.reason);
            if (discarded.value.kind !== 'discarded') return;
            ctx.commit('weapon.horse-discarded', [], {
              actor: self.owner,
              name: self.name,
              target,
              card,
            });
          },
        }),
      ],
    }),
});

export const advancedWeapons: readonly CardDefinition[] = [blade, axe, halberd, kylinBow];

function horses(ctx: Context, book: CardBook, actor: string, target: string): readonly string[] {
  return [
    ...equipmentInSlot(ctx.world, book, target, 'offensive-horse'),
    ...equipmentInSlot(ctx.world, book, target, 'defensive-horse'),
  ].filter((card) =>
    book.canDiscard(ctx, { actor, owner: target, card, reason: 'standard:kylin_bow-ability' }),
  );
}
