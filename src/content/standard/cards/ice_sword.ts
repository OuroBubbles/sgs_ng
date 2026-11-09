import {
  canDiscard,
  chooseOwnedCard,
  Damage,
  dealtWith,
  discardCards,
  equipment,
  isGameOver,
  landing,
  on,
  ownedCards,
} from '../../../sdk';
import { Weapon } from '../card-kit';

export default equipment(
  'standard:ice_sword',
  '寒冰剑',
  { weapon: 2 },
  '武器，攻击范围 2。你的杀将造成伤害时，可防止该伤害，依次弃置目标至多两张手牌或装备。每次选择都按当前区域重新生成。',
  on(Damage.replacing, {
    when: (ctx, draft, self) =>
      dealtWith(draft, self.owner, 'standard:slash') &&
      landing(ctx, draft) &&
      ownedCards(ctx.world, draft.input.to, ['hand', 'equipment']).some((card) =>
        canDiscard(ctx, {
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
        canDiscard(at, {
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
