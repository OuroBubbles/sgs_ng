import {
  alive,
  chooseOwnedCard,
  general,
  isGameOver,
  others,
  ownedCards,
  select,
  selection,
  skill,
  takeCard,
  on,
  Phase,
} from '../../../sdk';
import type { Context, PhaseView, SkillHandle } from '../../../sdk';

const victims = (ctx: Context, self: SkillHandle, phase: PhaseView) =>
  selection(ctx, {
    targets: () =>
      !phase.replaced && alive(ctx, self.owner) && !isGameOver(ctx.world)
        ? others(ctx, self.owner).filter(
            (id) => alive(ctx, id) && ownedCards(ctx.world, id).length > 0,
          )
        : [],
    targetCount: { min: 1, max: 2 },
  });

export const tuxi = skill(
  'standard:tuxi',
  '突袭',
  '摸牌阶段开始时，你可以放弃默认摸牌，改为获得至多两名其他角色的各一张手牌。选择一至两人，按座次结算；这不是跳过摸牌阶段。',
  on(Phase.started, {
    who: (phase) => phase.owner,
    when: (ctx, phase, self) => phase.kind === 'draw' && victims(ctx, self, phase).available(),
    cost: (ctx, phase, self) =>
      select(ctx, self.owner, victims(ctx, self, phase), '突袭：选择一至两名角色，获得各一张手牌', {
        cancel: '正常摸牌',
        reason: self.skill,
      }),
    declare: (ctx, phase, self, picked) => ({
      data: { targets: picked.targets },
      legal: picked.valid,
      changes: [phase.replaceChange(ctx, self.skill)],
    }),
    async effect(ctx, _phase, self, picked) {
      for (const target of others(ctx, self.owner).filter((id) => picked.targets.includes(id))) {
        if (!ownedCards(ctx.world, target).length) continue;
        const chosen = await chooseOwnedCard(ctx, {
          actor: self.owner,
          target,
          areas: ['hand'],
          reason: self.skill,
        });
        if (chosen.kind === 'chosen')
          await takeCard(ctx, { actor: self.owner, target, ...chosen, reason: self.skill });
      }
    },
  }),
);

export default general('standard:zhangliao', '张辽', '魏', 4, [tuxi]);
