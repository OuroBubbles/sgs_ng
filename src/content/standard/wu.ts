import {
  defineSkill,
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
  isGameOver,
} from '../../sdk';
import type { Context, SkillHandle, PhaseView, MoveResult } from '../../sdk';

const zhihengLimit = (self: SkillHandle, phase: PhaseView) => ({
  key: 'zhiheng',
  source: self.skill,
  lifetime: phase.lifetime,
  max: 1,
});
export const zhiheng = defineSkill({
  id: 'standard:zhiheng',
  name: '制衡',
  description:
    '出牌阶段限一次，你可以弃置至少一张手牌或装备牌，然后摸等量的牌。标准版制衡不额外奖励弃光手牌。',
  effects: [],
  active: [
    {
      id: 'exchange',
      label: '制衡',
      available: (ctx, self, phase, book) =>
        used(ctx.world, self.owner, zhihengLimit(self, phase)) === 0 &&
        ownedCards(ctx.world, self.owner, ['hand', 'equipment']).some((card) =>
          book.canDiscard(ctx, { actor: self.owner, owner: self.owner, card, reason: self.skill }),
        ),
      async run(ctx, self, phase, book) {
        const model = new JointSelection({
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
          targets: () => [],
          cardCount: { min: 1, max: 'all' },
          targetCount: { min: 0, max: 0 },
        });
        const answer = await ctx.ask(
          model.decision(self.owner, '制衡：弃置任意张手牌或装备，摸等量牌', true, {
            cancelLabel: '取消发动',
            reason: self.skill,
          }),
        );
        if (answer.kind !== 'chosen') return;
        const paid = await payDiscard(ctx, book, {
          actor: self.owner,
          skill: self,
          cards: answer.value.cards,
          areas: ['hand', 'equipment'],
          reason: self.skill,
          limit: zhihengLimit(self, phase),
          legal: () => model.validate(answer.value).ok,
          factKind: 'skill.invoked',
          declaration: { label: self.name, count: answer.value.cards.length },
        });
        if (paid.kind === 'aborted') return ctx.abort(paid.reason);
        if (
          paid.value.kind === 'paid' &&
          ctx.world.player(self.owner).alive &&
          !isGameOver(ctx.world)
        )
          await draw(ctx, {
            player: self.owner,
            count: paid.value.receipt.cards.length,
            reason: self.skill,
          });
      },
    },
  ],
});
export const jiuyuan = defineSkill({
  id: 'standard:jiuyuan',
  name: '救援',
  lord: true,
  description:
    '主公技，锁定技。其他吴势力角色对你使用桃时，额外回复 1 点体力；按当前势力判断，仍受体力上限限制。',
  effects: [
    on(recovering, {
      id: 'extra-peach',
      when: (ctx, recovery, self) =>
        recovery.input.to === self.owner &&
        recovery.input.from !== null &&
        recovery.input.from !== self.owner &&
        kingdomOf(ctx.world, recovery.input.from) === '吴' &&
        recovery.input.card?.card.name === 'standard:peach',
      run(_ctx, recovery, self) {
        recovery.adjust(1, self.skill);
      },
    }),
  ],
});
function usedSlashInPlay(ctx: Context, self: SkillHandle, phase: PhaseView): boolean {
  const turn = phase.turn;
  if (!turn) return false;
  return cardActivities(ctx.history, turn.id).some(
    (a) =>
      a.actor === self.owner &&
      a.card.name === 'standard:slash' &&
      a.turnId === turn.id &&
      a.phase?.owner === self.owner &&
      a.phase.kind === 'play',
  );
}
export const keji = defineSkill({
  id: 'standard:keji',
  name: '克己',
  description:
    '弃牌阶段开始前，若你在本回合的出牌阶段没有使用或打出过杀，你可以跳过此弃牌阶段。包括转换、供牌和改判中的真实打出；按阶段与实际角色查询。',
  effects: [
    on(phaseBefore, {
      id: 'skip-discard',
      order: 'choose',
      when: (ctx, phase, self) =>
        phase.owner === self.owner &&
        phase.kind === 'discard' &&
        !phase.turn?.ended &&
        !phase.skipped &&
        !usedSlashInPlay(ctx, self, phase),
      async run(ctx, phase, self) {
        const live = () =>
          !phase.skipped &&
          !phase.turn?.ended &&
          !usedSlashInPlay(ctx, self, phase) &&
          ctx.world.player(self.owner).alive &&
          !isGameOver(ctx.world) &&
          self.effective(ctx.world);
        const answer = await ctx.ask<boolean>({
          player: self.owner,
          kind: 'invoke',
          prompt: '是否发动【克己】跳过弃牌阶段？',
          data: { skill: self.skill, instance: self.id },
          optional: false,
          available: live,
          validate: (value) =>
            typeof value === 'boolean'
              ? { ok: true, value }
              : { ok: false, reason: 'Choose whether to invoke.' },
        });
        if (answer.kind !== 'chosen' || !answer.value) return;
        const paid = await pay(ctx, {
          actor: self.owner,
          skill: self,
          cards: [],
          to: 'discard',
          reason: self.skill,
          legal: live,
          changes: [phase.skipChange(ctx, self.skill)],
          factKind: 'skill.invoked',
          declaration: { label: self.name },
        });
        if (paid.kind === 'aborted') return ctx.abort(paid.reason);
      },
    }),
  ],
});
export const qianxun = defineSkill({
  id: 'standard:qianxun',
  name: '谦逊',
  description: '锁定技，你不能成为顺手牵羊或乐不思蜀的目标。',
  effects: [],
  modifiers: [
    modify(cardQueries.prohibitTarget, (_ctx, request, self) =>
      request.target === self.owner &&
      ['standard:snatch', 'standard:indulgence'].includes(request.card.name)
        ? true
        : undefined,
    ),
  ],
});
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
export const lianying = defineSkill({
  id: 'standard:lianying',
  name: '连营',
  description:
    '失去最后的手牌后，你可以摸一张牌。一批移出多张手牌只产生一次机会；重新获得手牌再失去时是新的机会。',
  effects: [
    on(cardsMoved, {
      id: 'last-hand',
      order: 'choose',
      when: (ctx, moved, self) =>
        emptiedHand(moved, self.owner) && ownedCards(ctx.world, self.owner).length === 0,
      async run(ctx, _moved, self) {
        const invoked = await invoke(
          ctx,
          self,
          '是否发动【连营】摸一张牌？',
          (at) => ownedCards(at.world, self.owner).length === 0,
        );
        if (invoked.kind === 'aborted') return ctx.abort(invoked.reason);
        if (invoked.value && ctx.world.player(self.owner).alive && !isGameOver(ctx.world))
          await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
      },
    }),
  ],
});
