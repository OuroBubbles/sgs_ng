import { expect, it } from 'vitest';
import {
  cardQueries,
  defaultPhaseBody,
  defineSkill,
  finishGame,
  kill,
  moveCards,
  modify,
  runPhase,
  useDeclarations,
  Use,
  Target,
  Resolve,
  Damage,
} from '../../src/sdk';
import type {
  CardDefinition,
  CardEffect,
  Context,
  TargetStage,
  UseIntent,
  UsePlanView,
} from '../../src/sdk';
import { standardGeneralSkills } from '../../src/content/standard/generals';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';

type Game = ReturnType<typeof cardGame>;
const stages = [
  ['specifying', Target.specifying],
  ['confirming', Target.confirming],
  ['specified', Target.specified],
  ['confirmed', Target.confirmed],
] as const;
const cause = { kind: 'rule', seq: null, data: null } as const;
const source = { kind: 'general', id: 'probe' } as const;
const probe: CardDefinition = {
  id: 'test:layers',
  type: 'trick',
  label: '目标时点探针',
  use: {
    count: { min: 1, max: 3 },
    target: (_ctx, { request, target }) => target !== request.actor,
    resolve: () => {},
  },
};
function scenario(definition: CardDefinition = probe) {
  return cardGame({ definitions: [definition], hands: { a: [] } });
}
function intent(targets = ['b'], actor = 'a'): UseIntent {
  return {
    actor,
    targets,
    timing: { kind: 'effect' },
    choice: { kind: 'generated', face: { name: probe.id }, materials: [], reason: 'test' },
  };
}
const slash = (targets = ['b']): UseIntent => ({
  actor: 'a',
  targets,
  timing: { kind: 'effect', ignoreDistance: true },
  choice: { kind: 'physical', card: 'slash' },
});
function trace(game: Game, log: string[]) {
  for (const [stage, window] of stages)
    game.room.on(window, {
      id: `trace:${stage}`,
      owner: null,
      eligible: () => true,
      run(_ctx, { effect }) {
        log.push(`${stage}:${effect.target}`);
      },
    });
}
function replay(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(useDeclarations(game.room.world)).toEqual([]);
  expect(game.room.world.snapshot.zones.filter((z) => z.kind === 'processing')).toEqual([]);
  expect(game.room.decisions.pending).toEqual([]);
}
async function answer(game: Game, value: unknown, kind = 'invoke') {
  const request = await nextRequest(game.room);
  expect(request.kind).toBe(kind);
  expect(game.room.decisions.submit(request.id, request.token, value)).toEqual({
    kind: 'accepted',
  });
}
function targetFacts(game: Game) {
  return game.room.history.facts('card.targeting').map(
    (f) =>
      f.data.detail as {
        effectId: string;
        stage: TargetStage;
        target: string;
      },
  );
}

it('四个目标时点分别按来源座次遍历，全部结束后才进入牌体与实际效果', async () => {
  const log: string[] = [];
  const game = scenario({
    ...probe,
    use: {
      ...probe.use!,
      async execute(ctx, { use: plan, resolveTargets: resolve }) {
        log.push('body');
        expect(
          plan.effects.every((e) => e.state === 'ready' && e.targetStage === 'confirmed'),
        ).toBe(true);
        await resolve(ctx, (_at, { effect }) => {
          log.push(`effect:${effect.target}`);
        });
      },
    },
  });
  trace(game, log);
  const result = await use(game, intent(['b', 'd', 'a'], 'c'));
  expect(result).toMatchObject({
    value: {
      kind: 'used',
      use: {
        effects: [
          { target: 'd', state: 'resolved' },
          { target: 'a', state: 'resolved' },
          { target: 'b', state: 'resolved' },
        ],
      },
    },
  });
  expect(log).toEqual([
    ...stages.flatMap(([stage]) => ['d', 'a', 'b'].map((t) => `${stage}:${t}`)),
    'body',
    'effect:d',
    'effect:a',
    'effect:b',
  ]);
  replay(game);
});

it('指定前后以来源为技能行动序起点，确认前后以目标为起点', async () => {
  const game = scenario();
  const order: Record<string, string[]> = {};
  for (const [stage, window] of stages) {
    order[stage] = [];
    for (const owner of ['a', 'b', 'c', 'd'])
      game.room.on(window, {
        id: `${stage}:${owner}`,
        owner,
        eligible: () => true,
        run() {
          order[stage]!.push(owner);
        },
      });
  }
  await use(game, intent(['c'], 'b'));
  expect(order).toEqual({
    specifying: ['b', 'c', 'd', 'a'],
    confirming: ['c', 'd', 'a', 'b'],
    specified: ['b', 'c', 'd', 'a'],
    confirmed: ['c', 'd', 'a', 'b'],
  });
  replay(game);
});

it.each(stages)('在 %s 追加目标只补齐新身份，旧身份不重复进入时点', async (stage, window) => {
  const game = scenario();
  game.room.on(window, {
    id: 'append',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    run(ctx, { use: plan }) {
      plan.addTarget(ctx, 'c', 'test:append');
    },
  });
  await use(game, intent());
  const facts = targetFacts(game);
  for (const target of ['b', 'c'])
    expect(facts.filter((f) => f.target === target).map((f) => f.stage)).toEqual(
      stages.map(([s]) => s),
    );
  expect(facts.findIndex((f) => f.stage === stage && f.target === 'b')).toBeLessThan(
    facts.findIndex((f) => f.target === 'c'),
  );
  expect(game.room.history.facts('card.effect')).toHaveLength(2);
  replay(game);
});

it.each(stages)('在 %s 转移目标封闭旧身份，新身份重新完成四个时点', async (stage, window) => {
  const game = scenario();
  game.room.on(window, {
    id: 'replace',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    run(ctx, { use: plan, effect }) {
      plan.replaceTarget(ctx, effect.effectId, 'c', 'test:replace');
    },
  });
  const result = await use(game, intent());
  expect(result).toMatchObject({
    value: {
      use: {
        effects: [
          { target: 'b', state: 'cancelled', targetStage: stage },
          { target: 'c', state: 'resolved', targetStage: 'confirmed' },
        ],
      },
    },
  });
  const facts = targetFacts(game);
  expect(facts.filter((f) => f.target === 'b').map((f) => f.stage)).toEqual(
    stages.slice(0, stages.findIndex(([s]) => s === stage) + 1).map(([s]) => s),
  );
  expect(facts.filter((f) => f.target === 'c').map((f) => f.stage)).toEqual(stages.map(([s]) => s));
  expect(new Set(facts.map((f) => f.effectId)).size).toBe(2);
  replay(game);
});

it('补入较早座次不倒退已访问目标，各层仍各自排序', async () => {
  const game = scenario();
  game.room.on(Target.confirming, {
    id: 'earlier',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'c',
    run(ctx, { use: plan }) {
      plan.addTarget(ctx, 'b', 'test:earlier');
    },
  });
  await use(game, intent(['c', 'd']));
  expect(targetFacts(game).map((f) => `${f.stage}:${f.target}`)).toEqual([
    'specifying:c',
    'specifying:d',
    'confirming:c',
    'specifying:b',
    'confirming:b',
    'confirming:d',
    'specified:b',
    'specified:c',
    'specified:d',
    'confirmed:b',
    'confirmed:c',
    'confirmed:d',
  ]);
  expect(
    game.room.history.facts('card.effect').map((f) => (f.data.detail as { target: string }).target),
  ).toEqual(['b', 'c', 'd']);
  replay(game);
});

it('牌体追加的目标在实际效果前补齐四层，原目标不重开', async () => {
  const log: string[] = [];
  const game = scenario({
    ...probe,
    use: {
      ...probe.use!,
      async execute(ctx, { use: plan, resolveTargets: resolve }) {
        log.push('body');
        plan.addTarget(ctx, 'c', 'test:body');
        await resolve(ctx, (_at, { effect }) => {
          log.push(`effect:${effect.target}`);
        });
      },
    },
  });
  trace(game, log);
  await use(game, intent());
  expect(log).toEqual([
    ...stages.map(([s]) => `${s}:b`),
    'body',
    ...stages.map(([s]) => `${s}:c`),
    'effect:b',
    'effect:c',
  ]);
  replay(game);
});

it('生效前窗口补入较早目标，先补齐时点但不抢占当前生效身份', async () => {
  const log: string[] = [];
  const game = scenario({
    ...probe,
    use: {
      ...probe.use!,
      resolve(_ctx, { effect }) {
        log.push(`effect:${effect.target}`);
      },
    },
  });
  trace(game, log);
  game.room.on(Resolve.starting, {
    id: 'append',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'c',
    run(ctx, { use: plan }) {
      log.push('starting:c');
      plan.addTarget(ctx, 'b', 'test:start');
    },
  });
  await use(game, intent(['c']));
  expect(log).toEqual([
    ...stages.map(([s]) => `${s}:c`),
    'starting:c',
    ...stages.map(([s]) => `${s}:b`),
    'effect:c',
    'effect:b',
  ]);
  replay(game);
});

it.each(['resolver', 'aftereffect'] as const)(
  '%s 重复前席目标，宣告顺序稳定而后续实际效果按座次执行',
  async (point) => {
    const log: string[] = [];
    let plan: UsePlanView;
    let repeated = false;
    function append(ctx: Context, effect: { target: string }) {
      if (effect.target !== 'b' || repeated) return;
      repeated = true;
      plan.repeatTarget(ctx, 'b', 'test:repeat');
    }
    const game = scenario({
      ...probe,
      use: {
        ...probe.use!,
        resolve(ctx, { effect }) {
          log.push(`effect:${effect.target}`);
          if (point === 'resolver') append(ctx, effect);
        },
      },
    });
    trace(game, log);
    game.room.on(Use.declared, {
      id: 'retain',
      owner: null,
      eligible: () => true,
      run(_ctx, use) {
        plan = use;
      },
    });
    if (point === 'aftereffect')
      game.room.on(Resolve.finished, {
        id: 'append',
        owner: null,
        eligible: () => true,
        run(ctx, { effect }) {
          append(ctx, effect);
        },
      });
    const result = await use(game, intent(['b', 'c']));
    expect(result).toMatchObject({
      value: { use: { effects: [{ target: 'b' }, { target: 'c' }, { target: 'b' }] } },
    });
    const actual = game.room.history
      .facts('card.effect')
      .map((f) => f.data.detail as { effectId: string; target: string });
    expect(actual.map((e) => e.effectId.split(':').at(-1))).toEqual(['1', '3', '2']);
    expect(log).toEqual([
      ...stages.flatMap(([s]) => [`${s}:b`, `${s}:c`]),
      'effect:b',
      ...stages.map(([s]) => `${s}:b`),
      'effect:b',
      'effect:c',
    ]);
    replay(game);
  },
);

it('后席目标确认后可以取消已准备的前席效果，取消身份仍记录一次完成', async () => {
  const game = scenario();
  let earlier: CardEffect;
  const started: string[] = [];
  game.room.on(Target.confirmed, {
    id: 'cancel-ready',
    owner: null,
    eligible: () => true,
    run(ctx, { effect }) {
      if (effect.target === 'b') earlier = effect;
      else {
        expect(earlier.state).toBe('ready');
        earlier.cancel(ctx, 'test:later');
      }
    },
  });
  game.room.on(Resolve.starting, {
    id: 'started',
    owner: null,
    eligible: () => true,
    run(_ctx, { effect }) {
      started.push(effect.target);
    },
  });
  expect(await use(game, intent(['b', 'c']))).toMatchObject({
    value: { use: { effects: [{ state: 'cancelled' }, { state: 'resolved' }] } },
  });
  expect(started).toEqual(['c']);
  expect(game.room.history.facts('card.effect')).toHaveLength(2);
  replay(game);
});

it('首个伤害后来源死亡并失去武器/无双，后席已声明的无双与青釭仍然生效', async () => {
  const game = cardGame({
    hands: { a: [card('slash', 'slash')], c: [card('jink', 'jink')] },
    equipment: { a: [card('sword', 'qinggang_sword')], c: [card('shield', 'nioh_shield')] },
    skills: standardGeneralSkills,
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: 'standard:wushuang', source }),
  );
  game.room.on(Damage.dealt, {
    id: 'lose-source',
    owner: null,
    eligible: (_ctx, event) => event.input.to === 'b',
    async run(ctx) {
      await game.skills.revoke(ctx, 'a', 'standard:wushuang', source);
      await kill(ctx, { player: 'a', killer: null, reason: 'rule', cause });
    },
  });
  game.room.on(Use.declared, {
    id: 'second-target',
    owner: null,
    eligible: (_ctx, plan) => plan.card.name === 'standard:slash',
    run(ctx, plan) {
      plan.addTarget(ctx, 'c', 'test:multi');
    },
  });
  const running = use(game, slash());
  await answer(game, { kind: 'physical', card: 'jink' }, 'card-response');
  const result = await running;
  expect(result).toMatchObject({
    value: {
      use: {
        effects: [
          { target: 'b', targetStage: 'confirmed' },
          {
            target: 'c',
            responseRequirements: [{ minimum: 2 }],
            ignoredEquipment: [{ slot: 'armor', reason: 'standard:qinggang_sword' }],
          },
        ],
      },
    },
  });
  expect(game.room.world.player('a').alive).toBe(false);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.player('c').hp).toBe(3);
  expect(game.room.world.position('jink')).toBe('discard');
  expect(game.room.world.position('slash')).toBe('discard');
  const targeting = game.room.history.facts('card.targeting');
  expect(targeting.at(-1)!.seq).toBeLessThan(game.room.history.facts('damage.dealt')[0]!.seq);
  replay(game);
});

it('铁骑对全部初始目标先判定，再执行首个伤害，来源随后死亡不跳过后席已声明结果', async () => {
  const game = cardGame({
    hands: { a: [card('slash', 'slash')], c: [card('jink', 'jink')] },
    draw: [card('red', 'peach', 'heart'), card('black', 'peach', 'spade')],
    skills: standardGeneralSkills,
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: 'standard:tieqi', source }),
  );
  game.room.on(Damage.dealt, {
    id: 'death',
    owner: null,
    eligible: (_ctx, event) => event.input.to === 'b',
    async run(ctx) {
      await kill(ctx, { player: 'a', killer: null, reason: 'rule', cause });
    },
  });
  game.room.on(Use.declared, {
    id: 'second-target',
    owner: null,
    eligible: (_ctx, plan) => plan.card.name === 'standard:slash',
    run(ctx, plan) {
      plan.addTarget(ctx, 'c', 'test:multi');
    },
  });
  const running = use(game, slash());
  await answer(game, true);
  const second = await nextRequest(game.room);
  expect(second.kind).toBe('invoke');
  expect(game.room.history.facts('damage.dealt')).toHaveLength(0);
  await answer(game, true);
  await answer(game, { kind: 'physical', card: 'jink' }, 'card-response');
  await running;
  expect(game.room.world.player('a').alive).toBe(false);
  expect(game.room.history.facts('judgment.finished')).toHaveLength(2);
  expect(game.room.history.facts('judgment.finished').at(-1)!.seq).toBeLessThan(
    game.room.history.facts('damage.dealt')[0]!.seq,
  );
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.player('c').hp).toBe(4);
  replay(game);
});

it('目标确认时失去青釭，后续指定后不宣告无视防具', async () => {
  const game = cardGame({
    hands: { a: [card('slash', 'slash')] },
    equipment: { a: [card('sword', 'qinggang_sword')], b: [card('shield', 'nioh_shield')] },
  });
  game.room.on(Target.confirming, {
    id: 'lose-weapon',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await moveCards(
        ctx,
        [{ cards: ['sword'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
        'test',
      );
    },
  });
  await use(game, slash(['b']));
  expect(game.room.history.facts('equipment.ignored')).toHaveLength(0);
  expect(game.room.world.player('b').hp).toBe(4);
  replay(game);
});

it('作者显式声明整次用牌无视防具时，后续追加目标仍继承此整次声明', async () => {
  const game = cardGame({
    hands: { a: [card('slash', 'slash')] },
    equipment: { c: [card('shield', 'nioh_shield')] },
  });
  game.room.on(Use.declared, {
    id: 'whole-use-rule',
    owner: null,
    eligible: () => true,
    run(ctx, plan) {
      plan.ignoreEquipment(ctx, 'armor', 'author:whole-use');
    },
  });
  game.room.on(Resolve.finished, {
    id: 'append',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    run(ctx, { use: plan }) {
      plan.addTarget(ctx, 'c', 'test:late');
    },
  });
  await use(game, slash(['b']));
  expect(game.room.world.player('c').hp).toBe(3);
  replay(game);
});

it.each([
  ['尚未确认的目标死亡', Target.confirming, 'b'],
  ['已经确认的目标死亡', Target.confirmed, 'd'],
  ['已经确认的目标被禁止', Target.confirmed, 'd'],
] as const)('五谷在全部目标确认后建立牌池，%s不占额外牌', async (_label, window, actor) => {
  const ban = defineSkill({
    id: 'test:grace-ban',
    name: '拒绝五谷',
    triggers: [],
    modifiers: [
      modify(cardQueries.prohibitTarget, (_ctx, { input: request, self }) =>
        request.target === self.owner && request.card.name === 'standard:amazing_grace'
          ? true
          : undefined,
      ),
    ],
  });
  const game = cardGame({
    hands: { a: [card('grace', 'amazing_grace')] },
    draw: [0, 1, 2, 3].map((i) => card(`top${i}`, 'peach')),
    skills: [ban],
  });
  game.room.on(window, {
    id: 'death',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === actor,
    async run(ctx) {
      if (_label === '已经确认的目标被禁止')
        await game.skills.grant(ctx, { owner: 'c', skill: ban.id, source });
      else await kill(ctx, { player: 'c', killer: null, reason: 'rule', cause });
    },
  });
  const running = use(game, {
    ...slash(),
    targets: [],
    choice: { kind: 'physical', card: 'grace' },
  });
  for (const i of [0, 1, 2])
    await answer(game, { cards: [`top${i}`], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.player('c').alive).toBe(_label === '已经确认的目标被禁止');
  expect(game.room.world.position('top3')).toBe('draw');
  expect(game.room.world.position('top0')).toBe('a:hand');
  expect(game.room.world.position('top1')).toBe('b:hand');
  expect(game.room.world.position('top2')).toBe('d:hand');
  expect(
    game.room.history.facts('card.effect').map((f) => (f.data.detail as { state: string }).state),
  ).toEqual(['resolved', 'resolved', 'skipped', 'resolved']);
  replay(game);
});

it('延时牌放置经过四层，后续判定生效使用新效果身份且不重新指定目标', async () => {
  const game = cardGame({
    hands: { a: [card('delay', 'indulgence')] },
    draw: [card('top', 'slash', 'heart')],
  });
  const starts: { stage: string; state: string; targetStage: TargetStage | null }[] = [];
  game.room.on(Resolve.starting, {
    id: 'starts',
    owner: null,
    eligible: () => true,
    run(_ctx, { use: plan, effect }) {
      starts.push({ stage: plan.stage, state: effect.state, targetStage: effect.targetStage });
    },
  });
  await use(game, { ...slash(['b']), choice: { kind: 'physical', card: 'delay' } });
  await game.room.run('judge', (ctx) => runPhase(ctx, game.book, 'b', 'judge', defaultPhaseBody));
  expect(starts).toEqual([
    { stage: 'use', state: 'ready', targetStage: 'confirmed' },
    { stage: 'delayed', state: 'ready', targetStage: null },
  ]);
  expect(targetFacts(game).map((f) => f.stage)).toEqual(stages.map(([s]) => s));
  const effects = game.room.history
    .facts('card.effect')
    .map((f) => f.data.detail as { effectId: string; useId: string });
  expect(effects).toHaveLength(2);
  expect(effects[0]!.useId).toBe(effects[1]!.useId);
  expect(effects[0]!.effectId).not.toBe(effects[1]!.effectId);
  replay(game);
});

it('实际效果局部中止不会重放或撤销其他已确认目标，后续效果继续且清理处理区', async () => {
  const resolved: string[] = [];
  const game = scenario({
    ...probe,
    use: {
      ...probe.use!,
      resolve(ctx, { effect }) {
        if (effect.target === 'b') return ctx.abort('test:local');
        resolved.push(effect.target);
      },
    },
  });
  expect(await use(game, intent(['b', 'c']))).toMatchObject({
    value: {
      use: {
        effects: [
          { target: 'b', state: 'aborted' },
          { target: 'c', state: 'resolved' },
        ],
      },
    },
  });
  expect(resolved).toEqual(['c']);
  expect(targetFacts(game)).toHaveLength(8);
  replay(game);
});

it('首个效果结束游戏，后续实际效果跳过而已经完成的目标时点不撤销', async () => {
  const game = scenario({
    ...probe,
    use: {
      ...probe.use!,
      async resolve(ctx) {
        await finishGame(ctx, { winners: ['b'], reason: 'test' });
      },
    },
  });
  expect(await use(game, intent(['b', 'c']))).toMatchObject({
    value: {
      use: {
        effects: [
          { state: 'resolved', targetStage: 'confirmed' },
          { state: 'skipped', targetStage: 'confirmed' },
        ],
      },
    },
  });
  expect(targetFacts(game)).toHaveLength(8);
  replay(game);
});

it('已确认的后席目标在首个实际效果中死亡，只跳过生效且不重开时点', async () => {
  const game = scenario({
    ...probe,
    use: {
      ...probe.use!,
      async resolve(ctx, { effect }) {
        if (effect.target === 'b')
          await kill(ctx, { player: 'c', killer: null, reason: 'rule', cause });
      },
    },
  });
  expect(await use(game, intent(['b', 'c']))).toMatchObject({
    value: {
      use: { effects: [{ state: 'resolved' }, { state: 'skipped', targetStage: 'confirmed' }] },
    },
  });
  expect(targetFacts(game)).toHaveLength(8);
  replay(game);
});
