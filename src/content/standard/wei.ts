import {
  on,
  damageReceived,
  damageCausing,
  drawing,
  phaseStarted,
  invoke,
  askInvoke,
  judge,
  damage,
  ownedCards,
  JointSelection,
  pay,
  payDiscard,
  moveCards,
  effectOn,
  activeTurn,
  activeTarget,
  readState,
  isGameOver,
  isDirectDamage,
} from '../../sdk';
import type { CardBook, EffectDefinition, SkillDefinition } from '../../sdk';

/** 一次伤害只发动一次，不按伤害点数复制；来源在整个判定后重新检查。 */
export function ganglie(book: CardBook) {
  return {
    id: 'standard:ganglie',
    name: '刚烈',
    description:
      '受到一次伤害后，你可以判定。若不为红桃，伤害来源须弃置两张手牌，否则受到你造成的 1 点伤害。',
    triggers: [
      on(damageReceived, {
        order: 'choose',
        when: (_ctx, { payload: hit, self }) => hit.input.to === self.owner,
        async run(ctx, { payload: hit, self }) {
          const invoked = await invoke(ctx, self, '是否发动【刚烈】进行判定？');

          if (!invoked) return;
          const judgment = await judge(ctx, book, {
            player: self.owner,
            reason: self.skill,
            match: (_at, card) => card.suit !== 'heart',
          });

          const source = hit.input.from;
          const live = () =>
            source !== null && ctx.world.player(source).alive && !isGameOver(ctx.world);
          if (!judgment.matched || !live() || source === null) return;

          const model = new JointSelection({
            cards: () =>
              live()
                ? ownedCards(ctx.world, source)
                    .filter((card) =>
                      book.canDiscard(ctx, {
                        actor: source,
                        owner: source,
                        card,
                        reason: self.skill,
                      }),
                    )
                    .map((id) => ({ id, label: book.definition(ctx.world.card(id).name).label }))
                : [],
            cardCount: { min: 2, max: 2 },
          });
          const answer = await ctx.ask(
            model.decision(source, '刚烈：弃置两张手牌，否则受到 1 点伤害', {
              optional: true,
              reason: self.skill,
              cancelLabel: '承受伤害',
            }),
          );
          if (answer.kind === 'chosen') {
            const discarded = await payDiscard(ctx, book, {
              actor: source,
              cards: answer.value.cards,
              areas: ['hand'],
              reason: self.skill,
              factKind: 'cards.discarded',
              legal: () => live() && model.validate(answer.value).ok,
            });

            if (discarded.kind === 'paid') return;
          }
          if (live())
            await damage(ctx, { from: self.owner, to: source, amount: 1, nature: 'normal' });
        },
      }),
    ],
  } satisfies SkillDefinition;
}

interface LuoyiData {
  readonly actor: string;
  readonly turn: string;
}
export const luoyiAftereffect = {
  id: 'standard:luoyi-effect',
  name: '裸衣',
  accepts: (value): value is LuoyiData =>
    value !== null &&
    typeof value === 'object' &&
    'actor' in value &&
    typeof value.actor === 'string' &&
    'turn' in value &&
    typeof value.turn === 'string',
  create: (self) => ({
    triggers: [
      effectOn(damageCausing, {
        when: (ctx, { payload: hit }) =>
          ctx.world.player(self.data.actor).alive &&
          readState(ctx.world, activeTurn, activeTarget)?.id === self.data.turn &&
          isDirectDamage(hit.input) &&
          !hit.prevented &&
          hit.input.from === self.data.actor &&
          hit.input.card?.actor === self.data.actor &&
          ['standard:slash', 'standard:duel'].includes(hit.input.card?.card.name ?? ''),
        run: (_ctx, { payload: hit }) => hit.adjust(1, 'standard:luoyi'),
      }),
    ],
  }),
} satisfies EffectDefinition<LuoyiData>;

export function luoyi(book: CardBook) {
  return {
    id: 'standard:luoyi',
    name: '裸衣',
    description:
      '摸牌阶段，你可以少摸一张牌。若如此做，本回合你使用杀或决斗造成的伤害加 1。已发动的效果不因失去裸衣而消失。',
    triggers: [
      on(drawing, {
        order: 'choose',
        when: (_ctx, { payload: draft, self }) =>
          draft.input.player === self.owner &&
          draft.phase?.kind === 'draw' &&
          draft.phase.turn !== null &&
          draft.count > 0,
        async run(ctx, { payload: draft, self }) {
          const phase = draft.phase!;
          const turn = phase.turn!;
          const live = () =>
            draft.count > 0 &&
            !turn.ended &&
            ctx.world.player(self.owner).alive &&
            self.effective(ctx.world) &&
            !isGameOver(ctx.world);
          const accepted = await askInvoke(
            ctx,
            self,
            '是否发动【裸衣】少摸一张牌，本回合杀和决斗伤害加 1？',
            live,
          );

          if (!accepted) return;
          // 重复摸牌阶段可以再次少摸，但同一角色/回合只保留一份伤害加成。
          const existing = book.effects
            .instances(ctx.world, luoyiAftereffect)
            .find((effect) => effect.data.actor === self.owner && effect.data.turn === turn.id);
          const prepared = existing
            ? null
            : await book.effects.prepare(ctx, luoyiAftereffect, {
                owner: self.owner,
                lifetime: turn.lifetime,
                origin: { actor: self.owner, skill: self.skill, instance: self.id },
                data: { actor: self.owner, turn: turn.id },
              });
          const paid = await pay(ctx, {
            skill: self,
            reason: self.skill,
            factKind: 'skill.invoked',
            declaration: { label: self.name, effect: prepared?.record ?? existing },
            legal: live,
            changes: prepared ? [prepared.change] : [],
          });

          if (paid.kind === 'paid') draft.setCount(Math.max(0, draft.count - 1), self.skill);
        },
      }),
    ],
  } satisfies SkillDefinition;
}

export const qingguo = {
  id: 'standard:qingguo',
  name: '倾国',
  description: '可以将一张黑色手牌当闪使用或打出。装备区的牌不能作为材料。',
  viewAs: [
    {
      id: 'black-jink',
      count: { min: 1, max: 1 },
      materials: (ctx, { self, book }) =>
        ownedCards(ctx.world, self.owner).filter((id) => book.face(ctx, id).color === 'black'),
      make: { name: 'standard:jink' },
    },
  ],
} satisfies SkillDefinition;

export function luoshen(book: CardBook) {
  return {
    id: 'standard:luoshen',
    name: '洛神',
    description:
      '准备阶段，你可以判定。若为黑色，你获得此判定牌，并可以继续判定，直到你停止或判定为非黑色。',
    triggers: [
      on(phaseStarted, {
        order: 'choose',
        when: (_ctx, { payload: phase, self }) =>
          phase.kind === 'prepare' && phase.owner === self.owner,
        async run(ctx, { self }) {
          const invoked = await invoke(ctx, self, '是否发动【洛神】进行判定？');

          if (!invoked) return;
          // 循环属于本次已宣告的技能；不在中途因原技能失去而切断。
          const live = () => ctx.world.player(self.owner).alive && !isGameOver(ctx.world);
          while (live()) {
            const result = await judge(ctx, book, {
              player: self.owner,
              reason: self.skill,
              match: (_at, card) => card.color === 'black',
              async onResult(at, judgment) {
                const card = judgment.card;
                if (
                  !judgment.matched ||
                  !card ||
                  !live() ||
                  at.world.position(card.id) !== judgment.processing
                )
                  return;
                const hand = at.world.snapshot.zones.find(
                  (zone) => zone.owner === self.owner && zone.kind === 'hand',
                )!;
                await moveCards(
                  at,
                  [{ cards: [card.id], from: judgment.processing, to: hand.id, place: 'bottom' }],
                  self.skill,
                  {
                    kind: 'judgment.card-obtained',
                    data: {
                      judgment: judgment.id,
                      player: self.owner,
                      reason: self.skill,
                      card: card.id,
                    },
                  },
                );
              },
            });

            if (!result.matched || !live()) return;
            if (!(await askInvoke(ctx, self, '是否继续【洛神】？', live))) return;
          }
        },
      }),
    ],
  } satisfies SkillDefinition;
}
