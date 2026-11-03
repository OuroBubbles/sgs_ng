import {
  JointSelection,
  ownedCards,
  payDiscard,
  pay,
  used,
  draw,
  on,
  recovering,
  phaseBefore,
  cardActivities,
  kingdomOf,
  modify,
  cardQueries,
  cardsMoved,
  invoke,
  askInvoke,
  isGameOver,
} from '../../sdk';
import type { Context, SkillHandle, PhaseView, MoveResult } from '../../sdk';
import type { ActiveInput, SkillDefinition } from '../../sdk';

const zhihengLimit = (self: SkillHandle, phase: PhaseView) => ({
  key: 'zhiheng',
  source: self.skill,
  lifetime: phase.lifetime,
  max: 1,
});
function zhihengSelection(ctx: Context, { self, phase, book }: ActiveInput) {
  return new JointSelection({
    cards: () =>
      !phase.turn?.ended
        ? ownedCards(ctx.world, self.owner, ['hand', 'equipment'])
            .filter((card) =>
              book.canDiscard(ctx, {
                actor: self.owner,
                owner: self.owner,
                card,
                reason: self.skill,
              }),
            )
            .map((id) => ({ id, label: ctx.world.card(id).name }))
        : [],
    cardCount: { min: 1, max: 'all' },
  });
}
export const zhiheng = {
  id: 'standard:zhiheng',
  name: '制衡',
  description:
    '出牌阶段限一次，你可以弃置至少一张手牌或装备牌，然后摸等量的牌。标准版制衡不额外奖励弃光手牌。',
  active: [
    {
      id: 'exchange',
      available: (ctx, { self, phase }) =>
        used(ctx.world, self.owner, zhihengLimit(self, phase)) === 0,
      selection: zhihengSelection,
      async run(ctx, { self, phase, book, choice, selection: model }) {
        const paid = await payDiscard(ctx, book, {
          skill: self,
          cards: choice.cards,
          areas: ['hand', 'equipment'],
          reason: self.skill,
          limit: zhihengLimit(self, phase),
          legal: () => model.validate(choice).ok,
          factKind: 'skill.invoked',
          declaration: { label: self.name, count: choice.cards.length },
        });

        if (paid.kind === 'paid')
          await draw(ctx, {
            player: self.owner,
            count: paid.receipt.cards.length,
            reason: self.skill,
          });
      },
    },
  ],
} satisfies SkillDefinition;
export const jiuyuan = {
  id: 'standard:jiuyuan',
  name: '救援',
  lord: true,
  description:
    '主公技，锁定技。其他吴势力角色对你使用桃时，额外回复 1 点体力；按当前势力判断，仍受体力上限限制。',
  triggers: [
    on(recovering, {
      when: (ctx, { payload: recovery, self }) =>
        recovery.input.to === self.owner &&
        recovery.input.from !== null &&
        recovery.input.from !== self.owner &&
        kingdomOf(ctx.world, recovery.input.from) === '吴' &&
        recovery.input.card?.card.name === 'standard:peach',
      run(_ctx, { payload: recovery, self }) {
        recovery.adjust(1, self.skill);
      },
    }),
  ],
} satisfies SkillDefinition;
function usedSlashInPlay(ctx: Context, self: SkillHandle, phase: PhaseView): boolean {
  const turn = phase.turn;
  if (!turn) return false;
  return cardActivities(ctx.history.facts(), turn.id).some(
    (a) =>
      a.actor === self.owner &&
      a.card.name === 'standard:slash' &&
      a.turnId === turn.id &&
      a.phase?.owner === self.owner &&
      a.phase.kind === 'play',
  );
}
export const keji = {
  id: 'standard:keji',
  name: '克己',
  description:
    '弃牌阶段开始前，若你在本回合的出牌阶段没有使用或打出过杀，你可以跳过此弃牌阶段。包括转换、供牌和改判中的真实打出；按阶段与实际角色查询。',
  triggers: [
    on(phaseBefore, {
      order: 'choose',
      when: (ctx, { payload: phase, self }) =>
        phase.owner === self.owner &&
        phase.kind === 'discard' &&
        !phase.turn?.ended &&
        !phase.skipped &&
        !usedSlashInPlay(ctx, self, phase),
      async run(ctx, { payload: phase, self }) {
        const live = () =>
          !phase.skipped &&
          !phase.turn?.ended &&
          !usedSlashInPlay(ctx, self, phase) &&
          ctx.world.player(self.owner).alive &&
          !isGameOver(ctx.world) &&
          self.effective(ctx.world);
        if (!(await askInvoke(ctx, self, '是否发动【克己】跳过弃牌阶段？', live))) return;
        await pay(ctx, {
          skill: self,
          reason: self.skill,
          legal: live,
          changes: [phase.skipChange(ctx, self.skill)],
          factKind: 'skill.invoked',
          declaration: { label: self.name },
        });
      },
    }),
  ],
} satisfies SkillDefinition;
export const qianxun = {
  id: 'standard:qianxun',
  name: '谦逊',
  description: '锁定技，你不能成为顺手牵羊或乐不思蜀的目标。',
  modifiers: [
    modify(cardQueries.prohibitTarget, (_ctx, { input: request, self }) =>
      request.target === self.owner &&
      ['standard:snatch', 'standard:indulgence'].includes(request.card.name)
        ? true
        : undefined,
    ),
  ],
} satisfies SkillDefinition;
function emptiedHand(moved: MoveResult, owner: string): boolean {
  const before = moved.before.filter((z) => z.kind === 'hand' && z.owner === owner);
  return (
    before.some(
      (z) => z.cards.length > 0 && moved.moves.some((m) => m.from === z.id && m.cards.length > 0),
    ) &&
    moved.after
      .filter((z) => z.kind === 'hand' && z.owner === owner)
      .every((z) => z.cards.length === 0)
  );
}
export const lianying = {
  id: 'standard:lianying',
  name: '连营',
  description:
    '失去最后的手牌后，你可以摸一张牌。一批移出多张手牌只产生一次机会；重新获得手牌再失去时是新的机会。',
  triggers: [
    on(cardsMoved, {
      order: 'choose',
      when: (ctx, { payload: moved, self }) =>
        emptiedHand(moved, self.owner) && ownedCards(ctx.world, self.owner).length === 0,
      async run(ctx, { self }) {
        const invoked = await invoke(
          ctx,
          self,
          '是否发动【连营】摸一张牌？',
          (at) => ownedCards(at.world, self.owner).length === 0,
        );

        if (invoked) await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
      },
    }),
  ],
} satisfies SkillDefinition;
