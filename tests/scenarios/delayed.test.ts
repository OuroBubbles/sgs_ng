import { expect, it } from 'vitest';
import {
  delayedCards,
  delayedCard,
  runTurn,
  runPhase,
  defaultPhaseBody,
  moveCards,
  installCounterspells,
  defineSkill,
  viewAs,
  ownedCards,
  finishGame,
  Target,
  Judgment,
  Cards,
  Cost,
  Phase,
  Turn,
  cardQueries,
  modify,
  useCard,
} from '../../src/sdk';
import type { UseIntent, Context, DelayedInput } from '../../src/sdk';
import { card, cardGame, use, die } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { CardEvent } from '../../src/sdk';
import { Counter } from '../../src/sdk';
import { Damage } from '../../src/sdk';
import { Delayed } from '../../src/rules/cards/delayed';

const play = (id: string, actor = 'a', targets: readonly string[] = ['b']): UseIntent => ({
  actor,
  choice: { kind: 'physical', card: id },
  targets,
  timing: { kind: 'effect' },
});
const turn = (game: ReturnType<typeof cardGame>, owner: string) =>
  game.room.run('turn', (ctx) =>
    runTurn(ctx, owner, {
      body: async (at, phase) => {
        if (phase.kind === 'judge') await defaultPhaseBody(at, phase);
      },
    }),
  );

function phases(result: Awaited<ReturnType<typeof turn>>) {
  if (result.kind !== 'resolved') throw new Error('Turn did not resolve.');
  return result.value.phases;
}

it('延时牌使用只安装，不提前判定或反制；同名牌不能重复放到同一角色', async () => {
  const game = cardGame({
    hands: {
      a: [card('delay', 'indulgence'), card('other', 'indulgence')],
      b: [card('counter', 'nullification')],
    },
    draw: [card('top', 'slash')],
  });
  installCounterspells(game.room);
  expect(await use(game, play('delay'))).toMatchObject({ value: { kind: 'used' } });
  expect(delayedCards(game.room.world, 'b')).toHaveLength(1);
  expect(game.room.history.facts(Counter.finished)).toHaveLength(0);
  expect(game.room.history.facts(Judgment.finished)).toHaveLength(0);
  expect(game.room.world.position('delay')).toBe(delayedCards(game.room.world, 'b')[0]!.id);
  expect(await use(game, play('other'))).toMatchObject({ value: { kind: 'unavailable' } });
  expect(game.room.world.position('other')).toBe('a:hand');
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it.each(['heart', 'spade'] as const)(
  '乐不思蜀判定 %s，只影响本回合下一个出牌阶段，之后实例消失',
  async (suit) => {
    const game = cardGame({
      hands: { a: [card('delay', 'indulgence')] },
      draw: [card('top', 'slash', suit)],
    });
    await use(game, play('delay'));
    const result = await turn(game, 'b');
    expect(phases(result).find((phase) => phase.phase.kind === 'play')).toMatchObject({
      exit: suit === 'heart' ? 'completed' : 'skipped',
    });
    expect(delayedCards(game.room.world, 'b')).toHaveLength(0);
    expect(game.room.world.position('delay')).toBe('discard');
    expect(
      phases(await turn(game, 'b')).find((phase) => phase.phase.kind === 'play'),
    ).toMatchObject({ exit: 'completed' });
    expect(game.room.history.facts(Judgment.finished)).toHaveLength(1);
  },
);

it.each([2, 9, 1, 10])('闪电黑桃 %s：2–9 为无来源雷电伤害，其余传给下一合法角色', async (rank) => {
  const game = cardGame({
    hands: { a: [card('lightning', 'lightning')] },
    draw: [card('top', 'slash', 'spade', rank)],
  });
  await use(game, play('lightning', 'a', []));
  await turn(game, 'a');
  const hit = rank >= 2 && rank <= 9;
  expect(game.room.world.player('a').hp).toBe(hit ? 1 : 4);
  if (hit) {
    expect(game.room.history.facts(Damage.dealt)[0]!.data.detail).toMatchObject({
      input: { from: null, nature: 'thunder', amount: 3 },
    });
    expect(game.room.world.position('lightning')).toBe('discard');
  } else expect(delayedCards(game.room.world, 'b')).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
});

it('延时牌到生效时才进入反制，乐不思蜀被无懈后不判定也不跳阶段', async () => {
  const game = cardGame({
    hands: { a: [card('delay', 'indulgence')], b: [card('counter', 'nullification')] },
    draw: [card('top', 'slash')],
  });
  installCounterspells(game.room);
  await use(game, play('delay'));
  const running = turn(game, 'b');
  const request = await nextRequest(game.room);
  expect(request).toMatchObject({ player: 'b', kind: 'use-card' });
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'counter' })
      .kind,
  ).toBe('accepted');
  await running;
  expect(game.room.history.facts(Judgment.finished)).toHaveLength(0);
  expect(game.room.history.facts(Phase.skipped)).toHaveLength(0);
  expect(game.room.world.position('delay')).toBe('discard');
  const effects = game.room.history
    .facts(CardEvent.effect)
    .map((fact) => fact.data.detail as { effectId: string });
  expect(new Set(effects.map((effect) => effect.effectId)).size).toBe(effects.length);
  expect(game.room.history.facts(Delayed.effectFinished)[0]!.data.detail).toMatchObject({
    stage: 'delayed',
  });
});

it('闪电被无懈后仍向下传递，不能当成普通锦囊直接丢弃', async () => {
  const game = cardGame({
    hands: { a: [card('lightning', 'lightning')], b: [card('counter', 'nullification')] },
    draw: [card('top', 'slash')],
  });
  installCounterspells(game.room);
  await use(game, play('lightning', 'a', []));
  const running = turn(game, 'a');
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'counter' });
  await running;
  expect(game.room.history.facts(Judgment.finished)).toHaveLength(0);
  expect(delayedCards(game.room.world, 'b')[0]!.source.card.name).toBe('standard:lightning');
});

it('闪电传递跳过重复与禁止目标，回到自己也不会在同一判定阶段再次结算', async () => {
  const game = cardGame({
    hands: { a: [card('first', 'lightning')], b: [card('occupied', 'lightning')] },
    draw: [card('miss', 'jink', 'heart')],
    rules: [
      modify(
        cardQueries.prohibitTarget,
        (_ctx, { input: { target } }) => target === 'c' || target === 'd',
      ),
    ],
  });
  await use(game, play('first', 'a', []));
  await use(game, play('occupied', 'b', []));
  const original = delayedCards(game.room.world, 'a')[0]!.id;
  await turn(game, 'a');
  expect(delayedCards(game.room.world, 'a')).toHaveLength(1);
  expect(delayedCards(game.room.world, 'a')[0]!.id).not.toBe(original);
  expect(delayedCards(game.room.world, 'b')).toHaveLength(1);
  expect(game.room.history.facts(Judgment.finished)).toHaveLength(1);
});

it('判定区后放先结算，只快照已有实例，新安装的牌留到下一次', async () => {
  const order: string[] = [];
  const third = delayedCard({
    id: 'probe:third',
    label: '后来',
    resolve() {
      order.push('third');
    },
  });
  const first = delayedCard({
    id: 'probe:first',
    label: '先放',
    resolve() {
      order.push('first');
    },
  });
  const second = delayedCard({
    id: 'probe:second',
    label: '后放',
    async resolve(ctx) {
      order.push('second');
      await useCard(ctx, {
        actor: 'a',
        choice: { kind: 'generated', face: { name: third.id }, materials: [], reason: 'new' },
        targets: ['b'],
        timing: { kind: 'effect' },
      });
    },
  });
  const game = cardGame({ hands: { a: [] }, definitions: [first, second, third] });
  let confirmations = 0;
  game.room.on(Target.confirming, {
    id: 'count',
    owner: null,
    eligible: () => true,
    run() {
      confirmations++;
    },
  });
  for (const definition of [first, second])
    await use(game, {
      actor: 'a',
      choice: { kind: 'generated', face: { name: definition.id }, materials: [], reason: 'setup' },
      targets: ['b'],
      timing: { kind: 'effect' },
    });
  await turn(game, 'b');
  expect(order).toEqual(['second', 'first']);
  expect(confirmations).toBe(3);
  expect(delayedCards(game.room.world, 'b').map((entry) => entry.source.card.name)).toEqual([
    third.id,
  ]);
  await turn(game, 'b');
  expect(order).toEqual(['second', 'first', 'third']);
});

it.each([0, 2])(
  '%s 材料转化延时牌保持语义身份；顺手按一张逻辑牌选择并整体取得材料',
  async (count) => {
    const game = cardGame({
      hands: {
        a: [
          card('snatch', 'snatch'),
          ...Array.from({ length: count }, (_, i) => card(`material${i}`, 'jink', 'diamond')),
        ],
      },
    });
    const materials = Array.from({ length: count }, (_, i) => `material${i}`);
    await use(game, {
      actor: 'a',
      choice: {
        kind: 'generated',
        face: { name: 'standard:indulgence' },
        materials,
        reason: 'conversion',
      },
      targets: ['b'],
      timing: { kind: 'effect' },
    });
    expect(delayedCards(game.room.world, 'b')[0]!.source.card).toMatchObject({
      name: 'standard:indulgence',
      materials,
    });
    const running = use(game, play('snatch'));
    const request = await nextRequest(game.room);
    const options = (request.data as { preview: { cards: { id: string; label: string }[] } })
      .preview.cards;
    expect(options).toHaveLength(1);
    expect(options[0]!.label).toContain('乐不思蜀');
    game.room.decisions.submit(request.id, request.token, { cards: [options[0]!.id], targets: [] });
    await running;
    expect(delayedCards(game.room.world, 'b')).toHaveLength(0);
    expect(game.room.world.zone('a:hand').cards).toEqual(materials);
    expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'judgment')).toBe(false);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  },
);

it('多材料实例被直接拆走部分时关闭身份，剩余材料善后，普通后效看不到残留实例', async () => {
  const game = cardGame({ hands: { a: [card('x', 'jink'), card('y', 'peach')] } });
  await use(game, {
    actor: 'a',
    choice: {
      kind: 'generated',
      face: { name: 'standard:indulgence' },
      materials: ['x', 'y'],
      reason: 'pair',
    },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  const entry = delayedCards(game.room.world, 'b')[0]!;
  game.room.on(Cards.moved, {
    id: 'observe',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.cards.includes('x')),
    run(ctx) {
      expect(delayedCards(ctx.world, 'b')).toHaveLength(0);
      expect(ctx.world.position('y')).toBe('discard');
    },
  });
  await game.room.run('split', (ctx) =>
    moveCards(ctx, [{ cards: ['x'], from: entry.id, to: 'a:hand', place: 'bottom' }], 'take-part'),
  );
  expect(game.room.world.position('x')).toBe('a:hand');
  expect(game.room.world.snapshot.zones.some((zone) => zone.id === entry.id)).toBe(false);
});

it.each([0, 2])('死亡埋葬会关闭 %s 材料延时牌，零材料也不留下挂起身份', async (count) => {
  const game = cardGame({
    hands: { a: Array.from({ length: count }, (_, i) => card(`m${i}`, 'jink')) },
  });
  await use(game, {
    actor: 'a',
    choice: {
      kind: 'generated',
      face: { name: 'standard:indulgence' },
      materials: Array.from({ length: count }, (_, i) => `m${i}`),
      reason: 'setup',
    },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  await game.room.run('kill', (ctx) => die(ctx, 'b'));
  expect(delayedCards(game.room.world, 'b', true)).toHaveLength(0);
  expect(
    game.room.world.snapshot.states.filter((state) => state.key === 'core:delayed-card'),
  ).toHaveLength(0);
});

it('跳过判定阶段不消耗判定区实例，下一回合仍可结算', async () => {
  const game = cardGame({
    hands: { a: [card('delay', 'indulgence')] },
    draw: [card('top', 'slash', 'heart')],
  });
  await use(game, play('delay'));
  const release = game.room.on(Phase.before, {
    id: 'skip',
    owner: null,
    eligible: (_ctx, phase) => phase.kind === 'judge',
    run(ctx, phase) {
      phase.skip(ctx, 'probe');
    },
  });
  await turn(game, 'b');
  expect(delayedCards(game.room.world, 'b')).toHaveLength(1);
  expect(game.room.history.facts(Judgment.finished)).toHaveLength(0);
  release();
  await turn(game, 'b');
  expect(delayedCards(game.room.world, 'b')).toHaveLength(0);
});

it('skipNext 消耗下一次对应阶段，额外同名阶段之后不会重复跳过', async () => {
  const game = cardGame({ hands: { a: [] } });
  game.room.on(Turn.started, {
    id: 'plan',
    owner: null,
    eligible: () => true,
    run(ctx, turn) {
      turn.skipNext(ctx, 'play', 'probe');
    },
  });
  const result = await game.room.run('turn', (ctx) =>
    runTurn(ctx, 'a', {
      body: async (at, phase) => {
        if (phase.kind === 'prepare')
          expect(await runPhase(at, 'a', 'play', () => {}, phase.turn)).toMatchObject({
            exit: 'skipped',
          });
      },
    }),
  );
  expect(phases(result).find((phase) => phase.phase.kind === 'play')).toMatchObject({
    exit: 'completed',
  });
});

it('转化来源在宣告后消失仍保留延时牌名，原使用者死亡也不吞掉目标判定', async () => {
  const skill = defineSkill({
    id: 'probe:conversion',
    name: '转化',
    triggers: [],
    viewAs: [
      viewAs({
        id: 'delay',
        label: '转化',
        names: () => ['standard:indulgence'],
        materials: (ctx, { self }) => ownedCards(ctx.world, self.owner),
        count: { min: 1, max: 1 },
        make: () => ({ name: 'standard:indulgence' }),
      }),
    ],
  });
  const game = cardGame({
    hands: { a: [card('red', 'slash', 'diamond')] },
    skills: [skill],
    draw: [card('top', 'slash')],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: skill.id, source: { kind: 'general', id: 'g' } }),
  );
  game.room.on(Cost.paid, {
    id: 'lose',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await game.skills.revoke(ctx, 'a', skill.id, { kind: 'general', id: 'g' });
    },
  });
  const instance = game.room.world.snapshot.skills[0]!.id;
  await use(game, {
    actor: 'a',
    choice: { kind: 'viewAs', instance, recipe: 'delay', materials: ['red'] },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  expect(delayedCards(game.room.world, 'b')[0]!.source.card.name).toBe('standard:indulgence');
  await game.room.run('kill', (ctx) => die(ctx, 'a'));
  await turn(game, 'b');
  expect(game.room.history.facts(Phase.skipped)).toHaveLength(1);
  expect(game.room.world.position('red')).toBe('discard');
});

it('判定完成后效结束整局，乐不思蜀不再产生新的阶段跳过意图', async () => {
  const game = cardGame({
    hands: { a: [card('delay', 'indulgence')] },
    draw: [card('top', 'slash')],
  });
  game.room.on(Judgment.finished, {
    id: 'finish',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await finishGame(ctx, { winners: [], reason: 'probe' });
    },
  });
  await use(game, play('delay'));
  await turn(game, 'b');
  expect(game.room.history.facts(Phase.skipScheduled)).toHaveLength(0);
  expect(game.room.world.position('delay')).toBe('discard');
});

it('延时牌定义快照配置，不被调用者之后修改的目标模式影响', async () => {
  let resolved = 0;
  class Configuration {
    id = 'probe:config';
    label = '配置';
    self = false;
    #amount = 1;

    resolve(_ctx: Context, { effect, phase }: DelayedInput) {
      expect(effect.target).toBe('b');
      expect(phase.kind).toBe('judge');
      resolved += this.#amount;
    }
  }
  const input = new Configuration();
  const definition = delayedCard(input);
  input.self = true;
  input.resolve = () => {
    throw new Error('Changed delayed resolver must not run.');
  };
  const game = cardGame({ hands: { a: [] }, definitions: [definition] });
  expect(
    await use(game, {
      actor: 'a',
      choice: { kind: 'generated', face: { name: definition.id }, materials: [], reason: 'probe' },
      targets: ['b'],
      timing: { kind: 'effect' },
    }),
  ).toMatchObject({ value: { kind: 'used' } });
  expect(delayedCards(game.room.world, 'b')).toHaveLength(1);
  await turn(game, 'b');
  expect(resolved).toBe(1);
  expect(delayedCards(game.room.world, 'b')).toHaveLength(0);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});
