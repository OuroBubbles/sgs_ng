import {
  chooseOwnedCard,
  damageReplacing,
  defineSkill,
  differentGender,
  draw,
  equipmentCard,
  invoke,
  isGameOver,
  isDirectDamage,
  JointSelection,
  discardCards,
  on,
  ownedCards,
  targetSpecified,
} from '../../sdk';
import type { CardDefinition } from '../../sdk';

const doubleSwords = equipmentCard({
  id: 'standard:double_swords',
  label: '雌雄双股剑',
  slot: 'weapon',
  range: 2,
  skill: (book) =>
    defineSkill({
      id: 'standard:double_swords-ability',
      name: '雌雄双股剑',
      effects: [
        on(targetSpecified, {
          id: 'discard-or-draw',
          order: 'choose',
          when: (ctx, { effect }, self) =>
            effect.actor === self.owner &&
            effect.state === 'targeting' &&
            effect.card.name === 'standard:slash' &&
            differentGender(ctx.world, self.owner, effect.target),
          async run(ctx, { effect }, self) {
            const invoked = await invoke(
              ctx,
              self,
              `是否对 ${effect.target} 发动【雌雄双股剑】？`,
              (at) =>
                effect.state === 'targeting' &&
                at.world.player(effect.target).alive &&
                differentGender(at.world, self.owner, effect.target),
            );
            if (invoked.kind !== 'resolved' || !invoked.value) return;
            const model = new JointSelection({
              cards: () =>
                !ctx.world.player(effect.target).alive || isGameOver(ctx.world)
                  ? []
                  : ownedCards(ctx.world, effect.target)
                      .filter((card) =>
                        book.canDiscard(ctx, {
                          actor: effect.target,
                          owner: effect.target,
                          card,
                          reason: self.skill,
                        }),
                      )
                      .map((id) => ({
                        id,
                        label: book.definition(ctx.world.card(id).name).label,
                      })),
              targets: () => [],
              cardCount: { min: 1, max: 1 },
              targetCount: { min: 0, max: 0 },
            });
            const choice = await ctx.ask(
              model.decision(
                effect.target,
                `雌雄双股剑：弃置一张手牌，否则 ${self.owner} 摸一张牌`,
                true,
                { cancelLabel: '令对方摸牌' },
              ),
            );
            if (choice.kind === 'chosen') {
              const card = choice.value.cards[0]!;
              if (
                ctx.world.player(effect.target).alive &&
                ownedCards(ctx.world, effect.target).includes(card)
              ) {
                const from = ctx.world.position(card);
                const moved = await discardCards(ctx, book, {
                  actor: effect.target,
                  owner: effect.target,
                  cards: [card],
                  reason: self.skill,
                });
                if (moved.kind === 'aborted') return ctx.abort(moved.reason);
                if (moved.value.kind === 'discarded') {
                  ctx.commit('weapon.card-discarded', [], {
                    actor: self.owner,
                    name: self.name,
                    target: effect.target,
                    card,
                    from,
                  });
                  return;
                }
              }
            }
            if (ctx.world.player(self.owner).alive && !isGameOver(ctx.world))
              await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
          },
        }),
      ],
    }),
});

const iceSword = equipmentCard({
  id: 'standard:ice_sword',
  label: '寒冰剑',
  slot: 'weapon',
  range: 2,
  skill: (book) =>
    defineSkill({
      id: 'standard:ice_sword-ability',
      name: '寒冰剑',
      effects: [
        on(damageReplacing, {
          id: 'replace-damage',
          order: 'choose',
          when: (ctx, draft, self) =>
            isDirectDamage(draft.input) &&
            draft.input.from === self.owner &&
            draft.input.card?.actor === self.owner &&
            draft.input.card.card.name === 'standard:slash' &&
            !draft.prevented &&
            draft.amount > 0 &&
            ctx.world.player(draft.input.to).alive &&
            ownedCards(ctx.world, draft.input.to, ['hand', 'equipment']).some((card) =>
              book.canDiscard(ctx, {
                actor: self.owner,
                owner: draft.input.to,
                card,
                reason: self.skill,
              }),
            ),
          async run(ctx, draft, self) {
            const target = draft.input.to;
            const invoked = await invoke(
              ctx,
              self,
              `是否发动【寒冰剑】，防止伤害并弃置 ${target} 的至多两张牌？`,
              (at) =>
                !draft.prevented &&
                draft.amount > 0 &&
                at.world.player(target).alive &&
                ownedCards(at.world, target, ['hand', 'equipment']).some((card) =>
                  book.canDiscard(at, {
                    actor: self.owner,
                    owner: target,
                    card,
                    reason: self.skill,
                  }),
                ),
            );
            if (
              invoked.kind !== 'resolved' ||
              !invoked.value ||
              draft.prevented ||
              draft.amount < 1 ||
              isGameOver(ctx.world) ||
              !ctx.world.player(target).alive
            )
              return;
            draft.prevent(self.skill);
            ctx.commit('weapon.damage-replaced', [], {
              actor: self.owner,
              name: self.name,
              target,
              effect: draft.input.card!.effectId,
            });
            for (let i = 0; i < 2; i++) {
              if (
                !ctx.world.player(self.owner).alive ||
                !ctx.world.player(target).alive ||
                isGameOver(ctx.world) ||
                !ownedCards(ctx.world, target, ['hand', 'equipment']).length
              )
                break;
              const chosen = await chooseOwnedCard(ctx, book, {
                actor: self.owner,
                target,
                areas: ['hand', 'equipment'],
                reason: self.skill,
                discard: true,
                prompt: `寒冰剑：弃置 ${target} 的第 ${i + 1} 张牌`,
              });
              if (chosen.kind === 'aborted') return ctx.abort(chosen.reason);
              if (chosen.value.kind !== 'chosen') break;
              const { card, from } = chosen.value;
              const moved = await discardCards(ctx, book, {
                actor: self.owner,
                owner: target,
                cards: [card],
                reason: self.skill,
              });
              if (moved.kind === 'aborted') return ctx.abort(moved.reason);
              if (moved.value.kind !== 'discarded') break;
              ctx.commit('weapon.card-discarded', [], {
                actor: self.owner,
                name: self.name,
                target,
                card,
                from,
              });
            }
          },
        }),
      ],
    }),
});

export const remainingSwords: readonly CardDefinition[] = [doubleSwords, iceSword];
