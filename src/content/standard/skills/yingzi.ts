import { skill, on, Cards } from '../../../sdk';

export default skill(
  'standard:yingzi',
  '英姿',
  '摸牌阶段，你可以多摸一张牌。',
  on(Cards.drawing, {
    who: (draft) => draft.input.player,
    when: (_ctx, draft) => draft.phase?.kind === 'draw',
    ask: '是否发动【英姿】多摸一张牌？',
    effect: (_ctx, draft, self) => draft.setCount(draft.count + 1, self.skill),
  }),
);
