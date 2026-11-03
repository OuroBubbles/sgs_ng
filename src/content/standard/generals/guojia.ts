import {
  alive,
  damageReceived,
  general,
  give,
  isGameOver,
  judgmentFinished,
  nth,
  obtainJudgment,
  select,
  selection,
  skill,
  trigger,
  withPrivateTopCards,
} from '../../../sdk';

export const tiandu = skill({
  id: 'standard:tiandu',
  name: '天妒',
  description: '你的判定结束后，你可以获得仍在处理区中的判定牌。',
  triggers: [
    trigger(judgmentFinished, {
      who: (judgment) => judgment.player,
      when: (ctx, judgment) =>
        judgment.card !== null && ctx.world.position(judgment.card.id) === judgment.processing,
      ask: '是否发动【天妒】获得此判定牌？',
      keep: (ctx, judgment) => ctx.world.position(judgment.card!.id) === judgment.processing,
      effect: (ctx, judgment, self) => obtainJudgment(ctx, self.owner, judgment, self.skill),
    }),
  ],
});

export const yiji = skill({
  id: 'standard:yiji',
  name: '遗计',
  description:
    '每受到 1 点伤害后，你可以观看牌堆顶两张牌，将它们以任意方式交给角色，也可留给自己。它们暂存于仅你可见的牌池，不视为摸牌。',
  triggers: [
    trigger(damageReceived, {
      who: (hit) => hit.input.to,
      times: (_ctx, hit) => hit.amount,
      ask: (_ctx, _hit, _self, at) => `是否发动【遗计】观看并分配牌堆顶两张牌？${nth(at)}`,
      effect: (ctx, _hit, self) =>
        withPrivateTopCards(
          ctx,
          { player: self.owner, count: 2, reason: self.skill },
          async (at, pool) => {
            const live = () => alive(at, self.owner) && !isGameOver(at.world);
            const model = selection({
              cards: () =>
                live() ? pool.remaining().map((id) => ({ id, label: at.world.card(id).name })) : [],
              targets: () =>
                live() ? at.world.snapshot.players.filter((p) => p.alive).map((p) => p.id) : [],
              cardCount: { min: 1, max: 'all' },
              targetCount: { min: 1, max: 1 },
            });
            while (pool.remaining().length && live()) {
              const picked = await select(
                at,
                self.owner,
                model,
                '遗计：选择牌和一名接收者，可分批交出',
                {
                  cancel: '保留余牌',
                  reason: self.skill,
                },
              );
              if (!picked) break;
              await give(at, {
                actor: self.owner,
                target: picked.targets[0]!,
                cards: picked.cards,
                reason: self.skill,
              });
            }
            await give(at, {
              actor: self.owner,
              target: self.owner,
              cards: pool.remaining(),
              reason: self.skill,
            });
          },
        ),
    }),
  ],
  ai: { targets: 'ally' },
});

export default general({
  id: 'standard:guojia',
  name: '郭嘉',
  kingdom: '魏',
  hp: 3,
  skills: [tiandu, yiji],
});
