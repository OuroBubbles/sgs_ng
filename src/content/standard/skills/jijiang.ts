import {
  currentPhase,
  defineMark,
  isGameOver,
  others,
  alive,
  kingdomOf,
  peers,
  skill,
  on,
  declare,
  withCardSupply,
  Response,
  useCard,
  validateUse,
} from '../../../sdk';
import type {
  CardChoice,
  Context,
  SemanticCard,
  SkillHandle,
  UseIntent,
  ViewAsInput,
} from '../../../sdk';

/** 激将本阶段是否已请求失败；阶段结束自动清除。 */
const failed = defineMark('standard:jijiang-failed', false, { scope: 'phase' });

function markFailed(ctx: Context, self: SkillHandle) {
  if (currentPhase(ctx) && !isGameOver(ctx.world)) failed.set(ctx, self.owner, true);
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

export default skill(
  'standard:jijiang',
  '激将',
  '主公技。当你需要使用或打出杀时，可以请求其他蜀势力角色依次替你打出杀。实际供牌者打出，使用杀时由你承担目标、距离和次数；本阶段请求失败后，不能再主动以激将使用杀。',
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
  {
    id: 'ask-slash',
    available: (ctx: Context, { self, purpose }: ViewAsInput) =>
      purpose === 'use' && peers(ctx, self.owner, '蜀').length > 0 && !failed.of(ctx, self.owner),
    make: { name: 'standard:slash' },
    use: (ctx, { self, intent }) =>
      ctx.flow('jijiang.use', async (at) => {
        const probe: UseIntent = { ...intent, choice: probeChoice };
        const live = (current: Context) => validateUse(current, probe).ok;
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
              useCard(useAt, {
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
  { lord: true },
);
