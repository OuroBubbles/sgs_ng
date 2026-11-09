import { card, damage, respond, responseTimes } from '../../../sdk';

export default card({
  id: 'standard:duel',
  type: 'trick',
  label: '决斗',
  kind: 'duel',
  description: '对一名其他角色使用。从目标开始轮流打出杀，首先未打出者受到对方造成的 1 点伤害。',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => target !== request.actor,
    async resolve(ctx, { effect }) {
      let responder = effect.target;
      let opponent = effect.actor;
      while (ctx.world.player(responder).alive && ctx.world.player(opponent).alive) {
        const count = responseTimes(ctx, effect, responder, 'standard:slash');
        let answered = count > 0;
        for (let i = 0; i < count; i++) {
          const response = await respond(ctx, responder, ['standard:slash'], effect);
          if (response.kind !== 'responded') {
            answered = false;
            break;
          }
        }
        if (!answered) {
          await damage(ctx, {
            from: opponent,
            to: responder,
            amount: 1,
            nature: 'normal',
            card: effect,
          });
          break;
        }
        [responder, opponent] = [opponent, responder];
      }
    },
  },
});
