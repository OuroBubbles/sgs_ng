import {
  on,
  damageReceived,
  responseRequested,
  phaseStarted,
  invoke,
  kingdomOf,
  ownedCards,
  JointSelection,
  pay,
  chooseOwnedCard,
  moveCards,
  isGameOver,
} from '../../sdk';
import type {
  CardBook,
  Context,
  EffectRef,
  PhaseView,
  SkillHandle,
  ResponseOpportunity,
} from '../../sdk';
import { otherSeats } from './helpers';
import type { SkillDefinition } from '../../sdk';
function availableMaterials(ctx: Context, card: EffectRef | undefined): card is EffectRef {
  return (
    !!card &&
    card.card.materials.length > 0 &&
    card.card.materials.every((id) => ctx.world.position(id) === card.processing)
  );
}

export const jianxiong = {
  id: 'standard:jianxiong',
  name: '奸雄',
  description:
    '受到一次伤害后，你可以获得造成此伤害的牌。其全部实体材料须仍在此次用牌的处理区中；没有实体材料的牌无法获得。',
  triggers: [
    on(damageReceived, {
      order: 'choose',
      when: (ctx, { payload: hit, self }) =>
        hit.input.to === self.owner && availableMaterials(ctx, hit.input.card),
      async run(ctx, { payload: hit, self }) {
        const card = hit.input.card!;
        const live = () => availableMaterials(ctx, card) && !isGameOver(ctx.world);
        const invoked = await invoke(ctx, self, '是否发动【奸雄】获得造成伤害的牌？', live);

        // 支付后失去技能不撤销宣告；材料只认这次用牌的处理区，不能追回已经移走的实体。
        if (!invoked || !ctx.world.player(self.owner).alive || !live()) return;
        const hand = ctx.world.snapshot.zones.find(
          (zone) => zone.owner === self.owner && zone.kind === 'hand',
        )!;
        await moveCards(
          ctx,
          [{ cards: card.card.materials, from: card.processing, to: hand.id, place: 'bottom' }],
          self.skill,
          {
            kind: 'use.materials-obtained',
            data: {
              actor: self.owner,
              useId: card.useId,
              cards: card.card.materials,
              reason: self.skill,
            },
          },
        );
      },
    }),
  ],
} satisfies SkillDefinition;

function canAskHujia(ctx: Context, request: ResponseOpportunity): boolean {
  return (
    request.available(ctx) &&
    (request.purpose === 'response' ||
      request.canProvide(ctx, {
        kind: 'generated',
        face: { name: 'standard:jink' },
        materials: [],
        reason: 'standard:hujia',
      }))
  );
}
export const hujia = {
  id: 'standard:hujia',
  name: '护驾',
  lord: true,
  description:
    '主公技。当你需要使用或打出闪时，可以令其他魏势力角色按座次依次选择是否替你打出闪。供牌者支付并结算打出后效，需要使用时再由你使用。',
  triggers: [
    on(responseRequested, {
      order: 'choose',
      when: (ctx, { payload: request, self }) =>
        request.actor === self.owner &&
        request.actor === request.beneficiary &&
        request.names.includes('standard:jink') &&
        canAskHujia(ctx, request) &&
        otherSeats(ctx, self.owner).some(
          (id) => ctx.world.player(id).alive && kingdomOf(ctx.world, id) === '魏',
        ),
      async run(ctx, { payload: request, self }) {
        const invoked = await invoke(
          ctx,
          self,
          '是否发动【护驾】请求其他魏势力角色打出闪？',
          (at) => canAskHujia(at, request),
        );

        if (!invoked) return;
        for (const actor of otherSeats(ctx, self.owner)) {
          if (!canAskHujia(ctx, request)) break;
          if (!ctx.world.player(actor).alive || kingdomOf(ctx.world, actor) !== '魏') continue;
          const response = await request.delegate(ctx, actor, ['standard:jink']);

          if (response.kind === 'responded' || response.kind === 'used') break;
        }
      },
    }),
  ],
} satisfies SkillDefinition;

function tuxiSelection(ctx: Context, self: SkillHandle, phase: PhaseView): JointSelection {
  return new JointSelection({
    targets: () =>
      !phase.replaced && ctx.world.player(self.owner).alive && !isGameOver(ctx.world)
        ? otherSeats(ctx, self.owner).filter(
            (id) => ctx.world.player(id).alive && ownedCards(ctx.world, id).length > 0,
          )
        : [],
    targetCount: { min: 1, max: 2 },
  });
}
export function tuxi(book: CardBook) {
  return {
    id: 'standard:tuxi',
    name: '突袭',
    description:
      '摸牌阶段开始时，你可以放弃默认摸牌，改为获得至多两名其他角色的各一张手牌。选择一至两人，按座次结算；这不是跳过摸牌阶段。',
    triggers: [
      on(phaseStarted, {
        order: 'choose',
        when: (ctx, { payload: phase, self }) =>
          phase.owner === self.owner &&
          phase.kind === 'draw' &&
          tuxiSelection(ctx, self, phase).available(),
        async run(ctx, { payload: phase, self }) {
          const model = tuxiSelection(ctx, self, phase);
          const answer = await ctx.ask(
            model.decision(self.owner, '突袭：选择一至两名角色，获得各一张手牌', {
              optional: true,
              cancelLabel: '正常摸牌',
              reason: self.skill,
            }),
          );
          if (answer.kind !== 'chosen') return;
          const paid = await pay(ctx, {
            skill: self,
            reason: self.skill,
            legal: () => model.validate(answer.value).ok,
            changes: [phase.replaceChange(ctx, self.skill)],
            factKind: 'skill.invoked',
            declaration: { label: self.name, targets: answer.value.targets },
          });

          if (paid.kind !== 'paid') return;
          for (const target of otherSeats(ctx, self.owner).filter((id) =>
            answer.value.targets.includes(id),
          )) {
            if (!ctx.world.player(self.owner).alive || isGameOver(ctx.world)) break;
            if (!ctx.world.player(target).alive || !ownedCards(ctx.world, target).length) continue;
            const chosen = await chooseOwnedCard(ctx, book, {
              actor: self.owner,
              target,
              areas: ['hand'],
              reason: self.skill,
            });

            if (chosen.kind !== 'chosen') continue;
            const { card, from } = chosen;
            const hand = ctx.world.snapshot.zones.find(
              (zone) => zone.owner === self.owner && zone.kind === 'hand',
            )!;
            await moveCards(
              ctx,
              [{ cards: [card], from, to: hand.id, place: 'bottom' }],
              self.skill,
              {
                kind: 'card.taken',
                data: { actor: self.owner, target, card, open: false, reason: self.skill },
              },
            );
          }
        },
      }),
    ],
  } satisfies SkillDefinition;
}
