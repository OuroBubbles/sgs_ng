import {
  on,
  ownedCards,
  JointSelection,
  judgmentRetrial,
  judgmentFinished,
  damageReceived,
  invoke,
  chooseOwnedCard,
  pay,
  moveCards,
  withPrivateTopCards,
  isGameOver,
} from '../../sdk';
import type { CardBook, Context, Judgment, SkillHandle } from '../../sdk';
import type { SkillDefinition } from '../../sdk';

function retrialCards(
  ctx: Context,
  book: CardBook,
  self: SkillHandle,
  judgment: Judgment,
): readonly string[] {
  if (
    !ctx.world.player(self.owner).alive ||
    !self.effective(ctx.world) ||
    !ctx.world.player(judgment.player).alive ||
    isGameOver(ctx.world)
  )
    return [];
  return ownedCards(ctx.world, self.owner).filter(
    (id) => !book.isResponseProhibited(ctx, self.owner, book.physicalCard(ctx, id)),
  );
}

export function guicai(book: CardBook) {
  return {
    id: 'standard:guicai',
    name: '鬼才',
    description:
      '一名角色的判定牌生效前，你可以打出一张手牌代替之。任意牌型均可，但须满足打出禁令。',
    triggers: [
      on(judgmentRetrial, {
        order: 'choose',
        when: (ctx, { payload: judgment, self }) =>
          judgment.card !== null && retrialCards(ctx, book, self, judgment).length > 0,
        async run(ctx, { payload: judgment, self }) {
          const model = new JointSelection({
            cards: () =>
              retrialCards(ctx, book, self, judgment).map((id) => ({
                id,
                label: book.definition(ctx.world.card(id).name).label,
              })),
            cardCount: { min: 1, max: 1 },
          });
          const decision = model.decision(
            self.owner,
            `鬼才：选择一张手牌，替换 ${judgment.player} 的判定牌`,
            { optional: true, cancelLabel: '不改判', reason: self.skill },
          );
          const answer = await ctx.ask({
            ...decision,
            describe: () => ({
              ...(decision.describe!() as Record<string, unknown>),
              judgment: {
                player: judgment.player,
                reason: judgment.reason,
                card: judgment.card,
                // 改判供牌者的手牌面不等于接收者的判定面；只描述本人合法候选。
                alternatives: retrialCards(ctx, book, self, judgment).map((id) =>
                  book.face(ctx, id, judgment.player),
                ),
              },
            }),
          });
          if (answer.kind !== 'chosen') return;
          const id = answer.value.cards[0]!;
          await judgment.replace(ctx, {
            card: id,
            from: ctx.world.position(id),
            reason: self.skill,
            skill: self,
            legal: () => model.validate(answer.value).ok,
            response: book.physicalCard(ctx, id),
          });
        },
      }),
    ],
  } satisfies SkillDefinition;
}

export function fankui(book: CardBook) {
  return {
    id: 'standard:fankui',
    name: '反馈',
    description:
      '受到一次伤害后，你可以获得伤害来源的一张手牌或装备。若伤害来源是你，只能选择装备。',
    triggers: [
      on(damageReceived, {
        order: 'choose',
        when: (ctx, { payload: hit, self }) =>
          hit.input.to === self.owner &&
          hit.input.from !== null &&
          ctx.world.player(hit.input.from).alive &&
          ownedCards(
            ctx.world,
            hit.input.from,
            hit.input.from === self.owner ? ['equipment'] : ['hand', 'equipment'],
          ).length > 0,
        async run(ctx, { payload: hit, self }) {
          const source = hit.input.from!;
          const areas = source === self.owner ? ['equipment'] : ['hand', 'equipment'];
          const live = () =>
            !isGameOver(ctx.world) &&
            ctx.world.player(source).alive &&
            ownedCards(ctx.world, source, areas).length > 0;
          const chosen = await chooseOwnedCard(ctx, book, {
            actor: self.owner,
            target: source,
            areas,
            reason: self.skill,
            prompt: '反馈：选择伤害来源的一张牌，确认后发动',
            optional: true,
          });

          if (chosen.kind !== 'chosen') return;
          const { card, from } = chosen;
          const paid = await pay(ctx, {
            skill: self,
            reason: self.skill,
            factKind: 'skill.invoked',
            declaration: { label: self.name },
            legal: () => live() && ctx.world.position(card) === from,
          });
          // 宣告后失去技能仍结算；支付后效若已移走选牌，不追取它或另开选择。
          if (
            paid.kind !== 'paid' ||
            !ctx.world.player(self.owner).alive ||
            !live() ||
            ctx.world.position(card) !== from
          )
            return;
          const open = ctx.world.zone(from).kind === 'equipment';
          const hand = ctx.world.snapshot.zones.find(
            (zone) => zone.owner === self.owner && zone.kind === 'hand',
          )!;
          await moveCards(ctx, [{ cards: [card], from, to: hand.id, place: 'bottom' }], self.skill);

          ctx.commit('card.taken', [], {
            actor: self.owner,
            target: source,
            card,
            open,
            reason: self.skill,
          });
        },
      }),
    ],
  } satisfies SkillDefinition;
}

export const tiandu = {
  id: 'standard:tiandu',
  name: '天妒',
  description: '你的判定结束后，你可以获得仍在处理区中的判定牌。',
  triggers: [
    on(judgmentFinished, {
      order: 'choose',
      when: (ctx, { payload: judgment, self }) =>
        judgment.player === self.owner &&
        judgment.card !== null &&
        ctx.world.position(judgment.card.id) === judgment.processing,
      async run(ctx, { payload: judgment, self }) {
        const card = judgment.card!;
        const live = () =>
          ctx.world.position(card.id) === judgment.processing && !isGameOver(ctx.world);
        const invoked = await invoke(ctx, self, '是否发动【天妒】获得此判定牌？', live);

        if (!invoked || !ctx.world.player(self.owner).alive || !live()) return;
        const hand = ctx.world.snapshot.zones.find(
          (zone) => zone.owner === self.owner && zone.kind === 'hand',
        )!;
        await moveCards(
          ctx,
          [{ cards: [card.id], from: judgment.processing, to: hand.id, place: 'bottom' }],
          self.skill,
          {
            kind: 'judgment.card-obtained',
            data: { judgment: judgment.id, player: self.owner, reason: self.skill, card: card.id },
          },
        );
      },
    }),
  ],
} satisfies SkillDefinition;

export const yiji = {
  id: 'standard:yiji',
  name: '遗计',
  description:
    '每受到 1 点伤害后，你可以观看牌堆顶两张牌，将它们以任意方式交给角色，也可留给自己。它们暂存于仅你可见的牌池，不视为摸牌。',
  triggers: [
    on(damageReceived, {
      times: (_ctx, { payload: hit }) => hit.amount,
      order: 'choose',
      when: (_ctx, { payload: hit, self }) => hit.input.to === self.owner,
      async run(ctx, { self, occurrence }) {
        const live = () => ctx.world.player(self.owner).alive && !isGameOver(ctx.world);
        const progress =
          occurrence.total > 1 ? `（第 ${occurrence.index}/${occurrence.total} 次）` : '';
        const invoked = await invoke(
          ctx,
          self,
          `是否发动【遗计】观看并分配牌堆顶两张牌？${progress}`,
        );

        if (!invoked) return;
        await withPrivateTopCards(
          ctx,
          { player: self.owner, count: 2, reason: self.skill },
          async (at, pool) => {
            const model = new JointSelection({
              cards: () =>
                live() ? pool.remaining().map((id) => ({ id, label: at.world.card(id).name })) : [],
              targets: () =>
                live()
                  ? at.world.snapshot.players
                      .filter((player) => player.alive)
                      .map((player) => player.id)
                  : [],
              cardCount: { min: 1, max: 'all' },
              targetCount: { min: 1, max: 1 },
            });
            while (pool.remaining().length && live()) {
              const answer = await at.ask(
                model.decision(self.owner, '遗计：选择牌和一名接收者，可分批交出', {
                  optional: true,
                  cancelLabel: '保留余牌',
                  reason: self.skill,
                }),
              );
              if (answer.kind !== 'chosen') break;
              const target = answer.value.targets[0]!;
              const hand = at.world.snapshot.zones.find(
                (zone) => zone.owner === target && zone.kind === 'hand',
              )!;
              await moveCards(
                at,
                [{ cards: answer.value.cards, from: pool.zone, to: hand.id, place: 'bottom' }],
                self.skill,
                {
                  kind: 'cards.given',
                  data: {
                    actor: self.owner,
                    target,
                    count: answer.value.cards.length,
                    reason: self.skill,
                  },
                },
              );
            }
            if (live() && pool.remaining().length) {
              const hand = at.world.snapshot.zones.find(
                (zone) => zone.owner === self.owner && zone.kind === 'hand',
              )!;
              await moveCards(
                at,
                [{ cards: pool.remaining(), from: pool.zone, to: hand.id, place: 'bottom' }],
                self.skill,
                {
                  kind: 'cards.given',
                  data: {
                    actor: self.owner,
                    target: self.owner,
                    count: pool.remaining().length,
                    reason: self.skill,
                  },
                },
              );
            }
          },
        );
      },
    }),
  ],
} satisfies SkillDefinition;
