import {
  alive,
  defineMark,
  discardable,
  on,
  others,
  Phase,
  scheduleExtraTurn,
  select,
  selection,
  skill,
  Turn,
} from '../../../sdk';

/** 本回合是否已以放权跳过出牌阶段；回合结束自动清除。 */
const skipped = defineMark('standard:fangquan-skipped', false, { scope: 'turn' });

export default skill(
  'standard:fangquan',
  '放权',
  '你可以跳过你的出牌阶段，然后此回合结束时，你可以弃置一张手牌并选择一名其他角色，然后其获得一个额外回合。',
  on(Phase.before, {
    who: (phase) => phase.owner,
    when: (_ctx, phase) => phase.kind === 'play' && !phase.skipped && !!phase.turn,
    ask: '是否发动【放权】跳过出牌阶段？',
    keep: (_ctx, phase) => !phase.skipped && !phase.turn?.ended,
    declare: (ctx, phase, self) => ({
      changes: [phase.skipChange(ctx, self.skill), skipped.change(ctx, self.owner, true)],
    }),
  }),
  on(Turn.ending, {
    id: 'standard:fangquan/extra-turn',
    who: (turn) => turn.owner,
    when: (ctx, _turn, self) =>
      skipped.of(ctx, self.owner) && discardable(ctx, self.owner, self.skill).length > 0,
    // 选牌与目标即发动；取消视为不发动。
    cost: (ctx, _turn, self) =>
      select(
        ctx,
        self.owner,
        selection(ctx, {
          cards: () => discardable(ctx, self.owner, self.skill),
          cardCount: { min: 1, max: 1 },
          targets: () => others(ctx, self.owner).filter((id) => alive(ctx, id)),
          targetCount: { min: 1, max: 1 },
        }),
        '放权：弃置一张手牌，令一名其他角色获得一个额外回合',
      ),
    declare: (_ctx, _turn, _self, picked) => ({
      discard: picked.cards,
      areas: ['hand'],
      data: { targets: picked.targets },
      legal: () => picked.valid(),
    }),
    effect(ctx, _turn, self, picked) {
      const [target] = picked.targets;
      if (target && alive(ctx, target))
        scheduleExtraTurn(ctx, { owner: target, reason: self.skill });
    },
  }),
);
