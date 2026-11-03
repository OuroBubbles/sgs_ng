import {
  on,
  modify,
  cardQueries,
  targetSpecified,
  phaseStarted,
  drawing,
  invoke,
  judge,
  draw,
  pay,
  payDiscard,
  used,
  JointSelection,
  chooseOne,
  chooseOwnedCard,
  ownedCards,
  genderOf,
  damage,
  moveCards,
  isGameOver,
} from '../../sdk';
import type {
  CardBook,
  Context,
  PhaseView,
  SkillHandle,
  UseIntent,
  JointChoice,
  ActiveInput,
} from '../../sdk';
import type { SkillDefinition } from '../../sdk';

export const mashu = {
  id: 'standard:mashu',
  name: '马术',
  description: '锁定技，你计算与其他角色的距离时减一。',
  modifiers: [
    modify(cardQueries.distanceCorrection, (_ctx, { input, self }) =>
      input.from === self.owner && input.to !== self.owner ? -1 : undefined,
    ),
  ],
} satisfies SkillDefinition;

export function tieqi(book: CardBook) {
  return {
    id: 'standard:tieqi',
    name: '铁骑',
    description:
      '当你指定杀的目标后，可以判定。若结果为红色，该角色不能以闪响应这次杀，八卦阵和护驾供闪也不能绕过。',
    triggers: [
      on(targetSpecified, {
        order: 'choose',
        when: (_ctx, { payload: { effect }, self }) =>
          effect.actor === self.owner &&
          effect.card.name === 'standard:slash' &&
          effect.state === 'targeting',
        async run(ctx, { payload: { effect }, self }) {
          const accepted = await invoke(
            ctx,
            self,
            '是否发动【铁骑】进行判定？',
            (at) => effect.state === 'targeting' && at.world.player(effect.target).alive,
          );

          if (!accepted) return;
          const judgment = await judge(ctx, book, {
            player: self.owner,
            reason: self.skill,
            match: (_at, card) => card.color === 'red',
          });

          if (
            judgment.matched &&
            effect.state === 'targeting' &&
            ctx.world.player(effect.target).alive &&
            !isGameOver(ctx.world)
          )
            effect.blockResponses(ctx, effect.target, self.skill, ['standard:jink']);
        },
      }),
    ],
  } satisfies SkillDefinition;
}

export const yingzi = {
  id: 'standard:yingzi',
  name: '英姿',
  description: '摸牌阶段，你可以多摸一张牌。',
  triggers: [
    on(drawing, {
      order: 'choose',
      when: (_ctx, { payload: draft, self }) =>
        draft.input.player === self.owner && draft.phase?.kind === 'draw',
      async run(ctx, { payload: draft, self }) {
        const accepted = await invoke(ctx, self, '是否发动【英姿】多摸一张牌？');

        if (accepted) draft.setCount(draft.count + 1, self.skill);
      },
    }),
  ],
} satisfies SkillDefinition;

export const biyue = {
  id: 'standard:biyue',
  name: '闭月',
  description: '结束阶段，你可以摸一张牌。',
  triggers: [
    on(phaseStarted, {
      order: 'choose',
      when: (_ctx, { payload: phase, self }) =>
        phase.owner === self.owner && phase.kind === 'finish',
      async run(ctx, { self }) {
        const accepted = await invoke(ctx, self, '是否发动【闭月】摸一张牌？');

        if (accepted) await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
      },
    }),
  ],
} satisfies SkillDefinition;

const limit = (self: SkillHandle, phase: PhaseView) => ({
  key: self.skill,
  source: self.skill,
  lifetime: phase.lifetime,
  max: 1,
});
const live = (ctx: Context, self: SkillHandle, phase: PhaseView) =>
  ctx.world.player(self.owner).alive && !phase.turn?.ended && !isGameOver(ctx.world);
const suitOptions = [
  { id: 'spade', label: '♠ 黑桃' },
  { id: 'heart', label: '♥ 红桃' },
  { id: 'club', label: '♣ 梅花' },
  { id: 'diamond', label: '♦ 方块' },
] as const;
function fanjianSelection(ctx: Context, { self, phase }: ActiveInput) {
  return new JointSelection({
    targetCount: { min: 1, max: 1 },
    targets: () =>
      live(ctx, self, phase) && ownedCards(ctx.world, self.owner).length
        ? ctx.world.snapshot.players
            .filter((p) => p.alive && p.id !== self.owner)
            .map((p) => ({ id: p.id, label: p.id }))
        : [],
  });
}
export const fanjian = {
  id: 'standard:fanjian',
  name: '反间',
  description:
    '出牌阶段限一次，令一名其他角色猜一种花色，再正面朝上获得你的一张手牌。若花色不同，你对其造成一点伤害。手牌由目标暗选。',
  active: [
    {
      id: 'guess-suit',
      available: (ctx, { self, phase }) => used(ctx.world, self.owner, limit(self, phase)) === 0,
      selection: fanjianSelection,
      async run(ctx, { self, phase, book, choice, selection: model }) {
        const target = choice.targets[0]!;
        const paid = await pay(ctx, {
          skill: self,
          reason: self.skill,
          limit: limit(self, phase),
          legal: () => model.validate(choice).ok,
          factKind: 'skill.invoked',
          declaration: { label: self.name, targets: [target] },
        });

        if (paid.kind !== 'paid') return;
        const available = () =>
          ctx.world.player(target).alive &&
          ctx.world.player(self.owner).alive &&
          ownedCards(ctx.world, self.owner).length > 0 &&
          !isGameOver(ctx.world);
        const guess = await ctx.ask(
          chooseOne({
            player: target,
            prompt: `反间：先猜一种花色，再暗选 ${self.owner} 的一张手牌`,
            options: suitOptions,
            reason: self.skill,
            available,
          }),
        );
        if (guess.kind !== 'chosen') return;
        ctx.commit('fanjian.guessed', [], { actor: target, owner: self.owner, suit: guess.value });
        const selected = await chooseOwnedCard(ctx, book, {
          actor: target,
          target: self.owner,
          areas: ['hand'],
          reason: self.skill,
          prompt: '反间：暗选对方的一张手牌，正面朝上获得',
        });

        if (selected.kind !== 'chosen' || !available()) return;
        const card = ctx.world.card(selected.card);
        const destination = ctx.world.snapshot.zones.find(
          (zone) => zone.owner === target && zone.kind === 'hand',
        )!;
        await moveCards(
          ctx,
          [{ cards: [card.id], from: selected.from, to: destination.id, place: 'bottom' }],
          self.skill,
          {
            kind: 'cards.given',
            data: {
              actor: self.owner,
              target,
              count: 1,
              cards: [card.id],
              visible: true,
              reason: self.skill,
            },
          },
        );

        // 牌已交出；获得/失去牌后效不会撤销猜错的结果，也不要求来源仍持有技能或存活。
        if (
          book.face(ctx, card.id).suit !== guess.value &&
          ctx.world.player(target).alive &&
          !isGameOver(ctx.world)
        )
          await damage(ctx, { from: self.owner, to: target, amount: 1, nature: 'normal' });
      },
    },
  ],
} satisfies SkillDefinition;
function duelIntent(from: string, to: string): UseIntent {
  return {
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
  };
}
function lijianSelection(ctx: Context, { self, phase, book }: ActiveInput) {
  const cards = () =>
    ownedCards(ctx.world, self.owner, ['hand', 'equipment']).filter((card) =>
      book.canDiscard(ctx, { actor: self.owner, owner: self.owner, card, reason: self.skill }),
    );
  const targets = () =>
    live(ctx, self, phase)
      ? ctx.world.snapshot.players
          .filter(
            (p) =>
              p.alive &&
              p.id !== self.owner &&
              ['male', 'dual'].includes(genderOf(ctx.world, p.id)),
          )
          .map((p) => p.id)
      : [];
  const validPair = (first: string, second: string) =>
    first !== second && book.validateUse(ctx, duelIntent(second, first)).ok;
  const canComplete = (choice: JointChoice) => {
    const candidates = targets();
    const first = choice.targets[0];
    const second = choice.targets[1];
    return (
      cards().length > 0 &&
      (first === undefined ? candidates : [first]).some((a) =>
        (second === undefined ? candidates : [second]).some((b) => validPair(a, b)),
      )
    );
  };
  return new JointSelection({
    cards: () => cards().map((id) => ({ id, label: ctx.world.card(id).name })),
    targets,
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 2, max: 2 },
    constraints: {
      canComplete,
      complete: (choice) =>
        validPair(choice.targets[0]!, choice.targets[1]!)
          ? null
          : '后选角色不能向先选角色使用决斗。',
    },
  });
}
export const lijian = {
  id: 'standard:lijian',
  name: '离间',
  description:
    '出牌阶段限一次，弃置一张手牌或装备，选择两名其他男性角色。后选角色视为对先选角色使用一张不能被无懈可击的决斗。',
  active: [
    {
      id: 'forced-duel',
      available: (ctx, { self, phase }) => used(ctx.world, self.owner, limit(self, phase)) === 0,
      selection: lijianSelection,
      async run(ctx, { self, phase, book, choice, selection: model }) {
        const paid = await payDiscard(ctx, book, {
          skill: self,
          cards: choice.cards,
          areas: ['hand', 'equipment'],
          reason: self.skill,
          limit: limit(self, phase),
          legal: () => !phase.turn?.ended && model.validate(choice).ok,
          factKind: 'skill.invoked',
          declaration: { label: self.name, targets: choice.targets },
        });

        if (paid.kind !== 'paid' || isGameOver(ctx.world)) return;
        await book.use(ctx, duelIntent(choice.targets[1]!, choice.targets[0]!));
      },
    },
  ],
} satisfies SkillDefinition;
