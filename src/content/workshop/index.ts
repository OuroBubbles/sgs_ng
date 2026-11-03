import {
  chooseOne,
  draw,
  invoke,
  on,
  recover,
  equipmentCard,
  equipmentLost,
  damage,
  isChained,
  setChained,
  rulesOf,
  Use,
  Cards,
} from '../../sdk';
import type { Card, CardDefinition, ContentDefinition } from '../../sdk';
import { relay, ward } from './defense';
import { vermilion, createFaceDeck } from './faces';
import { insight, echo } from './learning';
import { allotment } from './allotment';
import type { SkillDefinition } from '../../sdk';

/** 作者演示牌；复用标准锦囊与选择流程，无专用 UI 或内核分支。 */
export const prepare: CardDefinition = {
  id: 'workshop:prepare',
  label: '整备',
  type: 'trick',
  counterable: true,
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => target === request.actor,
    async resolve(ctx, { effect }) {
      const player = ctx.world.player(effect.target);
      const answer = await ctx.ask(
        chooseOne({
          player: effect.target,
          prompt: '整备：选择一项',
          reason: 'workshop:prepare',
          options: [
            { id: 'draw', label: '摸两张牌' },
            ...(player.hp < player.maxHp ? [{ id: 'recover', label: '回复一点体力' }] : []),
          ],
        }),
      );
      if (answer.kind !== 'chosen') return ctx.abort('整备选择中止。');
      if (answer.value === 'recover')
        await recover(ctx, { from: effect.actor, to: effect.target, amount: 1, card: effect });
      else await draw(ctx, { player: effect.target, count: 2, reason: 'workshop:prepare' });
    },
  },
};

/** 普通多目标锦囊；每个目标结算时读取当前状态，不在客户端维护连环列表。 */
export const bind: CardDefinition = {
  id: 'workshop:bind',
  label: '缚阵',
  type: 'trick',
  counterable: true,
  use: {
    count: { min: 1, max: 2 },
    target: () => true,
    resolve: (ctx, { effect }) =>
      setChained(ctx, effect.target, !isChained(ctx.world, effect.target), effect.card.name),
  },
};

export const ember: CardDefinition = {
  id: 'workshop:ember',
  label: '引焰',
  type: 'trick',
  counterable: true,
  nature: 'fire',
  use: {
    count: { min: 1, max: 1 },
    target: (_ctx, { request, target }) => target !== request.actor,
    resolve: (ctx, { effect }) =>
      damage(ctx, {
        from: effect.actor,
        to: effect.target,
        amount: 1,
        nature: effect.card.nature,
        card: effect,
      }),
  },
};

/** 工厂拿到本局目录，因此其他内容与转换锦囊也按真实牌类型判定。 */
export const hearing = {
  id: 'workshop:hearing',
  name: '闻策',
  description: '当你使用锦囊牌时，你可以摸一张牌。',
  triggers: [
    on(Use.declared, {
      order: 'choose',
      when: (ctx, { payload: use, self }) =>
        use.actor === self.owner && rulesOf(ctx).definition(use.card.name).type === 'trick',
      async run(ctx, { self }) {
        const accepted = await invoke(ctx, self, '闻策：是否摸一张牌？');
        if (accepted) await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
      },
    }),
  ],
} satisfies SkillDefinition;

/** 历史来源仍可普通 invoke；当前装备、转换与查询目录不会重新获得这件牌。 */
export const relicJade = equipmentCard({
  id: 'workshop:relic_jade',
  label: '遗玉',
  slot: 'armor',
  skill: {
    id: 'workshop:jade-echo',
    name: '玉碎',
    description: '遗玉离开你的装备区后，你可以摸一张牌。不是装备时被弃置不会发动。',
    triggers: [
      on(Cards.moved, {
        order: 'choose',
        retain: (ctx, { payload: moved, self }) => equipmentLost(ctx.world, moved, self),
        when: (ctx, { payload: moved, self }) => equipmentLost(ctx.world, moved, self),
        async run(ctx, { self }) {
          const accepted = await invoke(ctx, self, '是否发动【玉碎】摸一张牌？');
          if (accepted) await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
        },
      }),
    ],
  } satisfies SkillDefinition,
});

export default {
  cards: [prepare, relicJade, bind, ember, ward],
  skills: [hearing, relay, vermilion, insight, echo, allotment],
  generals: [
    {
      id: 'workshop:quartermaster',
      name: '筹策客',
      kingdom: '群',
      gender: 'male',
      maxHp: 4,
      skills: ['workshop:allotment'],
    },
    {
      id: 'workshop:inquirer',
      name: '问道客',
      kingdom: '群',
      gender: 'male',
      maxHp: 4,
      skills: ['workshop:insight'],
    },
    {
      id: 'workshop:vermilion_guest',
      name: '绯衣客',
      kingdom: '群',
      gender: 'female',
      maxHp: 3,
      skills: [vermilion.id, 'standard:wusheng'],
    },
    {
      id: 'workshop:guardian',
      name: '守阵客',
      kingdom: '群',
      gender: 'female',
      maxHp: 4,
      skills: ['workshop:relay'],
    },
    {
      id: 'workshop:guest',
      name: '演武客',
      kingdom: '群',
      gender: 'male',
      maxHp: 4,
      skills: ['workshop:hearing', 'standard:wusheng'],
    },
  ],
  cardViews: [
    {
      id: ward.id,
      kind: 'trick',
      description:
        '作者演示牌。对自己使用，获得 2 点护盾。伤害先消耗护盾，余量才扣体力；完全吸收仍属于受到伤害，不阻断连环。失去体力不消耗护盾。可被无懈可击。',
    },
    {
      id: bind.id,
      kind: 'trick',
      description:
        '作者演示牌。选择一至两名角色，分别切换其连环状态。可选择自己；每个目标可被无懈可击。',
    },
    {
      id: ember.id,
      kind: 'trick',
      description:
        '作者演示牌。对一名其他角色造成 1 点火焰伤害。若目标处于连环，其受到的伤害会依次传给当时的其他连环角色；每名角色受到伤害时解除连环。可被无懈可击。',
    },
    {
      id: prepare.id,
      kind: 'trick',
      description:
        '作者演示牌。对自己使用，选择摸两张牌，或回复 1 点体力。未受伤时只能摸牌；可被无懈可击。',
    },
    {
      id: relicJade.id,
      kind: 'equipment',
      description: '防具。离开你的装备区后，你可以摸一张牌。手牌中的遗玉被弃置不会发动。',
    },
  ],
  decks: [
    { id: 'workshop:faces', label: '牌面演练（40 张）', create: createFaceDeck },
    {
      id: 'workshop:defense',
      label: '护盾与转移（48 张）',
      create() {
        const names = [
          ...Array<string>(8).fill(ward.id),
          ...Array<string>(8).fill(bind.id),
          ...Array<string>(8).fill(ember.id),
          ...Array<string>(12).fill('standard:slash'),
          ...Array<string>(6).fill('standard:jink'),
          ...Array<string>(6).fill('standard:peach'),
        ];
        const suits: readonly Card['suit'][] = ['spade', 'heart', 'club', 'diamond'];
        return names.map((name, i) => ({
          id: `defense-card-${i + 1}`,
          name,
          suit: suits[i % 4]!,
          rank: (i % 13) + 1,
        }));
      },
    },
    {
      id: 'workshop:chains',
      label: '连环演练（48 张）',
      create() {
        const names = [
          ...Array<string>(12).fill(bind.id),
          ...Array<string>(8).fill(ember.id),
          ...Array<string>(12).fill('standard:slash'),
          ...Array<string>(8).fill('standard:jink'),
          ...Array<string>(8).fill('standard:peach'),
        ];
        const suits: readonly Card['suit'][] = ['spade', 'heart', 'club', 'diamond'];
        return names.map((name, i) => ({
          id: `chain-card-${i + 1}`,
          name,
          suit: suits[i % 4]!,
          rank: (i % 13) + 1,
        }));
      },
    },
    {
      id: 'workshop:showcase',
      label: '机制演武（44 张）',
      create() {
        const names = [
          ...Array<string>(12).fill('standard:slash'),
          ...Array<string>(12).fill('standard:jink'),
          ...Array<string>(8).fill('standard:peach'),
          ...Array<string>(4).fill('standard:duel'),
          ...Array<string>(4).fill('standard:ex_nihilo'),
          ...Array<string>(4).fill(prepare.id),
        ];
        const suits: readonly Card['suit'][] = ['spade', 'heart', 'club', 'diamond'];
        return names.map((name, i) => ({
          id: `workshop-card-${i + 1}`,
          name,
          suit: suits[i % 4]!,
          rank: (i % 13) + 1,
        }));
      },
    },
    {
      id: 'workshop:relics',
      label: '遗玉演练（40 张）',
      create() {
        const names = [
          ...Array<string>(8).fill(relicJade.id),
          ...Array<string>(8).fill('standard:eight_diagram'),
          ...Array<string>(12).fill('standard:slash'),
          ...Array<string>(8).fill('standard:jink'),
          ...Array<string>(4).fill('standard:peach'),
        ];
        const suits: readonly Card['suit'][] = ['spade', 'heart', 'club', 'diamond'];
        return names.map((name, i) => ({
          id: `relic-card-${i + 1}`,
          name,
          suit: suits[i % 4]!,
          rank: (i % 13) + 1,
        }));
      },
    },
  ],
} satisfies ContentDefinition;
