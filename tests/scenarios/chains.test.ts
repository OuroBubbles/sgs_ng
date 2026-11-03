import { playMatch } from '../fixtures/match';
import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import {
  chainChanged,
  damage,
  damageCausing,
  damageInflicting,
  damageReceived,
  damageSettled,
  dyingStarted,
  isChained,
  isDirectDamage,
  kill,
  recover,
  setChained,
  defineSkill,
  viewAs,
  ownedCards,
  runTurn,
  defaultPhaseBody,
  finishGame,
  equipmentCard,
  equipmentEffectiveFor,
  on,
  CardBook,
  SkillBook,
  resolveAttack,
} from '../../src/sdk';
import type { Context, DamageInput, DamageResult, CardDefinition } from '../../src/sdk';
import { card, cardGame } from '../fixtures/cards';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { standardGeneralSkills } from '../../src/content/standard/generals';
import { luoyiAftereffect } from '../../src/content/standard/wei';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { practiceContent } from '../../src/app/offline/practice';

type Game = ReturnType<typeof cardGame>;
const hit = { from: 'a', to: 'b', amount: 2, nature: 'fire' } as const;
async function link(game: Game, players = ['b', 'c', 'd']) {
  await game.room.run('setup-chain', async (ctx) => {
    for (const player of players) await setChained(ctx, player, true, 'setup');
  });
}
function results(game: Game) {
  return game.room.history.facts('damage.dealt').map((fact) => fact.data.detail as DamageResult);
}
function rebuilt(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.decisions.pending).toEqual([]);
}

it('连环是公开权威状态，实际变化才提交并开放只读窗口', async () => {
  const game = cardGame();
  const changed: boolean[] = [];
  game.room.on(chainChanged, {
    id: 'changed',
    owner: 'a',
    eligible: () => true,
    run(ctx, event) {
      expect(Object.isFrozen(event)).toBe(true);
      expect(isChained(ctx.world, event.player)).toBe(event.after);
      changed.push(event.after);
    },
  });
  await game.room.run('change', async (ctx) => {
    expect(isChained(ctx.world, 'b')).toBe(false);
    expect((await setChained(ctx, 'b', true, 'bind')).kind).toBe('changed');
    expect((await setChained(ctx, 'b', true, 'same')).kind).toBe('unchanged');
    expect((await setChained(ctx, 'b', false, 'reset')).kind).toBe('changed');
  });
  expect(changed).toEqual([true, false]);
  expect(game.room.history.facts('chain.changed')).toHaveLength(2);
  rebuilt(game);
});

it.each(['normal', 'fire', 'thunder'])(
  '%s 按属性决定是否解除连环并传播，子伤害保留明确来源',
  async (nature) => {
    const game = cardGame();
    await link(game);
    const root = await game.room.run('hit', (ctx) => damage(ctx, { ...hit, nature }));
    expect(root.kind).toBe('resolved');
    const dealt = results(game);
    expect(dealt.map((result) => result.input.to)).toEqual(
      nature === 'normal' ? ['b'] : ['b', 'c', 'd'],
    );
    expect(dealt[0]).toMatchObject({
      amount: 2,
      hpLoss: 2,
      chainPlan: nature === 'normal' ? [] : ['c', 'd'],
    });
    expect(isChained(game.room.world, 'b')).toBe(nature === 'normal');
    for (const child of dealt.slice(1)) {
      expect(child.input.origin).toEqual({ kind: 'chain', damage: dealt[0]!.id });
      expect(child.unchained).toBe(true);
      expect(child.chainPlan).toEqual([]);
      expect(isDirectDamage(child.input)).toBe(false);
    }
    expect(new Set(dealt.map((result) => result.id)).size).toBe(dealt.length);
    expect(Object.isFrozen(dealt[0]!.chainPlan)).toBe(true);
    rebuilt(game);
  },
);

it.each([
  { nature: 'workshop:ice', conducts: undefined, spread: false },
  { nature: 'workshop:ice', conducts: true, spread: true },
  { nature: 'fire', conducts: false, spread: false },
  { nature: 'normal', conducts: true, spread: true },
])(
  '属性 $nature 的 conducts=$conducts 可由普通规则代码明确指定',
  async ({ nature, conducts, spread }) => {
    const game = cardGame();
    await link(game);
    await game.room.run('hit', (ctx) =>
      damage(ctx, { ...hit, nature, ...(conducts === undefined ? {} : { conducts }) }),
    );
    expect(results(game)).toHaveLength(spread ? 3 : 1);
    expect(isChained(game.room.world, 'b')).toBe(!spread);
    rebuilt(game);
  },
);

it('传播以起点最终伤害为基数，每个目标独立防御，不污染其他草案或来源快照', async () => {
  const game = cardGame();
  await link(game);
  game.room.on(damageCausing, {
    id: 'source',
    owner: 'a',
    eligible: (_ctx, draft) => isDirectDamage(draft.input),
    run(_ctx, draft) {
      draft.adjust(1, 'source');
    },
  });
  game.room.on(damageInflicting, {
    id: 'defense',
    owner: 'b',
    eligible: () => true,
    run(_ctx, draft) {
      if (draft.input.to === 'b') draft.setAmount(1, 'cap');
      if (draft.input.to === 'c') draft.adjust(1, 'vulnerable');
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  const dealt = results(game);
  expect(dealt.map((result) => result.amount)).toEqual([1, 2, 1]);
  expect(dealt.map((result) => result.sourceSnapshot.amount)).toEqual([3, 1, 1]);
  expect(dealt.map((result) => result.input.amount)).toEqual([2, 1, 1]);
  expect(dealt.map((result) => result.afterHp)).toEqual([3, 2, 3]);
  rebuilt(game);
});

it.each(['prevent', 'zero'])('起点 %s 时不解链、不传播，仍正常收束', async (kind) => {
  const game = cardGame();
  await link(game);
  game.room.on(damageInflicting, {
    id: 'prevent',
    owner: 'b',
    eligible: () => true,
    run(_ctx, draft) {
      if (kind === 'prevent') draft.prevent('immune');
      else draft.setAmount(0, 'reduced');
    },
  });
  await game.room.run('hit', async (ctx) => {
    const result = await damage(ctx, hit);
    expect(result.kind).toBe(kind === 'prevent' ? 'prevented' : 'zero');
    expect(result.chainPlan).toEqual([]);
    expect(result.unchained).toBe(false);
  });
  expect(results(game)).toEqual([]);
  expect(['b', 'c', 'd'].every((player) => isChained(game.room.world, player))).toBe(true);
  rebuilt(game);
});

it('传播中的防止只影响该名角色，它保留连环，后续角色继续结算', async () => {
  const game = cardGame();
  await link(game);
  game.room.on(damageInflicting, {
    id: 'prevent-c',
    owner: 'c',
    eligible: (_ctx, draft) => draft.input.to === 'c',
    run(_ctx, draft) {
      draft.prevent('immune');
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(results(game).map((result) => result.input.to)).toEqual(['b', 'd']);
  expect(isChained(game.room.world, 'c')).toBe(true);
  expect(game.room.history.facts('damage.prevented')).toHaveLength(1);
  rebuilt(game);
});

it.each(['unlink', 'kill'])(
  '计划固定，起点后效新增连环不加入，已有角色 %s 后跳过',
  async (kind) => {
    const game = cardGame();
    await link(game);
    game.room.on(damageReceived, {
      id: 'change-plan',
      owner: 'b',
      eligible: (_ctx, result) => result.input.to === 'b',
      async run(ctx) {
        await setChained(ctx, 'a', true, 'new');
        if (kind === 'unlink') await setChained(ctx, 'd', false, 'reset');
        else
          await kill(ctx, {
            player: 'd',
            killer: null,
            reason: 'rule',
            cause: { kind: 'rule', seq: null, data: null },
          });
      },
    });
    await game.room.run('hit', (ctx) => damage(ctx, hit));
    expect(results(game).map((result) => result.input.to)).toEqual(['b', 'c']);
    expect(results(game)[0]!.chainPlan).toEqual(['c', 'd']);
    expect(game.room.world.player('a').hp).toBe(4);
    expect(isChained(game.room.world, 'a')).toBe(true);
    rebuilt(game);
  },
);

it('传播顺序在提交时按模式冻结，包含来源本人，不随后效改变行动起点', async () => {
  let anchor = 'c';
  const game = cardGame({ actionAnchor: () => anchor });
  await link(game, ['a', 'b', 'c', 'd']);
  game.room.on(damageReceived, {
    id: 'anchor',
    owner: 'b',
    eligible: (_ctx, result) => result.input.to === 'b',
    run() {
      anchor = 'a';
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(results(game)[0]!.chainPlan).toEqual(['c', 'd', 'a']);
  expect(results(game).map((result) => result.input.to)).toEqual(['b', 'c', 'd', 'a']);
  rebuilt(game);
});

it('起点收束与各传播子流程完整结束后 damage 才返回', async () => {
  const game = cardGame();
  await link(game);
  const order: string[] = [];
  game.room.on(damageSettled, {
    id: 'settled',
    owner: 'a',
    eligible: () => true,
    run(_ctx, result) {
      order.push(result.input.to);
    },
  });
  await game.room.run('hit', async (ctx) => {
    await damage(ctx, hit);
    order.push('returned');
  });
  expect(order).toEqual(['b', 'c', 'd', 'returned']);
  rebuilt(game);
});

it('嵌套新起点独立传播，外层计划重查已解除状态，不重复击中', async () => {
  const game = cardGame();
  await link(game);
  game.room.on(damageReceived, {
    id: 'nested',
    owner: 'b',
    eligible: (_ctx, result) => result.input.to === 'b',
    async run(ctx) {
      await damage(ctx, { ...hit, to: 'c', amount: 1 });
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  const dealt = results(game);
  expect(dealt.map((result) => result.input.to)).toEqual(['b', 'c', 'd']);
  expect(dealt[1]!.input.origin).toBeUndefined();
  expect(dealt[2]!.input.origin?.damage).toBe(dealt[1]!.id);
  rebuilt(game);
});

it('濒死子流程先于传播，回复后继续，事实中的伤害与当前体力各自准确', async () => {
  const game = cardGame();
  await link(game);
  const order: string[] = [];
  game.room.on(dyingStarted, {
    id: 'save',
    owner: 'a',
    eligible: (_ctx, event) => event.player === 'b',
    async run(ctx) {
      order.push('dying');
      expect(isChained(ctx.world, 'b')).toBe(false);
      await recover(ctx, { from: 'a', to: 'b', amount: 2 });
      order.push('saved');
    },
  });
  game.room.on(damageCausing, {
    id: 'chain-start',
    owner: 'a',
    eligible: (_ctx, draft) => !isDirectDamage(draft.input),
    run(_ctx, draft) {
      order.push(draft.input.to);
    },
  });
  await game.room.run('hit', async (ctx) => {
    ctx.commit('setup.hp', [{ kind: 'vitality', player: 'b', hp: 1 }], null);
    await damage(ctx, hit);
  });
  expect(order).toEqual(['dying', 'saved', 'c', 'd']);
  expect(results(game)[0]!.afterHp).toBe(-1);
  expect(game.room.world.player('b')).toMatchObject({ hp: 1, alive: true });
  rebuilt(game);
});

it('来源在起点后效死亡，已经产生的传播仍保留来源身份', async () => {
  const game = cardGame();
  await link(game);
  game.room.on(damageReceived, {
    id: 'source-dies',
    owner: 'b',
    eligible: (_ctx, result) => result.input.to === 'b',
    async run(ctx) {
      await kill(ctx, {
        player: 'a',
        killer: null,
        reason: 'rule',
        cause: { kind: 'rule', seq: null, data: null },
      });
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(results(game).map((result) => result.input.from)).toEqual(['a', 'a', 'a']);
  rebuilt(game);
});

it('纯查询不能改变连环，关闭 Context 也不能继续调用状态操作', async () => {
  const game = cardGame();
  let closed: Context;
  await game.room.run('query', (ctx) => {
    closed = ctx;
    expect(() => ctx.query(() => setChained(ctx, 'b', true, 'invalid'))).toThrow('Pure queries');
  });
  expect(() => setChained(closed!, 'b', true, 'closed')).toThrow();
  expect(isChained(game.room.world, 'b')).toBe(false);
  rebuilt(game);
});

it('终局确定后保留起点事实与计划，但不再执行后续传播', async () => {
  const game = cardGame();
  await link(game);
  game.room.on(damageReceived, {
    id: 'end',
    owner: 'b',
    eligible: (_ctx, result) => result.input.to === 'b',
    async run(ctx) {
      await finishGame(ctx, { winners: ['a'], reason: 'rule' });
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(results(game)).toHaveLength(1);
  expect(results(game)[0]!.chainPlan).toEqual(['c', 'd']);
  expect(game.room.world.player('c').hp).toBe(4);
  expect(isChained(game.room.world, 'c')).toBe(true);
  rebuilt(game);
});

it('起点死亡不丢失已提交的传播计划，死亡善后结束后才继续', async () => {
  const game = cardGame();
  await link(game);
  await game.room.run('hit', async (ctx) => {
    ctx.commit('setup.hp', [{ kind: 'vitality', player: 'b', hp: 1 }], null);
    await damage(ctx, hit);
  });
  expect(game.room.world.player('b').alive).toBe(false);
  expect(results(game).map((result) => result.input.to)).toEqual(['b', 'c', 'd']);
  const facts = game.room.history.facts();
  expect(facts.findIndex((fact) => fact.data.kind === 'player.buried')).toBeLessThan(
    facts.findIndex(
      (fact) =>
        fact.data.kind === 'damage.dealt' && (fact.data.detail as DamageResult).input.to === 'c',
    ),
  );
  rebuilt(game);
});

const flame = defineSkill({
  id: 'probe:flame',
  name: '火策',
  triggers: [],
  viewAs: [
    viewAs({
      id: 'fire',
      label: '火杀',
      names: () => ['standard:slash'],
      count: { min: 1, max: 1 },
      materials: (ctx, { self }) =>
        ownedCards(ctx.world, self.owner).filter(
          (id) => ctx.world.card(id).name === 'standard:slash',
        ),
      make: () => ({ name: 'standard:slash', nature: 'fire' }),
    }),
  ],
});
const grantSource = { kind: 'general', id: 'probe' } as const;
function fireGame(options: Parameters<typeof cardGame>[0] = {}) {
  return cardGame({
    ...options,
    hands: { a: [card('spark', 'slash', 'heart')], ...options.hands },
    skills: [...standardGeneralSkills, flame],
    effects: [luoyiAftereffect],
  });
}
async function grantFire(game: Game) {
  await game.room.run('grant-fire', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: flame.id, source: grantSource }),
  );
}
function fireSlash(game: Game, ctx: Context) {
  const instance = ctx.world.snapshot.skills.find(
    (skill) => skill.owner === 'a' && skill.skill === flame.id,
  )!.id;
  return game.book.use(ctx, {
    actor: 'a',
    choice: { kind: 'viewAs', instance, recipe: 'fire', materials: ['spark'] },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
}
async function answerOptional(
  game: Game,
  running: Promise<unknown>,
  accepted: readonly string[] = [],
) {
  let done = false;
  running.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  const asked: string[] = [];
  for (let step = 0; step < 500 && !done; step++) {
    await setImmediate();
    const request = game.room.decisions.pending[0];
    if (!request) continue;
    const skill = (request.data as { skill?: string }).skill ?? request.kind;
    asked.push(skill);
    expect(request.kind === 'invoke' || request.optional).toBe(true);
    const reply =
      request.kind === 'invoke'
        ? game.room.decisions.submit(request.id, request.token, accepted.includes(skill))
        : game.room.decisions.cancel(request.id, request.token);
    expect(reply.kind).toBe('accepted');
  }
  expect(done).toBe(true);
  await running;
  return asked;
}

it('真实转换火杀的裸衣只在直接伤害增伤，传播不再次叠加', async () => {
  const game = fireGame({ draw: [card('draw-1', 'jink'), card('draw-2', 'jink')] });
  await grantFire(game);
  await link(game);
  await game.room.run('luoyi', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: 'standard:luoyi', source: grantSource }),
  );
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['draw', 'play'],
      body: async (at, phase) => {
        if (phase.kind === 'draw') return defaultPhaseBody(at, phase, game.book);
        expect((await fireSlash(game, at)).kind).toBe('used');
      },
    }),
  );
  expect(await answerOptional(game, running, ['standard:luoyi'])).toEqual(['standard:luoyi']);
  expect(results(game).map((result) => result.amount)).toEqual([2, 2, 2]);
  expect(results(game).map((result) => result.edits.length)).toEqual([1, 0, 0]);
  expect(game.room.world.position('spark')).toBe('discard');
  rebuilt(game);
});

it.each(['kylin_bow', 'ice_sword'])('真实火杀的 %s 不因传播对其他角色重复发动', async (weapon) => {
  const game = fireGame({
    hands: { c: [card('c-jink', 'jink'), card('c-peach', 'peach')] },
    equipment: { a: [card('weapon', weapon)], c: [card('horse', 'jueying')] },
  });
  await grantFire(game);
  await link(game, ['b', 'c']);
  const running = game.room.run('fire', (ctx) => fireSlash(game, ctx));
  expect(await answerOptional(game, running)).toEqual([]);
  expect(results(game).map((result) => result.amount)).toEqual([1, 1]);
  expect(game.room.world.position('horse')).toBe('c:equipment');
  expect(game.room.world.zone('c:hand').cards).toHaveLength(2);
  rebuilt(game);
});

it('青釭剑的原效果忽略防具不传给连环角色，每个目标按自己的防具限伤', async () => {
  const cap = equipmentCard({
    id: 'probe:cap',
    label: '限伤甲',
    slot: 'armor',
    skill: defineSkill({
      id: 'probe:cap-skill',
      name: '限伤',
      triggers: [
        on(damageInflicting, {
          id: 'cap',
          when: (ctx, { payload: draft, self }) =>
            draft.input.to === self.owner &&
            draft.input.card !== undefined &&
            equipmentEffectiveFor(ctx.world, self, draft.input.card, 'armor'),
          run(_ctx, { payload: draft }) {
            draft.setAmount(Math.min(1, draft.amount), 'cap');
          },
        }),
      ],
    }),
  });
  const game = fireGame({
    definitions: [cap],
    equipment: {
      a: [card('weapon', 'qinggang_sword')],
      b: [{ ...card('cap-b', 'slash'), name: cap.id }],
      c: [{ ...card('cap-c', 'slash'), name: cap.id }],
    },
  });
  await grantFire(game);
  await link(game);
  game.room.on(damageCausing, {
    id: 'plus',
    owner: 'a',
    eligible: (_ctx, draft) => isDirectDamage(draft.input),
    run(_ctx, draft) {
      draft.adjust(1, 'plus');
    },
  });
  await game.room.run('fire', (ctx) => fireSlash(game, ctx));
  expect(results(game).map((result) => result.amount)).toEqual([2, 1, 2]);
  expect(results(game)[1]!.input.card!.target).toBe('b');
  expect(results(game)[1]!.input.to).toBe('c');
  rebuilt(game);
});

it('传播保留原牌材料关联，曹操仍可奸雄取得处理区材料且不重复弃置', async () => {
  const game = fireGame();
  await grantFire(game);
  await link(game, ['b', 'c']);
  await game.room.run('jianxiong', (ctx) =>
    game.skills.grant(ctx, { owner: 'c', skill: 'standard:jianxiong', source: grantSource }),
  );
  const running = game.room.run('fire', (ctx) => fireSlash(game, ctx));
  expect(await answerOptional(game, running, ['standard:jianxiong'])).toEqual([
    'standard:jianxiong',
  ]);
  expect(game.room.world.position('spark')).toBe('c:hand');
  expect(results(game)[1]!.input.card!.card.materials).toEqual(['spark']);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  rebuilt(game);
});

it('作者包种子 4 自然起手缚阵与引焰，两次真实用牌造成连环伤害并清理材料', async () => {
  const content = practiceContent;
  const match = createOfflineMatch({
    seed: 4,
    preset: 'workshop:chains',
    lineup: ['standard:guanyu', 'standard:guanyu'],
    content,
  });
  await match.prepare();
  expect(match.progress?.next).toBe('甲席');
  for (const id of ['chain-card-7', 'chain-card-19'])
    expect(match.room.world.position(id)).toBe('甲席:hand');
  const before = match.room.world.snapshot.players.map((player) => player.hp);
  await match.room.run('chain-content', async (ctx) => {
    for (const [id, targets] of [
      ['chain-card-7', ['甲席', '乙席']],
      ['chain-card-19', ['乙席']],
    ] as const) {
      expect(
        (
          await match.book.use(ctx, {
            actor: '甲席',
            choice: { kind: 'physical', card: id },
            targets,
            timing: { kind: 'effect' },
          })
        ).kind,
      ).toBe('used');
    }
  });
  expect(match.room.world.snapshot.players.map((player) => player.hp)).toEqual(
    before.map((hp) => hp - 1),
  );
  expect(
    match.room.history
      .facts('damage.dealt')
      .map((fact) => (fact.data.detail as DamageResult).input.to),
  ).toEqual(['乙席', '甲席']);
  for (const id of ['chain-card-7', 'chain-card-19'])
    expect(match.room.world.position(id)).toBe('discard');
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('test complete');
});

it.each([4, 17])(
  '连环演练四人局由基础 AI 经真实选择至胜负，seed=%s',
  async (seed) => {
    const content = practiceContent;
    const match = createOfflineMatch({
      seed,
      preset: 'workshop:chains',
      lineup: ['standard:guanyu', 'standard:huanggai', 'standard:guojia', 'standard:caocao'],
      content,
    });
    await playMatch(match, { steps: 15000, decisions: 2400 });
    expect(match.room.history.facts('chain.changed').length).toBeGreaterThan(0);
    expect(
      match.room.history
        .facts('damage.dealt')
        .some((fact) => (fact.data.detail as DamageResult).input.origin?.kind === 'chain'),
    ).toBe(true);
    expect(match.initial.cards).toHaveLength(48);
  },
  30_000,
);

it.each([
  { nature: '' },
  { nature: '  ' },
  { conducts: 'yes' },
  { origin: { kind: 'chain', damage: '' } },
  { origin: { kind: 'chain', damage: 2 } },
  { origin: { kind: 'unknown', damage: 'id' } },
])('非法伤害属性或来源在提交前报错：%j', async (extra) => {
  const game = cardGame();
  await expect(
    game.room.run('invalid', (ctx) => damage(ctx, { ...hit, ...extra } as DamageInput)),
  ).rejects.toThrow('Invalid damage nature or origin');
  expect(game.room.history.facts()).toEqual([]);
  rebuilt(game);
});

it.each(['workshop:ice', '', '  '])(
  '具名属性 %j 在定义与转换牌面中统一校验，错误不支付材料',
  async (nature) => {
    const definition = { id: 'probe:nature', label: '属性牌', type: 'basic' as const, nature };
    if (!nature.trim())
      expect(() => new CardBook([definition], new SkillBook())).toThrow('nonempty string');
    else
      expect(new CardBook([definition], new SkillBook()).definition(definition.id).nature).toBe(
        nature,
      );
    const conversion = defineSkill({
      id: 'probe:nature',
      name: '属性转换',
      triggers: [],
      viewAs: [
        viewAs({
          id: 'nature',
          label: '转换',
          names: () => ['standard:slash'],
          count: { min: 1, max: 1 },
          materials: (ctx, { self }) => ownedCards(ctx.world, self.owner),
          make: () => ({ name: 'standard:slash', nature }),
        }),
      ],
    });
    const game = cardGame({ skills: [conversion] });
    await game.room.run('build', async (ctx) => {
      const change = await game.skills.grant(ctx, {
        owner: 'a',
        skill: conversion.id,
        source: grantSource,
      });
      const built = game.book.build(
        ctx,
        'a',
        { kind: 'viewAs', instance: change.after!.id, recipe: 'nature', materials: ['slash1'] },
        'use',
      );
      expect(built.ok).toBe(Boolean(nature.trim()));
      if (built.ok) expect(built.value.nature).toBe(nature);
    });
    expect(game.room.world.position('slash1')).toBe('a:hand');
    expect(game.room.history.facts('cost.paid')).toEqual([]);
    rebuilt(game);
  },
);

it('自定义属性攻击复用完整闪/突破流程，仅用普通伤害函数决定是否传导', async () => {
  const ice: CardDefinition = {
    id: 'probe:ice-attack',
    label: '冰袭',
    type: 'basic',
    nature: 'workshop:ice',
    use: {
      count: { min: 1, max: 1 },
      target: () => true,
      resolve: async (ctx, { effect, book }) => {
        await resolveAttack(
          ctx,
          effect,
          book,
          { name: 'standard:jink', purpose: 'response' },
          (at, hit) =>
            damage(at, {
              from: hit.actor,
              to: hit.target,
              amount: 1,
              nature: hit.card.nature,
              card: hit,
              conducts: true,
            }),
        );
      },
    },
  };
  const game = cardGame({
    definitions: [ice],
    hands: { a: [{ ...card('ice', 'slash'), name: ice.id }] },
  });
  await link(game, ['b', 'c']);
  await game.room.run('ice', (ctx) =>
    game.book.use(ctx, {
      actor: 'a',
      choice: { kind: 'physical', card: 'ice' },
      targets: ['b'],
      timing: { kind: 'effect' },
    }),
  );
  expect(results(game).map((result) => result.amount)).toEqual([1, 1]);
  expect(results(game).every((result) => result.input.nature === 'workshop:ice')).toBe(true);
  expect(game.room.history.facts('attack.finished')).toHaveLength(1);
  expect(game.room.world.position('ice')).toBe('discard');
  rebuilt(game);
});
