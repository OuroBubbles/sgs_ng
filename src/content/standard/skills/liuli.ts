import {
  canDiscard,
  HE,
  ownedCards,
  select,
  selection,
  skill,
  on,
  Target,
  attackRange,
  distance,
} from '../../../sdk';
import type {
  CardEffect,
  Context,
  JointChoice,
  SemanticCard,
  SkillHandle,
  UsePlanView,
} from '../../../sdk';

function redirects(ctx: Context, self: SkillHandle, use: UsePlanView, effect: CardEffect) {
  const cards = () =>
    ownedCards(ctx.world, self.owner, HE).filter((card) =>
      canDiscard(ctx, { actor: self.owner, card, reason: self.skill }),
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
      distance(ctx, self.owner, target, probe) <= attackRange(ctx, self.owner, probe)
    );
  };
  const canComplete = (choice: JointChoice) =>
    (choice.cards.length ? choice.cards : cards()).some((card) =>
      (choice.targets.length ? choice.targets : targets()).some((target) => legal(card, target)),
    );
  return selection(ctx, {
    cards,
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

export default skill(
  'standard:liuli',
  '流离',
  '当你成为杀的目标时，可以弃置一张手牌或装备，将此杀转移给你攻击范围内的一名其他角色（不能是出杀者）。弃置的装备不再提供范围。',
  on(Target.confirming, {
    who: ({ effect }) => effect.target,
    when: (ctx, { use, effect }, self) =>
      effect.actor !== self.owner &&
      effect.card.name === 'standard:slash' &&
      effect.state === 'targeting' &&
      redirects(ctx, self, use, effect).available(),
    cost: (ctx, { use, effect }, self) =>
      select(
        ctx,
        self.owner,
        redirects(ctx, self, use, effect),
        '流离：弃置一张牌，将杀转移给攻击范围内的其他角色',
        {
          cancel: '不发动流离',
          reason: self.skill,
          describe: () => ({ previousTargets: use.effects.map((entry) => entry.target) }),
        },
      ),
    declare(ctx, { use, effect }, self, picked) {
      const target = picked.targets[0]!;
      return {
        discard: picked.cards,
        areas: HE,
        legal: picked.valid,
        changes: [
          use.replaceTargetChange(ctx, effect.effectId, target, self.skill, {
            ignoreDistance: true,
          }),
        ],
        data: { targets: [target], redirect: { useId: use.id, from: self.owner, to: target } },
      };
    },
  }),
);
