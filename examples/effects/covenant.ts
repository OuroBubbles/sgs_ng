import {
  defineEffect,
  effectOn,
  effectModify,
  cardQueries,
  damageInflicting,
  turnEnding,
  deathFinished,
  draw,
  isGameOver,
} from '../../src/sdk';

interface Covenant {
  readonly target: string;
  readonly remaining: number;
}

/** 作者示例：宣告者离场后仍守约；目标回合结束兑现，目标死亡则撤销。
 * 下次正伤害在防御窗口减一并消耗次数，之后再被其他效果防止也不返还次数。
 */
export const covenant = defineEffect<Covenant>({
  id: 'covenant:promise',
  name: '守约',
  accepts: (value): value is Covenant =>
    value !== null &&
    typeof value === 'object' &&
    'target' in value &&
    typeof value.target === 'string' &&
    'remaining' in value &&
    typeof value.remaining === 'number' &&
    Number.isSafeInteger(value.remaining) &&
    value.remaining >= 0,
  create(self) {
    return {
      modifiers: [
        effectModify(cardQueries.handLimitCorrection, (ctx, input) =>
          input.actor === self.data.target && ctx.world.player(input.actor).alive ? 1 : undefined,
        ),
      ],
      triggers: [
        effectOn(damageInflicting, {
          id: 'protect',
          when: (_ctx, hit) =>
            hit.input.to === self.data.target &&
            hit.amount > 0 &&
            !hit.prevented &&
            self.data.remaining > 0,
          async run(ctx, hit) {
            hit.adjust(-1, 'covenant:promise');
            ctx.unwrap(
              await self.update(ctx, { ...self.data, remaining: self.data.remaining - 1 }),
            );
          },
        }),
        effectOn(turnEnding, {
          id: 'fulfill',
          when: (_ctx, turn) => turn.owner === self.data.target,
          async run(ctx) {
            ctx.unwrap(await self.end(ctx, 'covenant:fulfilled'));
          },
        }),
        effectOn(deathFinished, {
          id: 'target-died',
          group: 'after',
          when: (_ctx, death) => death.player === self.data.target,
          async run(ctx) {
            ctx.unwrap(await self.end(ctx, 'covenant:target-died'));
          },
        }),
      ],
    };
  },
  async onEnd(ctx, before, reason) {
    if (
      reason === 'covenant:fulfilled' &&
      ctx.world.player(before.data.target).alive &&
      !isGameOver(ctx.world)
    )
      ctx.unwrap(
        await draw(ctx, { player: before.data.target, count: 1, reason: 'covenant:fulfilled' }),
      );
  },
});
