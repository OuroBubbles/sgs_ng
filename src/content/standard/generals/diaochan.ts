import type { ActiveInput, Context, JointChoice, UseIntent } from '../../../sdk';
import {
  action,
  alive,
  canDiscard,
  draw,
  general,
  HE,
  isGameOver,
  isMale,
  ownedCards,
  selection,
  skill,
  on,
  Phase,
  useCard,
  validateUse,
} from '../../../sdk';

const duel = (from: string, to: string): UseIntent => ({
  actor: from,
  targets: [to],
  timing: { kind: 'effect' },
  choice: {
    kind: 'generated',
    face: { name: 'standard:duel' },
    materials: [],
    reason: 'standard:lijian',
  },
  prohibitedCounters: ['standard:nullification'],
});

/** 后选角色须能向先选角色使用决斗；按两人的组合做可完成性判断。 */
function pairs(ctx: Context, { self, phase }: ActiveInput) {
  const cards = () =>
    ownedCards(ctx.world, self.owner, HE).filter((card) =>
      canDiscard(ctx, { actor: self.owner, card, reason: self.skill }),
    );
  const targets = () =>
    alive(ctx, self.owner) && !phase.turn?.ended && !isGameOver(ctx.world)
      ? ctx.world.snapshot.players
          .filter((p) => p.alive && p.id !== self.owner && isMale(ctx, p.id))
          .map((p) => p.id)
      : [];
  const valid = (first: string, second: string) =>
    first !== second && validateUse(ctx, duel(second, first)).ok;
  const canComplete = ({ targets: [first, second] }: JointChoice) =>
    cards().length > 0 &&
    (first === undefined ? targets() : [first]).some((a) =>
      (second === undefined ? targets() : [second]).some((b) => valid(a, b)),
    );
  return selection(ctx, {
    cards,
    targets,
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 2, max: 2 },
    constraints: {
      canComplete,
      complete: ({ targets: [a, b] }) =>
        valid(a!, b!) ? null : '后选角色不能向先选角色使用决斗。',
    },
  });
}

export const lijian = skill(
  'standard:lijian',
  '离间',
  '出牌阶段限一次，弃置一张手牌或装备，选择两名其他男性角色。后选角色视为对先选角色使用一张不能被无懈可击的决斗。',
  action({
    id: 'forced-duel',
    limit: 1,
    selection: pairs,
    cards: { count: 1, areas: HE },
    pay: 'discard',
    effect: (ctx, { targets: [first, second] }) => useCard(ctx, duel(second!, first!)),
  }),
  {
    ai: {
      value: ({ cards, players, self, cost }) =>
        cards.some((card) => cost(card.id) <= 5) &&
        players.filter((p) => p.alive && p.id !== self.id && ['male', 'dual'].includes(p.gender))
          .length >= 2
          ? 16
          : -1,
    },
  },
);

export const biyue = skill(
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

export default general('standard:diaochan', '貂蝉', '群', 3, [lijian, biyue], { gender: 'female' });
