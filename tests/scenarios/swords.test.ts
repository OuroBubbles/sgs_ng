import { expect, it } from 'vitest';
import {
  differentGender,
  defineSkill,
  modify,
  cardQueries,
  genderOf,
  kill,
  moveCards,
  setGender,
  Use,
  Target,
  Cards,
  Damage,
  Cost,
} from '../../src/sdk';
import type { DamageDraft, Gender, UseIntent } from '../../src/sdk';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest, answer } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { RoleMatch } from '../../src/app/offline/role-match';
import { standardCards } from '../../src/content/standard/cards';
import { CardEvent } from '../../src/sdk';
import { Skill } from '../../src/sdk';
import { Weapon } from '../../src/content/standard/weapons';
import { Discard } from '../../src/rules/cards/discard';

type Game = ReturnType<typeof cardGame>;
const strike: UseIntent = {
  actor: 'a',
  choice: { kind: 'physical', card: 's' },
  targets: ['b'],
  timing: { kind: 'effect' },
};
const cause = { kind: 'rule', seq: null, data: null } as const;
function create(name: string, cards = 1) {
  return cardGame({
    hands: {
      a: [card('s', 'slash', 'heart')],
      b: Array.from({ length: cards }, (_, i) => card(`b${i}`, 'peach')),
    },
    equipment: { a: [card('weapon', name)] },
    draw: [card('top0', 'jink'), card('top1', 'peach')],
  });
}
async function genders(game: Game, first: Gender = 'male', second: Gender = 'female') {
  await game.room.run('profiles', (ctx) => {
    setGender(ctx, 'a', first);
    setGender(ctx, 'b', second);
  });
}
async function chooseFirst(game: Game) {
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('cards-targets');
  const choices = (request.data as { preview: { cards: { id: string; label: string }[] } }).preview
    .cards;
  expect(choices.every((c) => c.label.startsWith('未知手牌'))).toBe(true);
  expect(choices.every((c) => !['b0', 'b1'].includes(c.id))).toBe(true);
  await answer(game, { cards: [choices[0]!.id], targets: [] }, 'cards-targets');
}

it('性别为独立权威规则状态，双性/无性别比较明确，死亡后仍保留', async () => {
  const game = cardGame();
  expect(genderOf(game.room.world, 'a')).toBe('none');
  for (const [a, b, expected] of [
    ['male', 'male', false],
    ['male', 'female', true],
    ['female', 'male', true],
    ['dual', 'male', true],
    ['dual', 'dual', true],
    ['none', 'female', false],
    ['dual', 'none', false],
  ] as const) {
    await genders(game, a, b);
    expect(differentGender(game.room.world, 'a', 'b')).toBe(expected);
    expect(differentGender(game.room.world, 'a', 'a')).toBe(false);
  }
  await game.room.run('guards', async (ctx) => {
    expect(() => setGender(ctx, 'a', 'invalid' as Gender)).toThrow('Invalid state value');
    expect(() => ctx.query(() => setGender(ctx, 'a', 'female'))).toThrow();
    await kill(ctx, { player: 'a', killer: null, reason: 'rule', cause });
  });
  expect(genderOf(game.room.world, 'a')).toBe('dual');
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('RoleMatch 初始化显式性别，未指定为无性别，提交可重建', async () => {
  const match = new RoleMatch({
    id: 'profiles',
    seed: 7,
    players: [{ id: 'a', gender: 'female' }, { id: 'b' }],
    deck: [],
    content: {
      cards: standardCards,
    },
  });
  await match.prepare();
  expect(genderOf(match.room.world, 'a')).toBe('female');
  expect(genderOf(match.room.world, 'b')).toBe('none');
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
});

it('雌雄由来源确认目标发动，对方只可交手牌，弃置后仍执行原杀', async () => {
  const game = create('double_swords');
  await genders(game);
  const order: string[] = [];
  game.room.on(Target.specified, {
    id: 'source',
    owner: null,
    eligible: () => true,
    run: () => {
      order.push('source');
    },
  });
  game.room.on(Target.confirming, {
    id: 'target',
    owner: null,
    eligible: () => true,
    run: () => {
      order.push('target');
    },
  });
  const running = use(game, strike);
  await answer(game, true);
  const request = await nextRequest(game.room);
  expect(request).toMatchObject({ player: 'b', data: { cancelLabel: '令对方摸牌' } });
  await answer(game, { cards: ['b0'], targets: [] }, 'cards-targets');
  await running;
  expect(order).toEqual(['target', 'source']);
  expect(game.room.world.position('b0')).toBe('discard');
  expect(game.room.world.position('top0')).toBe('draw');
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
});

it.each([0, 1])('雌雄无手牌或拒绝弃手牌时来源摸一张：手牌 %s', async (count) => {
  const game = create('double_swords', count);
  await genders(game);
  const running = use(game, strike);
  await answer(game, true);
  if (count) {
    const request = await nextRequest(game.room);
    game.room.decisions.cancel(request.id, request.token);
  }
  await running;
  expect(game.room.world.position('top0')).toBe('a:hand');
  expect(game.room.world.player('b').hp).toBe(3);
});

it('雌雄不发动或不构成异性时没有弃牌/摸牌分支', async () => {
  for (const [first, second] of [
    ['male', 'female'],
    ['male', 'male'],
    ['none', 'female'],
  ] as const) {
    const game = create('double_swords');
    await genders(game, first, second);
    const running = use(game, strike);
    if (first === 'male' && second === 'female') await answer(game, false);
    await running;
    expect(game.room.world.position('b0')).toBe('b:hand');
    expect(game.room.world.position('top0')).toBe('draw');
    expect(game.room.history.facts(Skill.invoked)).toHaveLength(0);
  }
});

it('目标确认前被取消，不再发动后续的雌雄剑指定后技能', async () => {
  const game = create('double_swords', 0);
  await genders(game);
  game.room.on(Target.confirming, {
    id: 'cancel',
    owner: null,
    eligible: () => true,
    run: (ctx, { effect }) => effect.cancel(ctx, 'probe'),
  });
  await use(game, strike);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(0);
  expect(game.room.world.position('top0')).toBe('draw');
  expect(game.room.world.player('b').hp).toBe(4);
});

it.each(['weapon', 'source'])('雌雄已发动后 %s 离场，不撤销对方已承受的选择', async (lost) => {
  const game = create('double_swords');
  await genders(game);
  game.room.on(Cost.paid, {
    id: 'loss',
    owner: null,
    eligible: (_ctx, r) => r.skill === 'standard:double_swords-ability',
    async run(ctx) {
      if (lost === 'weapon')
        await moveCards(
          ctx,
          [{ cards: ['weapon'], from: 'a:equipment', to: 'c:hand', place: 'bottom' }],
          'probe',
        );
      else await kill(ctx, { player: 'a', killer: null, reason: 'rule', cause });
    },
  });
  const running = use(game, strike);
  await answer(game, true);
  await answer(game, { cards: ['b0'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.position('b0')).toBe('discard');
  expect(game.room.world.player('b').hp).toBe(3);
});

it('指定后雌雄支付导致目标死亡，来源可摸牌，死亡目标不再进入确认后窗口', async () => {
  const game = create('double_swords');
  await genders(game);
  game.room.on(Cost.paid, {
    id: 'death',
    owner: null,
    eligible: (_ctx, r) => r.skill === 'standard:double_swords-ability',
    async run(ctx) {
      await kill(ctx, { player: 'b', killer: null, reason: 'rule', cause });
    },
  });
  let incoming = 0;
  game.room.on(Target.confirmed, {
    id: 'incoming',
    owner: null,
    eligible: () => true,
    run: () => {
      incoming++;
    },
  });
  const running = use(game, strike);
  await answer(game, true);
  await running;
  expect(game.room.world.position('top0')).toBe('a:hand');
  expect(incoming).toBe(0);
});

it('重复目标各自指定与发动；确认前改变性别使用当前属性', async () => {
  const game = create('double_swords', 0);
  await genders(game);
  game.room.on(Use.declared, {
    id: 'repeat',
    owner: null,
    eligible: () => true,
    run: (ctx, plan) => {
      plan.repeatTarget(ctx, 'b', 'probe');
    },
  });
  const running = use(game, strike);
  await answer(game, true);
  await answer(game, true);
  await running;
  expect(game.room.world.player('b').hp).toBe(2);
  expect(game.room.world.zone('a:hand').cards).toEqual(['top0', 'top1']);
  const changed = create('double_swords');
  await genders(changed);
  changed.room.on(Use.declared, {
    id: 'gender',
    owner: null,
    eligible: () => true,
    run: (ctx) => setGender(ctx, 'b', 'male'),
  });
  await use(changed, strike);
  expect(changed.room.history.facts(Skill.invoked)).toHaveLength(0);
});

it('寒冰在来源快照之后替代伤害，连续两次暗选并停止目标伤害处理', async () => {
  const game = create('ice_sword', 2);
  game.room.on(Damage.causing, {
    id: 'boost',
    owner: null,
    eligible: () => true,
    run: (_ctx, draft) => draft.adjust(2, 'boost'),
  });
  let source = 0;
  let receiving = 0;
  game.room.on(Damage.replacing, {
    id: 'snapshot',
    owner: null,
    eligible: () => true,
    run: (_ctx, draft) => {
      source = draft.sourceSnapshot!.amount;
    },
  });
  game.room.on(Damage.inflicting, {
    id: 'target',
    owner: null,
    eligible: () => true,
    run: () => {
      receiving++;
    },
  });
  const running = use(game, strike);
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('cards-targets');
  expect(request.optional).toBe(true);
  expect(request.data).toMatchObject({
    purpose: 'owned-card',
    reason: 'standard:ice_sword-ability',
  });
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  expect(game.room.decisions.submit(request.id, request.token, true)).toMatchObject({
    kind: 'rejected',
    reason: 'invalid',
  });
  expect(game.room.history.facts(Weapon.damageReplaced)).toEqual([]);
  await chooseFirst(game);
  expect((await nextRequest(game.room)).optional).toBe(false);
  await chooseFirst(game);
  await running;
  expect(source).toBe(3);
  expect(receiving).toBe(0);
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.zone('b:hand').cards).toEqual([]);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  expect(game.room.history.facts(Damage.dealt)).toHaveLength(0);
  expect(game.room.history.facts(Damage.prevented)).toMatchObject([
    {
      data: { detail: { sourceSnapshot: { amount: 3 }, prevention: 'standard:ice_sword-ability' } },
    },
  ]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it.each([0, 1])('寒冰目标无牌不发动，只有一张则只弃一张：%s', async (count) => {
  const game = create('ice_sword', count);
  const running = use(game, strike);
  if (count) {
    await chooseFirst(game);
  }
  await running;
  expect(game.room.world.player('b').hp).toBe(count ? 4 : 3);
  expect(game.room.history.facts(Discard.committed)).toHaveLength(count);
});

it('寒冰不发动则正常伤害，不触碰目标手牌', async () => {
  const game = create('ice_sword', 2);
  const running = use(game, strike);
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('cards-targets');
  expect(game.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.zone('b:hand').cards).toHaveLength(2);
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  expect(game.room.history.facts(CardEvent.chosen)).toEqual([]);
});

it('寒冰第二次重新生成选项，包括第一次移牌后效获得的新牌', async () => {
  const game = cardGame({
    hands: { a: [card('s', 'slash')], b: [card('b0', 'peach')] },
    equipment: { a: [card('weapon', 'ice_sword')], b: [card('bw', 'crossbow')] },
    draw: [card('bonus', 'peach')],
  });
  game.room.on(Cards.moved, {
    id: 'gain',
    owner: null,
    eligible: (_ctx, moved) =>
      moved.moves.some((move) => move.cards.includes('bw') && move.to === 'discard'),
    async run(ctx) {
      await moveCards(
        ctx,
        [{ cards: ['bonus'], from: 'draw', to: 'b:hand', place: 'bottom' }],
        'probe',
      );
    },
  });
  const running = use(game, strike);
  const request = await nextRequest(game.room);
  const cards = (request.data as { preview: { cards: { id: string; label: string }[] } }).preview
    .cards;
  await answer(
    game,
    { cards: [cards.find((c) => c.label.startsWith('诸葛连弩'))!.id], targets: [] },
    'cards-targets',
  );
  const second = await nextRequest(game.room);
  expect((second.data as { preview: { cards: unknown[] } }).preview.cards).toHaveLength(2);
  await chooseFirst(game);
  await running;
  expect(game.room.world.position('bw')).toBe('discard');
  expect(game.room.world.zone('b:hand').cards).toHaveLength(1);
  expect(game.room.world.player('b').hp).toBe(4);
});

it.each(['weapon', 'source', 'target'])(
  '寒冰第一张弃置后 %s 离场，持续效果与停止条件明确',
  async (lost) => {
    const game = create('ice_sword', 2);
    let done = false;
    game.room.on(Cards.moved, {
      id: 'loss',
      owner: null,
      eligible: (_ctx, moved) =>
        !done && moved.moves.some((move) => move.from === 'b:hand' && move.to === 'discard'),
      async run(ctx) {
        done = true;
        if (lost === 'weapon')
          await moveCards(
            ctx,
            [{ cards: ['weapon'], from: 'a:equipment', to: 'c:hand', place: 'bottom' }],
            'probe',
          );
        else
          await kill(ctx, {
            player: lost === 'source' ? 'a' : 'b',
            killer: null,
            reason: 'rule',
            cause,
          });
      },
    });
    const running = use(game, strike);
    await chooseFirst(game);
    if (lost === 'weapon') await chooseFirst(game);
    await running;
    expect(game.room.history.facts(Discard.committed)).toHaveLength(lost === 'weapon' ? 2 : 1);
    expect(game.room.history.facts(Damage.dealt)).toHaveLength(0);
  },
);

it.each(['zero', 'prevented'])('来源阶段已经 %s 不开放伤害替代', async (kind) => {
  const game = create('ice_sword', 2);
  game.room.on(Damage.causing, {
    id: 'stop',
    owner: null,
    eligible: () => true,
    run: (_ctx, draft) => (kind === 'zero' ? draft.setAmount(0, 'probe') : draft.prevent('probe')),
  });
  let replacing = 0;
  game.room.on(Damage.replacing, {
    id: 'replace',
    owner: null,
    eligible: () => true,
    run: () => {
      replacing++;
    },
  });
  await use(game, strike);
  expect(replacing).toBe(0);
  expect(game.room.world.zone('b:hand').cards).toHaveLength(2);
  expect(game.room.world.player('b').hp).toBe(4);
});

it('寒冰发动支付后出现其他防止时不覆盖原因，也不继续弃牌', async () => {
  const game = create('ice_sword', 2);
  let draft: DamageDraft;
  game.room.on(Damage.replacing, {
    id: 'capture',
    owner: null,
    eligible: () => true,
    run: (_ctx, value) => {
      draft = value;
    },
  });
  game.room.on(Cost.paid, {
    id: 'prevent',
    owner: null,
    eligible: (_ctx, paid) => paid.skill === 'standard:ice_sword-ability',
    run: () => draft.prevent('other'),
  });
  const running = use(game, strike);
  await chooseFirst(game);
  await running;
  expect(game.room.history.facts(Damage.prevented)).toMatchObject([
    { data: { detail: { prevention: 'other' } } },
  ]);
  expect(game.room.history.facts(Discard.committed)).toHaveLength(0);
});

it('寒冰首牌宣告后离区或受保护不追取，武器离场仍执行已宣告弃牌', async () => {
  for (const branch of ['moved', 'protected', 'weapon'] as const) {
    let protectedCard = false;
    const lock = defineSkill({
      id: 'test:protect-first',
      name: '保护',
      triggers: [],
      modifiers: [
        modify(
          cardQueries.prohibitDiscard,
          (_ctx, { input }) => protectedCard && input.card === 'b0',
        ),
      ],
    });
    const game = cardGame({
      hands: { a: [card('s', 'slash', 'heart')], b: [card('b0', 'peach')] },
      equipment: { a: [card('weapon', 'ice_sword')] },
      skills: [lock],
    });
    await game.room.run('grant', (ctx) =>
      game.skills.grant(ctx, {
        owner: 'b',
        skill: lock.id,
        source: { kind: 'general', id: 'test' },
      }),
    );
    game.room.on(Cost.paid, {
      id: 'after-first-choice',
      owner: null,
      eligible: (_ctx, receipt) => receipt.skill === 'standard:ice_sword-ability',
      async run(ctx) {
        if (branch === 'protected') protectedCard = true;
        else {
          const [card, from] = branch === 'weapon' ? ['weapon', 'a:equipment'] : ['b0', 'b:hand'];
          await moveCards(ctx, [{ cards: [card], from, to: 'c:hand', place: 'bottom' }], 'probe');
        }
      },
    });
    const running = use(game, strike);
    await chooseFirst(game);
    await running;
    expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
    expect(game.room.history.facts(Discard.committed)).toHaveLength(branch === 'weapon' ? 1 : 0);
    expect(game.room.history.facts(Damage.dealt)).toEqual([]);
    expect(game.room.history.facts(Damage.prevented)).toHaveLength(1);
    expect(game.room.world.player('b').hp).toBe(4);
    expect(game.room.decisions.pending).toEqual([]);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  }
});
