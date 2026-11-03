import {
  activeTarget,
  activeTurn,
  on,
  general,
  isDirectDamage,
  readState,
  rulesOf,
  skill,
  Cards,
  Damage,
} from '../../../sdk';
import type { EffectDefinition } from '../../../sdk';

interface LuoyiData {
  readonly actor: string;
  readonly turn: string;
}
/** 裸衣的本回合加伤：独立于技能存在，失去裸衣不会移除。 */
export const luoyiAftereffect = {
  id: 'standard:luoyi-effect',
  name: '裸衣',
  accepts: (value): value is LuoyiData =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<LuoyiData>).actor === 'string' &&
    typeof (value as Partial<LuoyiData>).turn === 'string',
  create: (self) => ({
    triggers: [
      on(Damage.causing, {
        when: (ctx, hit) =>
          ctx.world.player(self.data.actor).alive &&
          readState(ctx.world, activeTurn, activeTarget)?.id === self.data.turn &&
          isDirectDamage(hit.input) &&
          !hit.prevented &&
          hit.input.from === self.data.actor &&
          hit.input.card?.actor === self.data.actor &&
          ['standard:slash', 'standard:duel'].includes(hit.input.card?.card.name ?? ''),
        effect: (_ctx, hit) => hit.adjust(1, 'standard:luoyi'),
      }),
    ],
  }),
} satisfies EffectDefinition<LuoyiData>;

export const luoyi = skill({
  id: 'standard:luoyi',
  name: '裸衣',
  description:
    '摸牌阶段，你可以少摸一张牌。若如此做，本回合你使用杀或决斗造成的伤害加 1。已发动的效果不因失去裸衣而消失。',
  triggers: [
    on(Cards.drawing, {
      who: (draft) => draft.input.player,
      when: (_ctx, draft) => draft.phase?.kind === 'draw' && !!draft.phase.turn && draft.count > 0,
      ask: '是否发动【裸衣】少摸一张牌，本回合杀和决斗伤害加 1？',
      keep: (_ctx, draft) => draft.count > 0 && !draft.phase!.turn!.ended,
      // 重复摸牌阶段可以再次少摸，但同一角色/回合只保留一份伤害加成。
      async declare(ctx, draft, self) {
        const turn = draft.phase!.turn!;
        const effects = rulesOf(ctx).effects;
        const existing = effects
          .instances(ctx.world, luoyiAftereffect)
          .find((entry) => entry.data.actor === self.owner && entry.data.turn === turn.id);
        if (existing) return { data: { effect: existing } };
        const prepared = await effects.prepare(ctx, luoyiAftereffect, {
          owner: self.owner,
          lifetime: turn.lifetime,
          origin: { actor: self.owner, skill: self.skill, instance: self.id },
          data: { actor: self.owner, turn: turn.id },
        });
        return { data: { effect: prepared.record }, changes: [prepared.change] };
      },
      effect: (_ctx, draft, self) => draft.setCount(Math.max(0, draft.count - 1), self.skill),
    }),
  ],
});

export default general('standard:xuchu', '许褚', '魏', 4, [luoyi]);
