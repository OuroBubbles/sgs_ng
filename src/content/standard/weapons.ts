import {
  cardQueries,
  equipmentCard,
  equipmentInSlot,
  isDirectDamage,
  modify,
  discardCards,
  on,
  ownedCards,
  rulesOf,
  Attack,
  Damage,
  defineEvent,
  timing,
  select,
  selection,
  discardable,
  HE,
} from '../../sdk';
import type { CardDefinition, Context, SkillHandle } from '../../sdk';

export const Weapon = defineEvent('weapon', {
  followUp: timing<unknown>(),
  horseDiscarded: timing<unknown>(),
  cardDiscarded: timing<unknown>(),
  damageReplaced: timing<unknown>(),
});

function axeMaterials(ctx: Context, self: SkillHandle): readonly string[] {
  return discardable(ctx, self.owner, self.skill, HE).filter((id) => id !== self.origin?.id);
}

const blade = equipmentCard({
  id: 'standard:blade',
  label: '青龙偃月刀',
  slot: 'weapon',
  range: 3,
  skill: {
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
            ctx.commit(Weapon.followUp, [], {
              actor: self.owner,
              name: self.name,
              fromEffect: draft.effect.effectId,
              use: used.use.id,
            });
        },
      }),
    ],
  },
});

const axe = equipmentCard({
  id: 'standard:axe',
  label: '贯石斧',
  slot: 'weapon',
  range: 3,
  skill: {
    triggers: [
      on(Attack.defended, {
        when: (ctx, draft, self) =>
          !draft.broken &&
          draft.effect.actor === self.owner &&
          draft.effect.card.name === 'standard:slash' &&
          ctx.world.player(draft.effect.target).alive &&
          axeMaterials(ctx, self).length >= 2,
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
    ],
  },
});

const halberd = equipmentCard({
  id: 'standard:halberd',
  label: '方天画戟',
  slot: 'weapon',
  range: 4,
  skill: {
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
  },
});

const kylinBow = equipmentCard({
  id: 'standard:kylin_bow',
  label: '麒麟弓',
  slot: 'weapon',
  range: 5,
  skill: {
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
            !draft.prevented &&
            draft.amount > 0 &&
            at.world.player(draft.input.to).alive &&
            horses(at, self.owner, draft.input.to).includes(picked.cards[0]!),
        }),
        async effect(ctx, draft, self, picked) {
          const [target, card] = [draft.input.to, picked.cards[0]!];
          if (!ctx.world.player(target).alive || !horses(ctx, self.owner, target).includes(card))
            return;
          const discarded = await discardCards(ctx, {
            actor: self.owner,
            owner: target,
            cards: [card],
            reason: self.skill,
          });
          if (discarded.kind === 'discarded')
            ctx.commit(Weapon.horseDiscarded, [], {
              actor: self.owner,
              name: self.name,
              target,
              card,
            });
        },
      }),
    ],
  },
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
