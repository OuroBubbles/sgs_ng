import {
  ownedCards,
  JointSelection,
  defineState,
  readState,
  stateChange,
  setState,
  pay,
  payDiscard,
  used,
  recover,
  currentPhase,
  activeTurn,
  activeTarget,
  isGameOver,
  on,
  responseRequested,
  invoke,
  kingdomOf,
  withCardSupply,
} from '../../sdk';
import type {
  Context,
  PhaseView,
  SkillHandle,
  CardChoice,
  UseIntent,
  SemanticCard,
  ActiveInput,
} from '../../sdk';
import { otherSeats } from './helpers';
import type { SkillDefinition } from '../../sdk';

const given = defineState(
  'standard:rende-given',
  0,
  (value): value is number => Number.isSafeInteger(value) && Number(value) >= 0,
);
const failed = defineState(
  'standard:jijiang-failed',
  false,
  (value): value is boolean => typeof value === 'boolean',
);
const scope = (self: SkillHandle, phase: PhaseView) => ({
  owner: self.owner,
  source: self.skill,
  lifetime: phase.lifetime,
});
const phaseLive = (ctx: Context, self: SkillHandle, phase: PhaseView) =>
  ctx.world.player(self.owner).alive && !phase.turn?.ended && !isGameOver(ctx.world);

function rendeSelection(ctx: Context, { self, phase }: ActiveInput): JointSelection {
  return new JointSelection({
    cards: () =>
      phaseLive(ctx, self, phase)
        ? ownedCards(ctx.world, self.owner).map((id) => ({ id, label: ctx.world.card(id).name }))
        : [],
    targets: () =>
      phaseLive(ctx, self, phase)
        ? otherSeats(ctx, self.owner).filter((id) => ctx.world.player(id).alive)
        : [],
    cardCount: { min: 1, max: 'all' },
    targetCount: { min: 1, max: 1 },
  });
}
export const rende = {
  id: 'standard:rende',
  name: '仁德',
  description:
    '出牌阶段，你可以将至少一张手牌交给一名其他角色，可以多次分配。本阶段以此法给出的手牌首次累计达到两张后，你回复 1 点体力。交牌不是弃牌。',
  active: [
    {
      id: 'give',
      selection: rendeSelection,
      async run(ctx, { self, phase, choice, selection: model }) {
        const target = choice.targets[0]!;
        const hand = ctx.world.snapshot.zones.find(
          (zone) => zone.owner === target && zone.kind === 'hand',
        )!;
        const before = readState(ctx.world, given, scope(self, phase));
        const after = before + choice.cards.length;
        const paid = await pay(ctx, {
          skill: self,
          cards: choice.cards,
          to: hand.id,
          areas: ['hand'],
          reason: self.skill,
          legal: () => model.validate(choice).ok,
          changes: [stateChange(ctx, given, scope(self, phase), after)],
          factKind: 'skill.invoked',
          declaration: { label: self.name, targets: [target], count: choice.cards.length },
        });

        if (paid.kind !== 'paid') return;
        // 累计与交牌同次提交；后效中的失去/重新获得技能不能重置本阶段累计。
        if (before < 2 && after >= 2 && ctx.world.player(self.owner).alive)
          await recover(ctx, { from: self.owner, to: self.owner, amount: 1 });
      },
    },
  ],
} satisfies SkillDefinition;

const qingnangLimit = (self: SkillHandle, phase: PhaseView) => ({
  key: 'qingnang',
  source: self.skill,
  lifetime: phase.lifetime,
  max: 1,
});
function qingnangSelection(ctx: Context, { self, phase, book }: ActiveInput): JointSelection {
  return new JointSelection({
    cards: () =>
      phaseLive(ctx, self, phase)
        ? ownedCards(ctx.world, self.owner)
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
    targets: () =>
      phaseLive(ctx, self, phase)
        ? ctx.world.snapshot.players
            .filter((player) => player.alive && player.hp < player.maxHp)
            .map((player) => player.id)
        : [],
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 1, max: 1 },
  });
}
export const qingnang = {
  id: 'standard:qingnang',
  name: '青囊',
  description:
    '出牌阶段限一次，你可以弃置一张手牌，令一名已受伤的角色回复 1 点体力，可以选择自己。',
  active: [
    {
      id: 'discard-heal',
      available: (ctx, { self, phase }) =>
        used(ctx.world, self.owner, qingnangLimit(self, phase)) === 0,
      selection: qingnangSelection,
      async run(ctx, { self, phase, book, choice, selection: model }) {
        const paid = await payDiscard(ctx, book, {
          skill: self,
          cards: choice.cards,
          areas: ['hand'],
          reason: self.skill,
          limit: qingnangLimit(self, phase),
          legal: () => model.validate(choice).ok,
          factKind: 'skill.invoked',
          declaration: { label: self.name, targets: choice.targets },
        });

        if (paid.kind !== 'paid') return;
        const target = choice.targets[0]!;
        if (ctx.world.player(target).alive)
          await recover(ctx, { from: self.owner, to: target, amount: 1 });
      },
    },
  ],
} satisfies SkillDefinition;
export const jijiu = {
  id: 'standard:jijiu',
  name: '急救',
  description:
    '你的回合外，你可以将一张红色手牌或装备牌当桃使用。救援属于使用牌，不能将急救当作普通打出。',
  viewAs: [
    {
      id: 'red-peach',
      count: { min: 1, max: 1 },
      available: (ctx, { self, purpose }) =>
        purpose === 'use' && readState(ctx.world, activeTurn, activeTarget)?.owner !== self.owner,
      materials: (ctx, { self, book }) =>
        ownedCards(ctx.world, self.owner, ['hand', 'equipment']).filter(
          (id) => book.face(ctx, id).color === 'red',
        ),
      make: { name: 'standard:peach' },
    },
  ],
} satisfies SkillDefinition;

const allies = (ctx: Context, owner: string) =>
  otherSeats(ctx, owner).filter(
    (id) => ctx.world.player(id).alive && kingdomOf(ctx.world, id) === '蜀',
  );
function markFailed(ctx: Context, self: SkillHandle) {
  const phase = currentPhase(ctx);
  if (phase && !isGameOver(ctx.world)) setState(ctx, failed, scope(self, phase), true);
}
function providedChoice(card: SemanticCard, actor: string, reason: string): CardChoice {
  return {
    kind: 'generated',
    reason,
    origin: { actor, card },
    materials: card.materials,
    face: {
      name: card.name,
      suit: card.suit,
      color: card.color,
      rank: card.rank,
      nature: card.nature,
    },
  };
}
const probeChoice: CardChoice = {
  kind: 'generated',
  face: { name: 'standard:slash' },
  materials: [],
  reason: 'standard:jijiang',
};
export const jijiang = {
  id: 'standard:jijiang',
  name: '激将',
  lord: true,
  description:
    '主公技。当你需要使用或打出杀时，可以请求其他蜀势力角色依次替你打出杀。实际供牌者打出，使用杀时由你承担目标、距离和次数；本阶段请求失败后，不能再主动以激将使用杀。',
  triggers: [
    on(responseRequested, {
      order: 'choose',
      when: (ctx, { payload: request, self }) =>
        request.actor === self.owner &&
        request.actor === request.beneficiary &&
        request.names.includes('standard:slash') &&
        request.available(ctx) &&
        allies(ctx, self.owner).length > 0,
      async run(ctx, { payload: request, self }) {
        const invoked = await invoke(ctx, self, '是否发动【激将】请求其他蜀角色打出杀？', (at) =>
          request.available(at),
        );

        if (!invoked) return;
        for (const actor of otherSeats(ctx, self.owner)) {
          if (!request.available(ctx)) return;
          if (!ctx.world.player(actor).alive || kingdomOf(ctx.world, actor) !== '蜀') continue;
          const result = await request.delegate(ctx, actor, ['standard:slash']);

          if (result.kind === 'responded' || result.kind === 'used') return;
        }
        markFailed(ctx, self);
      },
    }),
  ],
  viewAs: [
    {
      id: 'ask-slash',
      available(ctx, { self, purpose }) {
        const phase = currentPhase(ctx);
        return (
          purpose === 'use' &&
          allies(ctx, self.owner).length > 0 &&
          !(phase && readState(ctx.world, failed, scope(self, phase)))
        );
      },
      make: { name: 'standard:slash' },
      use: (ctx, { self, intent, book }) =>
        ctx.flow('jijiang.use', async (at) => {
          const probe: UseIntent = { ...intent, choice: probeChoice };
          const live = (current: Context) => book.validateUse(current, probe).ok;
          // 选择此配方并提交目标已经表示发动；不再追加一次是否发动的询问。
          const paid = await pay(at, {
            skill: self,
            reason: self.skill,
            factKind: 'skill.invoked',
            declaration: { label: self.name },
            legal: () => live(at),
          });

          if (paid.kind !== 'paid')
            return { kind: 'unavailable', reason: 'Jijiang was not invoked.' };
          for (const actor of otherSeats(at, self.owner)) {
            if (!live(at)) return { kind: 'unavailable', reason: 'Use is no longer available.' };
            if (!at.world.player(actor).alive || kingdomOf(at.world, actor) !== '蜀') continue;
            const supplied = await withCardSupply(
              at,
              book,
              {
                actor,
                beneficiary: self.owner,
                names: ['standard:slash'],
                reason: self.skill,
                available: live,
              },
              (useAt, supply) =>
                book.use(useAt, {
                  ...intent,
                  choice: providedChoice(supply.card, actor, self.skill),
                }),
            );

            if (supplied.kind === 'supplied') return supplied.value;
            if (supplied.kind === 'invalidated')
              return {
                kind: 'unavailable',
                reason: 'Supplied card was invalidated after payment.',
              };
          }
          markFailed(at, self);
          return { kind: 'unavailable', reason: 'No Shu player supplied Slash.' };
        }),
    },
  ],
} satisfies SkillDefinition;
