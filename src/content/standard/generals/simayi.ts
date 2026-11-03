import {
  alive,
  cardLabel,
  chooseOwnedCard,
  face,
  general,
  HE,
  isGameOver,
  ownedCards,
  rulesOf,
  select,
  selection,
  skill,
  takeCard,
  on,
  Judgment,
  Damage,
} from '../../../sdk';
import type { Context, SkillHandle } from '../../../sdk';

function retrialCards(ctx: Context, self: SkillHandle, judgment: Judgment): readonly string[] {
  if (
    !alive(ctx, self.owner) ||
    !self.effective(ctx.world) ||
    !alive(ctx, judgment.player) ||
    isGameOver(ctx.world)
  )
    return [];
  const rules = rulesOf(ctx);
  return ownedCards(ctx.world, self.owner).filter(
    (id) => !rules.isResponseProhibited(ctx, self.owner, rules.physicalCard(ctx, id)),
  );
}

export const guicai = skill({
  id: 'standard:guicai',
  name: '鬼才',
  description: '一名角色的判定牌生效前，你可以打出一张手牌代替之。任意牌型均可，但须满足打出禁令。',
  triggers: [
    on(Judgment.retrial, {
      when: (ctx, judgment, self) =>
        judgment.card !== null && retrialCards(ctx, self, judgment).length > 0,
      async effect(ctx, judgment, self) {
        const cards = () => retrialCards(ctx, self, judgment);
        const picked = await select(
          ctx,
          self.owner,
          selection({
            cards: () => cards().map((id) => ({ id, label: cardLabel(ctx, id) })),
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
          response: rulesOf(ctx).physicalCard(ctx, card),
        });
      },
    }),
  ],
});

export const fankui = skill({
  id: 'standard:fankui',
  name: '反馈',
  description: '受到一次伤害后，你可以获得伤害来源的一张手牌或装备。若伤害来源是你，只能选择装备。',
  triggers: [
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
      // 先选牌，确认即发动；宣告后效若已移走所选牌则不再追取。
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
      keep: (ctx, hit, _self, chosen) =>
        alive(ctx, hit.input.from!) && ctx.world.position(chosen!.card) === chosen!.from,
      effect: (ctx, hit, self, { card, from }) =>
        takeCard(ctx, {
          actor: self.owner,
          target: hit.input.from!,
          card,
          from,
          reason: self.skill,
        }),
    }),
  ],
});
const areas = (source: string, self: SkillHandle) =>
  source === self.owner ? ['equipment' as const] : HE;

export default general({
  id: 'standard:simayi',
  name: '司马懿',
  kingdom: '魏',
  hp: 3,
  skills: [guicai, fankui],
});
