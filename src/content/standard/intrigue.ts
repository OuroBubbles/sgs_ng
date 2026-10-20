import {
  defineSkill,
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
import type { CardBook, Context, PhaseView, SkillHandle, UseIntent, JointChoice } from '../../sdk';

export const mashu = defineSkill({
  id: 'standard:mashu',
  name: '马术',
  description: '锁定技，你计算与其他角色的距离时减一。',
  effects: [],
  modifiers: [
    modify(cardQueries.distanceCorrection, (_ctx, input, self) =>
      input.from === self.owner && input.to !== self.owner ? -1 : undefined,
    ),
  ],
});

export function tieqi(book: CardBook) {
  return defineSkill({
    id: 'standard:tieqi',
    name: '铁骑',
    description:
      '当你指定杀的目标后，可以判定。若结果为红色，该角色不能以闪响应这次杀，八卦阵和护驾供闪也不能绕过。',
    effects: [
      on(targetSpecified, {
        id: 'red-judgment',
        order: 'choose',
        when: (_ctx, { effect }, self) =>
          effect.actor === self.owner &&
          effect.card.name === 'standard:slash' &&
          effect.state === 'targeting',
        async run(ctx, { effect }, self) {
          const accepted = await invoke(
            ctx,
            self,
            '是否发动【铁骑】进行判定？',
            (at) => effect.state === 'targeting' && at.world.player(effect.target).alive,
          );
          if (accepted.kind === 'aborted') return ctx.abort(accepted.reason);
          if (!accepted.value) return;
          const judgment = await judge(ctx, book, {
            player: self.owner,
            reason: self.skill,
            match: (_at, card) => card.color === 'red',
          });
          if (judgment.kind === 'aborted') return ctx.abort(judgment.reason);
          if (
            judgment.value.matched &&
            effect.state === 'targeting' &&
            ctx.world.player(effect.target).alive &&
            !isGameOver(ctx.world)
          )
            effect.blockResponses(ctx, effect.target, self.skill, ['standard:jink']);
        },
      }),
    ],
  });
}

export const yingzi = defineSkill({
  id: 'standard:yingzi',
  name: '英姿',
  description: '摸牌阶段，你可以多摸一张牌。',
  effects: [
    on(drawing, {
      id: 'extra-phase-draw',
      order: 'choose',
      when: (_ctx, draft, self) =>
        draft.input.player === self.owner && draft.phase?.kind === 'draw',
      async run(ctx, draft, self) {
        const accepted = await invoke(ctx, self, '是否发动【英姿】多摸一张牌？');
        if (accepted.kind === 'aborted') return ctx.abort(accepted.reason);
        if (accepted.value) draft.setCount(draft.count + 1, self.skill);
      },
    }),
  ],
});

export const biyue = defineSkill({
  id: 'standard:biyue',
  name: '闭月',
  description: '结束阶段，你可以摸一张牌。',
  effects: [
    on(phaseStarted, {
      id: 'finish-draw',
      order: 'choose',
      when: (_ctx, phase, self) => phase.owner === self.owner && phase.kind === 'finish',
      async run(ctx, _phase, self) {
        const accepted = await invoke(ctx, self, '是否发动【闭月】摸一张牌？');
        if (accepted.kind === 'aborted') return ctx.abort(accepted.reason);
        if (accepted.value && ctx.world.player(self.owner).alive && !isGameOver(ctx.world))
          await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
      },
    }),
  ],
});

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
function fanjianSelection(ctx: Context, self: SkillHandle, phase: PhaseView) {
  return new JointSelection({
    cards: () => [],
    cardCount: { min: 0, max: 0 },
    targetCount: { min: 1, max: 1 },
    targets: () =>
      live(ctx, self, phase) && ownedCards(ctx.world, self.owner).length
        ? ctx.world.snapshot.players
            .filter((p) => p.alive && p.id !== self.owner)
            .map((p) => ({ id: p.id, label: p.id }))
        : [],
  });
}
export const fanjian = defineSkill({
  id: 'standard:fanjian',
  name: '反间',
  description:
    '出牌阶段限一次，令一名其他角色猜一种花色，再正面朝上获得你的一张手牌。若花色不同，你对其造成一点伤害。手牌由目标暗选。',
  effects: [],
  active: [
    {
      id: 'guess-suit',
      label: '反间',
      available: (ctx, self, phase) =>
        used(ctx.world, self.owner, limit(self, phase)) === 0 &&
        fanjianSelection(ctx, self, phase).inspect({ cards: [], targets: [] }).valid,
      async run(ctx, self, phase, book) {
        const model = fanjianSelection(ctx, self, phase);
        const choice = await ctx.ask(
          model.decision(self.owner, '反间：选择一名其他角色猜花色并获得你的手牌', true, {
            reason: self.skill,
            cancelLabel: '取消发动',
          }),
        );
        if (choice.kind !== 'chosen') return;
        const target = choice.value.targets[0]!;
        const paid = await pay(ctx, {
          actor: self.owner,
          skill: self,
          cards: [],
          to: 'discard',
          reason: self.skill,
          limit: limit(self, phase),
          legal: () => model.validate(choice.value).ok,
          factKind: 'skill.invoked',
          declaration: { label: self.name, targets: [target] },
        });
        if (paid.kind === 'aborted') return ctx.abort(paid.reason);
        if (paid.value.kind !== 'paid') return;
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
        if (selected.kind === 'aborted') return ctx.abort(selected.reason);
        if (selected.value.kind !== 'chosen' || !available()) return;
        const card = ctx.world.card(selected.value.card);
        const destination = ctx.world.snapshot.zones.find(
          (zone) => zone.owner === target && zone.kind === 'hand',
        )!;
        const given = await moveCards(
          ctx,
          [{ cards: [card.id], from: selected.value.from, to: destination.id, place: 'bottom' }],
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
        if (given.kind === 'aborted') return ctx.abort(given.reason);
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
});
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
function lijianSelection(ctx: Context, self: SkillHandle, phase: PhaseView, book: CardBook) {
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
    targets: () => targets().map((id) => ({ id, label: id })),
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 2, max: 2 },
    constraints: {
      partial: () => null,
      canComplete,
      complete: (choice) =>
        validPair(choice.targets[0]!, choice.targets[1]!)
          ? null
          : '后选角色不能向先选角色使用决斗。',
    },
  });
}
export const lijian = defineSkill({
  id: 'standard:lijian',
  name: '离间',
  description:
    '出牌阶段限一次，弃置一张手牌或装备，选择两名其他男性角色。后选角色视为对先选角色使用一张不能被无懈可击的决斗。',
  effects: [],
  active: [
    {
      id: 'forced-duel',
      label: '离间',
      available: (ctx, self, phase, book) =>
        used(ctx.world, self.owner, limit(self, phase)) === 0 &&
        lijianSelection(ctx, self, phase, book).inspect({ cards: [], targets: [] }).valid,
      async run(ctx, self, phase, book) {
        const model = lijianSelection(ctx, self, phase, book);
        const choice = await ctx.ask(
          model.decision(self.owner, '离间：弃一张牌；先选先出杀者，再选决斗发起者', true, {
            reason: self.skill,
            cancelLabel: '取消发动',
          }),
        );
        if (choice.kind !== 'chosen') return;
        const paid = await payDiscard(ctx, book, {
          actor: self.owner,
          skill: self,
          cards: choice.value.cards,
          areas: ['hand', 'equipment'],
          reason: self.skill,
          limit: limit(self, phase),
          legal: () => !phase.turn?.ended && model.validate(choice.value).ok,
          factKind: 'skill.invoked',
          declaration: { label: self.name, targets: choice.value.targets },
        });
        if (paid.kind === 'aborted') return ctx.abort(paid.reason);
        if (paid.value.kind !== 'paid' || isGameOver(ctx.world)) return;
        const result = await book.use(
          ctx,
          duelIntent(choice.value.targets[1]!, choice.value.targets[0]!),
        );
        if (result.kind === 'aborted') return ctx.abort(result.reason);
      },
    },
  ],
});
