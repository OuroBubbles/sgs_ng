import {
  activeTarget,
  activeTurn,
  on,
  general,
  dealtWith,
  readState,
  rulesOf,
  skill,
  Cards,
  Damage,
  defineEffect,
} from '../../../sdk';

/** 裸衣的本回合加伤：独立于技能存在，失去裸衣不会移除；同一角色/回合只保留一份。 */
export const luoyiAftereffect = defineEffect({
  id: 'standard:luoyi-effect',
  name: '裸衣',
  data: { actor: '', turn: '' },
  key: (data) => `${data.actor}/${data.turn}`,
  create: (self) => ({
    triggers: [
      on(Damage.causing, {
        when: (ctx, hit) =>
          ctx.world.player(self.data.actor).alive &&
          readState(ctx.world, activeTurn, activeTarget)?.id === self.data.turn &&
          dealtWith(hit, self.data.actor, 'standard:slash', 'standard:duel'),
        effect: (_ctx, hit) => hit.adjust(1, 'standard:luoyi'),
      }),
    ],
  }),
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
    async declare(ctx, draft, self) {
      const turn = draft.phase!.turn!;
      const { record, changes } = await rulesOf(ctx).effects.prepare(ctx, luoyiAftereffect, {
        owner: self.owner,
        lifetime: turn.lifetime,
        origin: { actor: self.owner, skill: self.skill, instance: self.id },
        data: { actor: self.owner, turn: turn.id },
      });
      return { data: { effect: record }, changes };
    },
    effect: (_ctx, draft, self) => draft.setCount(Math.max(0, draft.count - 1), self.skill),
  }),
);

export default general('standard:xuchu', '许褚', '魏', 4, [luoyi]);
