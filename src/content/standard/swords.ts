import {
  chooseOwnedCard,
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
  pay,
  rulesOf,
  cardLabel,
  Target,
  Damage,
} from '../../sdk';
import type { CardDefinition } from '../../sdk';
import type { SkillDefinition } from '../../sdk';

const doubleSwords = equipmentCard({
  id: 'standard:double_swords',
  label: '雌雄双股剑',
  slot: 'weapon',
  range: 2,
  skill: {
    id: 'standard:double_swords-ability',
    name: '雌雄双股剑',
    triggers: [
      on(Target.specified, {
        when: (ctx, { effect }, self) =>
          effect.actor === self.owner &&
          effect.state === 'targeting' &&
          effect.card.name === 'standard:slash' &&
          differentGender(ctx.world, self.owner, effect.target),
        async effect(ctx, { effect }, self) {
          const invoked = await invoke(
            ctx,
            self,
            `是否对 ${effect.target} 发动【雌雄双股剑】？`,
            (at) =>
              effect.state === 'targeting' &&
              at.world.player(effect.target).alive &&
              differentGender(at.world, self.owner, effect.target),
          );
          if (!invoked) return;
          const model = new JointSelection({
            cards: () =>
              !ctx.world.player(effect.target).alive || isGameOver(ctx.world)
                ? []
                : ownedCards(ctx.world, effect.target)
                    .filter((card) =>
                      rulesOf(ctx).canDiscard(ctx, {
                        actor: effect.target,
                        owner: effect.target,
                        card,
                        reason: self.skill,
                      }),
                    )
                    .map((id) => ({
                      id,
                      label: cardLabel(ctx, id),
                    })),
            cardCount: { min: 1, max: 1 },
          });
          const choice = await ctx.ask(
            model.decision(effect.target, `雌雄双股剑：弃置一张手牌，否则 ${self.owner} 摸一张牌`, {
              optional: true,
              cancelLabel: '令对方摸牌',
            }),
          );
          if (choice.kind === 'chosen') {
            const card = choice.value.cards[0]!;
            if (
              ctx.world.player(effect.target).alive &&
              ownedCards(ctx.world, effect.target).includes(card)
            ) {
              const from = ctx.world.position(card);
              const moved = await discardCards(ctx, {
                actor: effect.target,
                owner: effect.target,
                cards: [card],
                reason: self.skill,
              });

              if (moved.kind === 'discarded') {
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
          await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
        },
      }),
    ],
  } satisfies SkillDefinition,
});

const iceSword = equipmentCard({
  id: 'standard:ice_sword',
  label: '寒冰剑',
  slot: 'weapon',
  range: 2,
  skill: {
    id: 'standard:ice_sword-ability',
    name: '寒冰剑',
    triggers: [
      on(Damage.replacing, {
        when: (ctx, draft, self) =>
          isDirectDamage(draft.input) &&
          draft.input.from === self.owner &&
          draft.input.card?.actor === self.owner &&
          draft.input.card.card.name === 'standard:slash' &&
          !draft.prevented &&
          draft.amount > 0 &&
          ctx.world.player(draft.input.to).alive &&
          ownedCards(ctx.world, draft.input.to, ['hand', 'equipment']).some((card) =>
            rulesOf(ctx).canDiscard(ctx, {
              actor: self.owner,
              owner: draft.input.to,
              card,
              reason: self.skill,
            }),
          ),
        async effect(ctx, draft, self) {
          const target = draft.input.to;
          const first = await chooseOwnedCard(ctx, {
            actor: self.owner,
            target,
            areas: ['hand', 'equipment'],
            reason: self.skill,
            discard: true,
            optional: true,
            prompt: `寒冰剑：选择弃置 ${target} 的第一张牌，确认后发动并防止伤害`,
          });
          if (first.kind !== 'chosen') return;
          const paid = await pay(ctx, {
            skill: self,
            reason: self.skill,
            factKind: 'skill.invoked',
            declaration: { label: self.name },
            legal: (at) =>
              !draft.prevented &&
              draft.amount > 0 &&
              at.world.player(target).alive &&
              at.world.position(first.card) === first.from &&
              rulesOf(at).canDiscard(at, {
                actor: self.owner,
                owner: target,
                card: first.card,
                reason: self.skill,
              }),
          });
          if (
            paid.kind !== 'paid' ||
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
            // 第一张在宣告前选定；第二张等待第一次弃牌的全部后效后重新选择。
            const chosen =
              i === 0
                ? first
                : await chooseOwnedCard(ctx, {
                    actor: self.owner,
                    target,
                    areas: ['hand', 'equipment'],
                    reason: self.skill,
                    discard: true,
                    prompt: `寒冰剑：弃置 ${target} 的第 ${i + 1} 张牌`,
                  });

            if (chosen.kind !== 'chosen') break;
            const { card, from } = chosen;
            if (ctx.world.position(card) !== from) break;
            const moved = await discardCards(ctx, {
              actor: self.owner,
              owner: target,
              cards: [card],
              reason: self.skill,
            });

            if (moved.kind !== 'discarded') break;
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
  } satisfies SkillDefinition,
});

export const remainingSwords: readonly CardDefinition[] = [doubleSwords, iceSword];
