import { draw, skill, on, Phase } from '../../../sdk';

export default skill(
  'standard:biyue',
  '闭月',
  '结束阶段，你可以摸一张牌。',
  on(Phase.started, {
    who: (phase) => phase.owner,
    when: (_ctx, phase) => phase.kind === 'finish',
    ask: '是否发动【闭月】摸一张牌？',
    effect: (ctx, _phase, self) => draw(ctx, { player: self.owner, count: 1, reason: self.skill }),
  }),
);
