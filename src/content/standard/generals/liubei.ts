import {
  action,
  currentPhase,
  defineState,
  general,
  isGameOver,
  others,
  alive,
  kingdomOf,
  peers,
  readState,
  recover,
  rulesOf,
  setState,
  skill,
  stateChange,
  on,
  declare,
  withCardSupply,
  Response,
} from '../../../sdk';
import type {
  CardChoice,
  Context,
  PhaseView,
  SemanticCard,
  SkillHandle,
  UseIntent,
} from '../../../sdk';

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
const perPhase = (self: SkillHandle, phase: PhaseView) => ({
  owner: self.owner,
  source: self.skill,
  lifetime: phase.lifetime,
});

export const rende = skill({
  id: 'standard:rende',
  name: '仁德',
  description:
    '出牌阶段，你可以将至少一张手牌交给一名其他角色，可以多次分配。本阶段以此法给出的手牌首次累计达到两张后，你回复 1 点体力。交牌不是弃牌。',
  active: [
    action({
      id: 'give',
      cards: { count: [1, 'all'] },
      targets: { count: 1, filter: (_ctx, id, { self }) => id !== self.owner },
      pay: 'give',
      // 累计与交牌同次提交；后效中的失去/重新获得技能不能重置本阶段累计。
      declare: (ctx, { self, phase, cards }) => ({
        data: { count: cards.length },
        changes: [
          stateChange(
            ctx,
            given,
            perPhase(self, phase),
            readState(ctx.world, given, perPhase(self, phase)) + cards.length,
          ),
        ],
      }),
      async effect(ctx, { self, phase, cards }) {
        const after = readState(ctx.world, given, perPhase(self, phase));
        if (after - cards.length < 2 && after >= 2)
          await recover(ctx, { from: self.owner, to: self.owner, amount: 1 });
      },
    }),
  ],
  ai: {
    value: ({ self, hand, players, hostility }) =>
      self.hp < self.maxHp &&
      hand.length >= Math.max(2, self.hp + 1) &&
      players.some((p) => p.id !== self.id && p.alive && hostility(p.id) < 0)
        ? 18
        : -1,
  },
});

function markFailed(ctx: Context, self: SkillHandle) {
  const phase = currentPhase(ctx);
  if (phase && !isGameOver(ctx.world)) setState(ctx, failed, perPhase(self, phase), true);
}
const providedChoice = (card: SemanticCard, actor: string, reason: string): CardChoice => ({
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
});
const probeChoice: CardChoice = {
  kind: 'generated',
  face: { name: 'standard:slash' },
  materials: [],
  reason: 'standard:jijiang',
};

export const jijiang = skill({
  id: 'standard:jijiang',
  name: '激将',
  lord: true,
  description:
    '主公技。当你需要使用或打出杀时，可以请求其他蜀势力角色依次替你打出杀。实际供牌者打出，使用杀时由你承担目标、距离和次数；本阶段请求失败后，不能再主动以激将使用杀。',
  triggers: [
    on(Response.requested, {
      who: (request) => request.actor,
      when: (ctx, request, self) =>
        request.actor === request.beneficiary &&
        request.names.includes('standard:slash') &&
        request.available(ctx) &&
        peers(ctx, self.owner, '蜀').length > 0,
      ask: '是否发动【激将】请求其他蜀角色打出杀？',
      keep: (ctx, request) => request.available(ctx),
      async effect(ctx, request, self) {
        for (const actor of others(ctx, self.owner)) {
          if (!request.available(ctx)) return;
          if (!alive(ctx, actor) || kingdomOf(ctx.world, actor) !== '蜀') continue;
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
          peers(ctx, self.owner, '蜀').length > 0 &&
          !(phase && readState(ctx.world, failed, perPhase(self, phase)))
        );
      },
      make: { name: 'standard:slash' },
      use: (ctx, { self, intent }) =>
        ctx.flow('jijiang.use', async (at) => {
          const rules = rulesOf(at);
          const probe: UseIntent = { ...intent, choice: probeChoice };
          const live = (current: Context) => rules.validateUse(current, probe).ok;
          // 选择此配方并提交目标已经表示发动；不再追加一次是否发动的询问。
          if (!(await declare(at, self, { legal: () => live(at) })))
            return { kind: 'unavailable', reason: 'Jijiang was not invoked.' };
          for (const actor of others(at, self.owner)) {
            if (!live(at)) return { kind: 'unavailable', reason: 'Use is no longer available.' };
            if (!alive(at, actor) || kingdomOf(at.world, actor) !== '蜀') continue;
            const supplied = await withCardSupply(
              at,
              {
                actor,
                beneficiary: self.owner,
                names: ['standard:slash'],
                reason: self.skill,
                available: live,
              },
              (useAt, supply) =>
                rules.use(useAt, {
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
});

export default general({
  id: 'standard:liubei',
  name: '刘备',
  kingdom: '蜀',
  hp: 4,
  skills: [rende, jijiang],
});
