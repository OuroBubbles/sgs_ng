import type { CardDefinition } from '../../sdk';
import { damage, recover, draw, resolveCounter, resolveAttack } from '../../sdk';
import { trickCards } from './tricks';
import { standardEquipment } from './equipment';
import { standardDelayed } from './delayed';
import { collateral } from './collateral';

/** 标准 + EX 的牌定义；实体牌表、角色与救援调度由各自装配器提供。 */
export const standardCards: readonly CardDefinition[] = [
  {
    id: 'standard:nullification',
    type: 'trick',
    label: '无懈可击',
    use: {
      count: { min: 0, max: 0 },
      target: () => false,
      timings: ['counter'],
      execute: (ctx, use, book) => resolveCounter(ctx, use, book),
    },
  },
  {
    id: 'standard:ex_nihilo',
    type: 'trick',
    label: '无中生有',
    counterable: true,
    use: {
      count: { min: 1, max: 1 },
      target: (_ctx, request, target) => request.actor === target,
      async resolve(ctx, effect) {
        ctx.unwrap(
          await draw(ctx, { player: effect.target, count: 2, reason: 'standard:ex_nihilo' }),
        );
      },
    },
  },
  {
    id: 'standard:slash',
    type: 'basic',
    label: '杀',
    response: true,
    use: {
      count: { min: 1, max: 1 },
      usage: { key: 'slash', max: 1 },
      target: (ctx, request, target, book) =>
        target !== request.actor &&
        book.withinDistance(
          ctx,
          request,
          target,
          book.attackRange(ctx, request.actor, request.card),
        ),
      async resolve(ctx, effect, book) {
        await resolveAttack(ctx, effect, book, { name: 'standard:jink', purpose: 'use' });
      },
    },
  },
  {
    id: 'standard:jink',
    type: 'basic',
    label: '闪',
    response: true,
    use: {
      count: { min: 0, max: 0 },
      target: () => false,
      timings: ['response'],
      execute: () => null,
    },
  },
  {
    id: 'standard:peach',
    type: 'basic',
    label: '桃',
    use: {
      count: { min: 1, max: 1 },
      target: (ctx, request, target) =>
        (request.timing.kind === 'rescue'
          ? target === request.timing.dying
          : target === request.actor) &&
        ctx.world.player(target).hp < ctx.world.player(target).maxHp,
      async resolve(ctx, effect) {
        if (ctx.world.player(effect.target).alive)
          ctx.unwrap(
            await recover(ctx, {
              from: effect.actor,
              to: effect.target,
              amount: 1,
              card: effect,
            }),
          );
      },
    },
  },
  {
    id: 'standard:duel',
    type: 'trick',
    label: '决斗',
    counterable: true,
    use: {
      count: { min: 1, max: 1 },
      target: (_ctx, request, target) => target !== request.actor,
      async resolve(ctx, effect, book) {
        let responder = effect.target;
        let opponent = effect.actor;
        while (ctx.world.player(responder).alive && ctx.world.player(opponent).alive) {
          const count = book.responseTimes(ctx, effect, responder, 'standard:slash');
          let answered = count > 0;
          for (let i = 0; i < count; i++) {
            const response = ctx.unwrap(
              await book.respond(ctx, responder, ['standard:slash'], effect),
            );
            if (response.kind !== 'responded') {
              answered = false;
              break;
            }
          }
          if (!answered) {
            ctx.unwrap(
              await damage(ctx, {
                from: opponent,
                to: responder,
                amount: 1,
                nature: 'normal',
                card: effect,
              }),
            );
            break;
          }
          [responder, opponent] = [opponent, responder];
        }
      },
    },
  },
  ...trickCards,
  collateral,
  ...standardEquipment,
  ...standardDelayed,
];
