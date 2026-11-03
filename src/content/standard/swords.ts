import {
  chooseOwnedCard,
  differentGender,
  draw,
  equipment,
  isGameOver,
  dealtWith,
  landing,
  discardCards,
  on,
  ownedCards,
  rulesOf,
  Target,
  Damage,
  select,
  selection,
  discardable,
} from '../../sdk';
import type { CardDefinition } from '../../sdk';
import { Weapon } from './weapons';

const doubleSwords = equipment(
  'standard:double_swords',
  '雌雄双股剑',
  { weapon: 2 },
  on(Target.specified, {
    when: (ctx, { effect }, self) =>
      effect.actor === self.owner &&
      effect.state === 'targeting' &&
      effect.card.name === 'standard:slash' &&
      differentGender(ctx.world, self.owner, effect.target),
    ask: (_ctx, { effect }) => `是否对 ${effect.target} 发动【雌雄双股剑】？`,
    keep: (at, { effect }, self) =>
      effect.state === 'targeting' &&
      at.world.player(effect.target).alive &&
      differentGender(at.world, self.owner, effect.target),
    async effect(ctx, { effect: { target } }, self) {
      const picked = await select(
        ctx,
        target,
        selection(ctx, {
          cards: () =>
            !ctx.world.player(target).alive || isGameOver(ctx.world)
              ? []
              : discardable(ctx, target, self.skill),
          cardCount: { min: 1, max: 1 },
        }),
        `雌雄双股剑：弃置一张手牌，否则 ${self.owner} 摸一张牌`,
        { cancel: '令对方摸牌' },
      );
      const card = picked?.cards[0];
      if (card && ctx.world.player(target).alive && ownedCards(ctx.world, target).includes(card)) {
        const moved = await discardCards(ctx, {
          actor: target,
          owner: target,
          cards: [card],
          reason: self.skill,
        });
        if (moved.kind === 'discarded') return;
      }
      await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
    },
  }),
);

const iceSword = equipment(
  'standard:ice_sword',
  '寒冰剑',
  { weapon: 2 },
  on(Damage.replacing, {
    when: (ctx, draft, self) =>
      dealtWith(draft, self.owner, 'standard:slash') &&
      landing(ctx, draft) &&
      ownedCards(ctx.world, draft.input.to, ['hand', 'equipment']).some((card) =>
        rulesOf(ctx).canDiscard(ctx, {
          actor: self.owner,
          owner: draft.input.to,
          card,
          reason: self.skill,
        }),
      ),
    cost: async (ctx, draft, self) => {
      const first = await chooseOwnedCard(ctx, {
        actor: self.owner,
        target: draft.input.to,
        areas: ['hand', 'equipment'],
        reason: self.skill,
        discard: true,
        optional: true,
        prompt: `寒冰剑：选择弃置 ${draft.input.to} 的第一张牌，确认后发动并防止伤害`,
      });
      return first.kind === 'chosen' ? first : null;
    },
    declare: (_ctx, draft, self, first) => ({
      legal: (at) =>
        landing(at, draft) &&
        at.world.position(first.card) === first.from &&
        rulesOf(at).canDiscard(at, {
          actor: self.owner,
          owner: draft.input.to,
          card: first.card,
          reason: self.skill,
        }),
    }),
    async effect(ctx, draft, self, first) {
      const target = draft.input.to;
      if (!landing(ctx, draft)) return;
      draft.prevent(self.skill);
      ctx.commit(Weapon.damageReplaced, [], {
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
      }
    },
  }),
);

export const remainingSwords: readonly CardDefinition[] = [doubleSwords, iceSword];
