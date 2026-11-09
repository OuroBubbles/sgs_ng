import type { Context, SkillHandle } from '../../../sdk';
import {
  alive,
  face,
  isGameOver,
  ownedCards,
  select,
  selection,
  skill,
  on,
  Judgment,
  isResponseProhibited,
  physicalCard,
} from '../../../sdk';

function retrialCards(ctx: Context, self: SkillHandle, judgment: Judgment): readonly string[] {
  if (
    !alive(ctx, self.owner) ||
    !self.active(ctx) ||
    !alive(ctx, judgment.player) ||
    isGameOver(ctx.world)
  )
    return [];
  return ownedCards(ctx.world, self.owner).filter(
    (id) => !isResponseProhibited(ctx, self.owner, physicalCard(ctx, id)),
  );
}

export default skill(
  'standard:guicai',
  '鬼才',
  '一名角色的判定牌生效前，你可以打出一张手牌代替之。任意牌型均可，但须满足打出禁令。',
  on(Judgment.retrial, {
    when: (ctx, judgment, self) =>
      judgment.card !== null && retrialCards(ctx, self, judgment).length > 0,
    async effect(ctx, judgment, self) {
      const cards = () => retrialCards(ctx, self, judgment);
      const picked = await select(
        ctx,
        self.owner,
        selection(ctx, {
          cards,
          cardCount: { min: 1, max: 1 },
        }),
        `鬼才：选择一张手牌，替换 ${judgment.player} 的判定牌`,
        {
          cancel: '不改判',
          reason: self.skill,
          describe: () => ({
            judgment: {
              player: judgment.player,
              reason: judgment.reason,
              card: judgment.card,
              // 改判供牌者的手牌面不等于接收者的判定面；只描述本人合法候选。
              alternatives: cards().map((id) => face(ctx, id, judgment.player)),
            },
          }),
        },
      );
      if (!picked) return;
      const card = picked.cards[0]!;
      await judgment.replace(ctx, {
        card,
        from: ctx.world.position(card),
        reason: self.skill,
        skill: self,
        legal: picked.valid,
        response: physicalCard(ctx, card),
      });
    },
  }),
);
