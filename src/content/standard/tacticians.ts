import {
  ownedCards,
  on,
  modify,
  cardQueries,
  useDeclared,
  targetSpecified,
  targetConfirming,
  targetConfirmed,
  invoke,
  draw,
  JointSelection,
  payDiscard,
} from '../../sdk';
import type {
  CardBook,
  Context,
  SkillHandle,
  SemanticCard,
  UsePlanView,
  CardEffect,
  JointChoice,
} from '../../sdk';
import type { SkillDefinition } from '../../sdk';

/** 跟随实体/零材料虚拟牌；有材料的转换牌不发动标准集智。 */
export function jizhi(book: CardBook) {
  return {
    id: 'standard:jizhi',
    name: '集智',
    description: '当你使用非转化的普通锦囊牌时，你可以摸一张牌。',
    triggers: [
      on(useDeclared, {
        order: 'choose',
        when: (_ctx, { payload: use, self }) =>
          use.actor === self.owner &&
          book.definition(use.card.name).type === 'trick' &&
          !book.definition(use.card.name).delayed &&
          (use.card.source === null || use.card.materials.length === 0),
        async run(ctx, { self }) {
          const accepted = await invoke(ctx, self, '集智：是否摸一张牌？');

          if (accepted) await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
        },
      }),
    ],
  } satisfies SkillDefinition;
}
export function qicai(book: CardBook) {
  return {
    id: 'standard:qicai',
    name: '奇才',
    description: '锁定技，你使用锦囊牌无距离限制；仍须满足其他目标条件。',
    modifiers: [
      modify(cardQueries.ignoreDistance, (_ctx, { input: request, self }) =>
        request.actor === self.owner && book.definition(request.card.name).type === 'trick'
          ? true
          : undefined,
      ),
    ],
  } satisfies SkillDefinition;
}
export const wushuang = {
  id: 'standard:wushuang',
  name: '无双',
  description: '锁定技，你使用杀需要目标连续使用两张闪；与你决斗的角色每次需连续打出两张杀。',
  triggers: [
    on(targetSpecified, {
      when: (_ctx, { payload: { effect }, self }) =>
        effect.actor === self.owner &&
        effect.state === 'targeting' &&
        ['standard:slash', 'standard:duel'].includes(effect.card.name),
      run(ctx, { payload: { effect }, self }) {
        effect.requireResponses(ctx, effect.target, 2, self.skill);
      },
    }),
    on(targetConfirmed, {
      when: (_ctx, { payload: { effect }, self }) =>
        effect.target === self.owner &&
        effect.state === 'targeting' &&
        effect.card.name === 'standard:duel',
      run(ctx, { payload: { effect }, self }) {
        effect.requireResponses(ctx, effect.actor, 2, self.skill);
      },
    }),
  ],
} satisfies SkillDefinition;
export const guose = {
  id: 'standard:guose',
  name: '国色',
  description: '可以将一张方块手牌或装备牌当乐不思蜀使用。',
  viewAs: [
    {
      id: 'diamond-indulgence',
      count: { min: 1, max: 1 },
      materials: (ctx, { self, book }) =>
        ownedCards(ctx.world, self.owner, ['hand', 'equipment']).filter(
          (id) => book.face(ctx, id).suit === 'diamond',
        ),
      make: { name: 'standard:indulgence' },
    },
  ],
} satisfies SkillDefinition;

function liuliSelection(
  ctx: Context,
  self: SkillHandle,
  book: CardBook,
  use: UsePlanView,
  effect: CardEffect,
) {
  const cards = () =>
    ownedCards(ctx.world, self.owner, ['hand', 'equipment']).filter((card) =>
      book.canDiscard(ctx, { actor: self.owner, owner: self.owner, card, reason: self.skill }),
    );
  const targets = () =>
    ctx.world.snapshot.players
      .filter((p) => p.alive && p.id !== self.owner && p.id !== effect.actor)
      .map((p) => p.id);
  const legal = (card: string, target: string): boolean => {
    // 假想杀只查询大乔的范围，不调用 build/use，不引入大乔的用牌次数或禁用条件。
    // 材料即弃牌费用，装备查询因此不会借用即将离场的武器/进攻坐骑。
    const probe: SemanticCard = {
      name: 'standard:slash',
      suit: 'none',
      color: 'none',
      rank: 0,
      nature: 'normal',
      materials: [card],
      source: { kind: 'generated', reason: self.skill },
    };
    return (
      effect.state === 'targeting' &&
      use.canReplaceTarget(ctx, effect.effectId, target, { ignoreDistance: true }) &&
      book.distance(ctx, self.owner, target, probe) <= book.attackRange(ctx, self.owner, probe)
    );
  };
  const canComplete = (choice: JointChoice) =>
    (choice.cards.length ? choice.cards : cards()).some((card) =>
      (choice.targets.length ? choice.targets : targets()).some((target) => legal(card, target)),
    );
  return new JointSelection({
    cards: () => cards().map((id) => ({ id, label: ctx.world.card(id).name })),
    targets,
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 1, max: 1 },
    constraints: {
      canComplete,
      complete: (choice) =>
        legal(choice.cards[0]!, choice.targets[0]!) ? null : '不满足流离的范围或目标条件。',
    },
  });
}
export function liuli(book: CardBook) {
  return {
    id: 'standard:liuli',
    name: '流离',
    description:
      '当你成为杀的目标时，可以弃置一张手牌或装备，将此杀转移给你攻击范围内的一名其他角色（不能是出杀者）。弃置的装备不再提供范围。',
    triggers: [
      on(targetConfirming, {
        order: 'choose',
        when: (ctx, { payload: { use, effect }, self }) =>
          effect.target === self.owner &&
          effect.actor !== self.owner &&
          effect.card.name === 'standard:slash' &&
          effect.state === 'targeting' &&
          liuliSelection(ctx, self, book, use, effect).available(),
        async run(ctx, { payload: { use, effect }, self }) {
          const model = liuliSelection(ctx, self, book, use, effect);
          const decision = model.decision(
            self.owner,
            '流离：弃置一张牌，将杀转移给攻击范围内的其他角色',
            { optional: true, reason: self.skill, cancelLabel: '不发动流离' },
          );
          const answer = await ctx.ask({
            ...decision,
            describe: () => {
              const description = decision.describe!();
              if (!description || typeof description !== 'object')
                throw new Error('Invalid selection description.');
              return { ...description, previousTargets: use.effects.map((entry) => entry.target) };
            },
          });
          if (answer.kind !== 'chosen') return;
          const target = answer.value.targets[0]!;
          await payDiscard(ctx, book, {
            skill: self,
            cards: answer.value.cards,
            reason: self.skill,
            areas: ['hand', 'equipment'],
            legal: () => model.validate(answer.value).ok,
            changes: [
              use.replaceTargetChange(ctx, effect.effectId, target, self.skill, {
                ignoreDistance: true,
              }),
            ],
            factKind: 'skill.invoked',
            declaration: {
              label: self.name,
              targets: [target],
              redirect: { useId: use.id, from: self.owner, to: target },
            },
          });
        },
      }),
    ],
  } satisfies SkillDefinition;
}
