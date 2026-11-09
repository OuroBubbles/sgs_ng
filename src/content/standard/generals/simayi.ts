import type { Context, SkillHandle } from '../../../sdk';
import {
  alive,
  chooseOwnedCard,
  face,
  general,
  HE,
  isGameOver,
  ownedCards,
  select,
  selection,
  skill,
  takeCard,
  on,
  Judgment,
  Damage,
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

export const guicai = skill(
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

export const fankui = skill(
  'standard:fankui',
  '反馈',
  '受到一次伤害后，你可以获得伤害来源的一张手牌或装备。若伤害来源是你，只能选择装备。',
  on(Damage.received, {
    who: (hit) => hit.input.to,
    when: (ctx, hit, self) => {
      const source = hit.input.from;
      return (
        source !== null &&
        alive(ctx, source) &&
        ownedCards(ctx.world, source, areas(source, self)).length > 0
      );
    },
    // 先选牌，确认即发动；takeCard 只取仍在原位的所选牌。
    async cost(ctx, hit, self) {
      const source = hit.input.from!;
      const chosen = await chooseOwnedCard(ctx, {
        actor: self.owner,
        target: source,
        areas: areas(source, self),
        reason: self.skill,
        prompt: '反馈：选择伤害来源的一张牌，确认后发动',
        optional: true,
      });
      return chosen.kind === 'chosen' ? chosen : null;
    },
    effect: (ctx, hit, self, { card, from }) =>
      takeCard(ctx, {
        actor: self.owner,
        target: hit.input.from!,
        card,
        from,
        reason: self.skill,
      }),
  }),
);
const areas = (source: string, self: SkillHandle) =>
  source === self.owner ? ['equipment' as const] : HE;

export default general('standard:simayi', '司马懿', '魏', 3, [guicai, fankui]);
