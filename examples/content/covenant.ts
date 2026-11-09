import {
  on,
  modify,
  cardQueries,
  defineMark,
  draw,
  isGameOver,
  skill,
  Damage,
  Turn,
} from '../../src/sdk';
import type { Mark } from '../../src/sdk';

type Pledge = { readonly remaining: number } | null;

/**
 * 作者示例：持续效果就是一个带 skill 的标记。
 * 守约挂在受益者身上：手牌上限 +1；下一次受到的正伤害减一（只一次）；
 * 受益者的回合结束时兑现——清除标记并摸一张牌。宣告者离场不影响它；受益者阵亡后它不再生效。
 */
export const covenant: Mark<Pledge> = defineMark<Pledge>('covenant:promise', null, {
  skill: skill(
    'covenant:promise',
    '守约',
    '手牌上限 +1；下一次受到的伤害减一；你的回合结束时兑现并摸一张牌。',
    modify(cardQueries.handLimitCorrection, (_ctx, { input, self }) =>
      input.actor === self.owner ? 1 : undefined,
    ),
    on(Damage.inflicting, {
      locked: true,
      when: (ctx, hit, self) =>
        hit.input.to === self.owner &&
        hit.amount > 0 &&
        !hit.prevented &&
        covenant.of(ctx, self.owner)!.remaining > 0,
      effect(ctx, hit, self) {
        hit.adjust(-1, 'covenant:promise');
        covenant.set(ctx, self.owner, { remaining: covenant.of(ctx, self.owner)!.remaining - 1 });
      },
    }),
    on(Turn.ending, {
      locked: true,
      who: (turn) => turn.owner,
      async effect(ctx, _turn, self) {
        covenant.set(ctx, self.owner, null);
        if (!isGameOver(ctx.world))
          await draw(ctx, { player: self.owner, count: 1, reason: 'covenant:fulfilled' });
      },
    }),
  ),
});
