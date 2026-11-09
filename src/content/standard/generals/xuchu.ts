import { on, general, dealtWith, defineMark, skill, Cards, Damage } from '../../../sdk';

/**
 * 裸衣的本回合加伤是一个持续效果：许褚持有本回合标记即拥有加伤技能。
 * 失去裸衣不会移除它；回合结束随标记到期，嵌套的他人回合里也看不到它。
 */
export const stripped = defineMark('standard:luoyi', false, {
  scope: 'turn',
  skill: skill(
    'standard:luoyi-bonus',
    '裸衣',
    '本回合你使用杀或决斗造成的伤害加 1。',
    on(Damage.causing, {
      locked: true,
      when: (_ctx, hit, self) => dealtWith(hit, self.owner, 'standard:slash', 'standard:duel'),
      effect: (_ctx, hit) => hit.adjust(1, 'standard:luoyi'),
    }),
  ),
});

export const luoyi = skill(
  'standard:luoyi',
  '裸衣',
  '摸牌阶段，你可以少摸一张牌。若如此做，本回合你使用杀或决斗造成的伤害加 1。已发动的效果不因失去裸衣而消失。',
  on(Cards.drawing, {
    who: (draft) => draft.input.player,
    when: (_ctx, draft) => draft.phase?.kind === 'draw' && !!draft.phase.turn && draft.count > 0,
    ask: '是否发动【裸衣】少摸一张牌，本回合杀和决斗伤害加 1？',
    keep: (_ctx, draft) => draft.count > 0 && !draft.phase!.turn!.ended,
    declare: (ctx, _draft, self) => ({ changes: [stripped.change(ctx, self.owner, true)] }),
    effect: (_ctx, draft, self) => draft.setCount(Math.max(0, draft.count - 1), self.skill),
  }),
  stripped,
);

export default general('standard:xuchu', '许褚', '魏', 4, [luoyi]);
