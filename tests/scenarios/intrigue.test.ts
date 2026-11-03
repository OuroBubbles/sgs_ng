import { expect, it } from 'vitest';
import { playMatch } from '../fixtures/match';
import { card, cardGame, use, chooseAndActivate as activate } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { standardGenerals, standardGeneralSkills } from '../../src/content/standard/generals';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { RoleMatch } from '../../src/app/offline/role-match';
import { projectMatch } from '../../src/app/offline/projection';
import { standardCards } from '../../src/content/standard/cards';
import {
  chooseOne,
  runPhase,
  activeOffers,
  draw,
  phaseBefore,
  costPaid,
  cardsMoved,
  moveCards,
  damageDealt,
  judgmentFinished,
  useDeclared,
  targetSpecified,
  targetSpecifying,
  effectStarting,
  responseRequested,
  counterOpening,
  defineSkill,
  modify,
  cardQueries,
  setGender,
  setKingdom,
  ownedCards,
  installCounterspells,
  resolveCounter,
  kill,
  useDeclarations,
} from '../../src/sdk';
import type { CardEffect, Context, PhaseView, UseIntent, CardDefinition } from '../../src/sdk';
type Game = ReturnType<typeof cardGame>;
const source = { kind: 'general', id: 'test' } as const;
function scenario(options: Parameters<typeof cardGame>[0] = {}) {
  return cardGame({
    ...options,
    hands: { a: [], ...options.hands },
    skills: options.skills ?? standardGeneralSkills,
  });
}
async function grant(game: Game, skill: string, owner = 'a') {
  await game.room.run('grant', (ctx) => game.skills.grant(ctx, { owner, skill, source }));
}
async function answer(game: Game, value: unknown, kind = 'invoke') {
  const r = await nextRequest(game.room);
  expect(r.kind).toBe(kind);
  expect(game.room.decisions.submit(r.id, r.token, value)).toEqual({ kind: 'accepted' });
}
async function cancel(game: Game) {
  const r = await nextRequest(game.room);
  expect(game.room.decisions.cancel(r.id, r.token)).toEqual({ kind: 'accepted' });
}
function replay(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(useDeclarations(game.room.world)).toEqual([]);
  expect(game.room.world.snapshot.zones.filter((z) => z.kind === 'processing')).toEqual([]);
}
const physical = (id: string, actor = 'a', targets = ['b']): UseIntent => ({
  actor,
  choice: { kind: 'physical', card: id },
  targets,
  timing: { kind: 'effect' },
});
const samples = () => Array.from({ length: 8 }, (_, i) => card('draw' + i, 'peach', 'heart'));
async function activateSkill(ctx: Context, game: Game, phase: PhaseView, name: string) {
  const offer = activeOffers(ctx, game.book, phase).find((o) => o.skill === 'standard:' + name);
  expect(offer).toBeDefined();
  await activate(ctx, game.book, phase, {
    instance: offer!.choice.instance,
    action: offer!.choice.action,
  });
}
const playSkill = (
  game: Game,
  name: string,
  after?: (ctx: Context, phase: PhaseView) => void | Promise<void>,
) =>
  game.room.run('play', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      await activateSkill(at, game, phase, name);
      await after?.(at, phase);
    }),
  );
async function genders(game: Game) {
  await game.room.run('genders', (ctx) => {
    setGender(ctx, 'a', 'female');
    setGender(ctx, 'b', 'male');
    setGender(ctx, 'c', 'male');
    setGender(ctx, 'd', 'female');
  });
}

it('具名选项固定描述快照、拒绝未知项与强制取消，结束后旧输入失效', async () => {
  const game = scenario();
  class Option {
    constructor(
      readonly value: string,
      public label: string,
    ) {}

    get id() {
      return this.value;
    }
  }
  const options = [new Option('one', '第一项'), new Option('two', '第二项')];
  class Input {
    player = 'a';
    prompt = '请选择';
    options = options;
    reasonReads = 0;
    #world = game.room.world;

    get reason() {
      return ++this.reasonReads === 1 ? 'author:choice' : '';
    }

    available() {
      return this.#world.player(this.player).alive;
    }
  }
  const input = new Input();
  const sparse = new Input();
  sparse.options = new Array<Option>(1);
  expect(() => chooseOne(sparse)).toThrow();
  const decision = chooseOne(input);
  expect(input.reasonReads).toBe(1);
  input.available = () => false;
  expect(game.room.inspect(() => decision.available!())).toBe(true);
  const running = game.room.run('choice', (ctx) => ctx.ask(decision));
  options[0]!.label = '外部改名';
  const r = await nextRequest(game.room);
  expect(r.data).toEqual({
    options: [
      { id: 'one', label: '第一项' },
      { id: 'two', label: '第二项' },
    ],
    reason: 'author:choice',
  });
  expect(game.room.decisions.cancel(r.id, r.token)).toMatchObject({
    kind: 'rejected',
    reason: 'required',
  });
  expect(game.room.decisions.submit(r.id, r.token, 'unknown').kind).toBe('rejected');
  expect(game.room.decisions.submit(r.id, r.token, 'two').kind).toBe('accepted');
  expect(await running).toMatchObject({ value: { kind: 'chosen', value: 'two' } });
  expect(game.room.decisions.submit(r.id, r.token, 'one').kind).toBe('rejected');
  const optional = game.room.run('optional-choice', (ctx) =>
    ctx.ask(
      chooseOne({
        player: 'a',
        prompt: '可取消',
        options,
        reason: 'author:optional',
        optional: true,
      }),
    ),
  );
  const next = await nextRequest(game.room);
  expect(game.room.decisions.cancel(next.id, next.token).kind).toBe('accepted');
  expect(await optional).toMatchObject({ value: { kind: 'cancelled' } });
  await game.room.run('actor-leaves', (ctx) =>
    ctx.commit('actor.left', [{ kind: 'vitality', player: 'a', hp: 0, alive: false }], null),
  );
  expect(await game.room.run('closed-choice', (ctx) => ctx.ask(decision))).toMatchObject({
    value: { kind: 'unavailable' },
  });
  replay(game);
});
it('马术只修正来源到其他人的距离，与坐骑叠加且不重复授予叠加', async () => {
  const game = scenario({
    equipment: { a: [card('horse', 'chitu')], c: [card('defense', 'dilu')] },
  });
  await grant(game, 'standard:mashu');
  await grant(game, 'standard:mashu');
  await game.room.run('inspect', (ctx) => {
    expect(game.book.distance(ctx, 'a', 'c')).toBe(1);
    expect(game.book.distance(ctx, 'c', 'a')).toBe(2);
    expect(game.book.distance(ctx, 'a', 'a')).toBe(0);
    expect(game.book.distance(ctx, 'a', 'b')).toBe(1);
  });
  replay(game);
});
it.each(['red', 'black', 'decline', 'empty'])('铁骑 %s 判定只影响本次目标的响应', async (kind) => {
  const game = scenario({
    hands: { a: [card('slash', 'slash')], b: [card('jink', 'jink')] },
    draw: kind === 'empty' ? [] : [card('judge', 'peach', kind === 'red' ? 'heart' : 'spade')],
  });
  await grant(game, 'standard:tieqi');
  const running = use(game, physical('slash'));
  await answer(game, kind !== 'decline');
  if (kind !== 'red') await answer(game, { kind: 'physical', card: 'jink' }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(kind === 'red' ? 3 : 4);
  expect(game.room.history.facts('card.responded')).toHaveLength(0);
  expect(game.room.history.facts('card.used')).toHaveLength(kind === 'red' ? 1 : 2);
  replay(game);
});
it('铁骑使用鬼才改判后的最终红色，技能失去不撤销已接受的判定效果', async () => {
  const game = scenario({
    hands: {
      a: [card('slash', 'slash')],
      b: [card('jink', 'jink')],
      c: [card('red', 'peach', 'heart')],
    },
    draw: [card('black', 'jink')],
  });
  await grant(game, 'standard:tieqi');
  await grant(game, 'standard:guicai', 'c');
  game.room.on(judgmentFinished, {
    id: 'lose',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await game.skills.revoke(ctx, 'a', 'standard:tieqi', source);
    },
  });
  const running = use(game, physical('slash'));
  await answer(game, true);
  await answer(game, { cards: ['red'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('jink')).toBe('b:hand');
  replay(game);
});
it('铁骑分别判定多目标，红色禁响应优先于无双的最低次数', async () => {
  const game = scenario({
    hands: {
      a: [card('slash', 'slash')],
      b: [card('bj', 'jink')],
      c: [card('c1', 'jink'), card('c2', 'jink')],
    },
    draw: [card('red', 'peach', 'heart'), card('black', 'peach')],
    policy: { attackRange: () => 3 },
  });
  await grant(game, 'standard:tieqi');
  await grant(game, 'standard:wushuang');
  game.room.on(useDeclared, {
    id: 'extra',
    owner: null,
    eligible: (_ctx, plan) => plan.card.name === 'standard:slash',
    run(ctx, plan) {
      plan.addTarget(ctx, 'c', 'test');
    },
  });
  const running = use(game, physical('slash'));
  await answer(game, true);
  await answer(game, true);
  for (const id of ['c1', 'c2'])
    await answer(game, { kind: 'physical', card: id }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.player('c').hp).toBe(4);
  replay(game);
});
it('流离先于铁骑，只对新目标询问判定，旧身份的响应禁令不泄漏', async () => {
  const game = scenario({
    hands: { a: [card('slash', 'slash')], b: [card('fee', 'jink')], c: [card('jink', 'jink')] },
    draw: [card('red', 'peach', 'heart')],
  });
  await grant(game, 'standard:tieqi');
  await grant(game, 'standard:liuli', 'b');
  game.room.on(targetSpecifying, {
    id: 'early-block',
    owner: null,
    eligible: (_ctx, { effect }) => effect.target === 'b',
    run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'author:old-target');
    },
  });
  const running = use(game, physical('slash'));
  await answer(game, { cards: ['fee'], targets: ['c'] }, 'cards-targets');
  await answer(game, false);
  await answer(game, { kind: 'physical', card: 'jink' }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.player('c').hp).toBe(4);
  replay(game);
});
it('效果禁响应连直接 respond 也不可绕过，八卦/护驾窗口均不开启', async () => {
  const game = scenario({
    hands: { a: [card('slash', 'slash')], b: [card('jink', 'jink')], c: [card('supply', 'jink')] },
    equipment: { b: [card('armor', 'eight_diagram')] },
    draw: [card('red', 'peach', 'heart')],
  });
  await grant(game, 'standard:hujia', 'b');
  await game.room.run('kingdom', (ctx) => setKingdom(ctx, 'c', '魏'));
  let openings = 0;
  game.room.on(responseRequested, {
    id: 'trace',
    owner: null,
    eligible: () => true,
    run() {
      openings++;
    },
  });
  game.room.on(effectStarting, {
    id: 'block',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'author:block');
      expect(await game.book.respond(ctx, 'b', ['standard:jink'], effect)).toMatchObject({
        kind: 'unavailable',
      });
    },
  });
  await use(game, physical('slash'));
  expect(openings).toBe(0);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.zone('draw').cards).toEqual(['red']);
  replay(game);
});
it('响应禁令拒绝纯查询和封口后修改，快照保留原因', async () => {
  const game = scenario({ hands: { a: [card('slash', 'slash')] } });
  let effect: CardEffect | undefined;
  game.room.on(targetSpecified, {
    id: 'capture',
    owner: null,
    eligible: () => true,
    run(ctx, event) {
      effect = event.effect;
      expect(() => ctx.query(() => event.effect.blockResponses(ctx, 'b', 'bad'))).toThrow(
        'Pure queries',
      );
      effect.blockResponses(ctx, 'b', 'good');
    },
  });
  expect(await use(game, physical('slash'))).toMatchObject({
    value: { use: { effects: [{ responseBlocks: [{ actor: 'b', reason: 'good' }] }] } },
  });
  await game.room.run('late', (ctx) => {
    expect(() => effect!.blockResponses(ctx, 'b', 'late')).toThrow();
  });
  replay(game);
});
it.each([true, false])('英姿接受=%s，只修改这次阶段摸牌', async (accepted) => {
  const game = scenario({ draw: samples() });
  await grant(game, 'standard:yingzi');
  const running = game.room.run('draw', (ctx) => runPhase(ctx, game.book, 'a', 'draw'));
  await answer(game, accepted);
  await running;
  expect(ownedCards(game.room.world, 'a')).toHaveLength(accepted ? 3 : 2);
  replay(game);
});
it('英姿不把阶段中的普通技能摸牌当作阶段摸牌', async () => {
  const game = scenario({ draw: samples() });
  await grant(game, 'standard:yingzi');
  await game.room.run('draw', (ctx) =>
    runPhase(ctx, game.book, 'a', 'draw', async (at) => {
      await draw(at, { player: 'a', count: 1, reason: 'author:nested' });
    }),
  );
  expect(game.room.history.facts('skill.invoked')).toEqual([]);
  expect(ownedCards(game.room.world, 'a')).toHaveLength(1);
  replay(game);
});
it.each([true, false])('闭月接受=%s，结束阶段正常收束', async (accepted) => {
  const game = scenario({ draw: samples() });
  await grant(game, 'standard:biyue');
  const running = game.room.run('finish', (ctx) => runPhase(ctx, game.book, 'a', 'finish'));
  await answer(game, accepted);
  await running;
  expect(ownedCards(game.room.world, 'a')).toHaveLength(accepted ? 1 : 0);
  replay(game);
});
it('跳过结束阶段不发动闭月，已接受后失去技能仍摸牌', async () => {
  for (const skip of [true, false]) {
    const game = scenario({ draw: samples() });
    await grant(game, 'standard:biyue');
    if (skip)
      game.room.on(phaseBefore, {
        id: 'skip',
        owner: null,
        eligible: () => true,
        run(ctx, phase) {
          phase.skip(ctx, 'test');
        },
      });
    else
      game.room.on(costPaid, {
        id: 'lose',
        owner: null,
        eligible: (_ctx, receipt) => receipt.reason === 'standard:biyue',
        async run(ctx) {
          await game.skills.revoke(ctx, 'a', 'standard:biyue', source);
        },
      });
    const running = game.room.run('finish', (ctx) => runPhase(ctx, game.book, 'a', 'finish'));
    if (!skip) await answer(game, true);
    await running;
    expect(ownedCards(game.room.world, 'a')).toHaveLength(skip ? 0 : 1);
    replay(game);
  }
});
it.each(['spade', 'heart', 'club', 'diamond'])(
  '反间猜 %s，目标暗选后公开获得手牌，先移牌再比较花色',
  async (guess) => {
    const game = scenario({ hands: { a: [card('gift', 'jink', 'club')] } });
    await grant(game, 'standard:fanjian');
    let moved = false;
    game.room.on(cardsMoved, {
      id: 'before-damage',
      owner: null,
      eligible: (_ctx, event) =>
        event.moves.some((move) => move.cards.includes('gift') && move.to === 'b:hand'),
      run(ctx) {
        moved = true;
        expect(ctx.world.player('b').hp).toBe(4);
      },
    });
    const running = playSkill(game, 'fanjian', (ctx, phase) => {
      expect(activeOffers(ctx, game.book, phase).some((o) => o.skill === 'standard:fanjian')).toBe(
        false,
      );
    });
    await answer(game, { cards: [], targets: ['b'] }, 'cards-targets');
    await answer(game, guess, 'choose-option');
    const r = await nextRequest(game.room);
    expect(r.player).toBe('b');
    const options = (r.data as { preview: { cards: { id: string; label: string }[] } }).preview
      .cards;
    expect(options).toHaveLength(1);
    expect(options[0]!.id).not.toBe('gift');
    expect(options[0]!.label).toContain('未知手牌');
    expect(
      game.room.decisions.submit(r.id, r.token, { cards: [options[0]!.id], targets: [] }).kind,
    ).toBe('accepted');
    await running;
    expect(moved).toBe(true);
    expect(game.room.world.position('gift')).toBe('b:hand');
    expect(game.room.world.player('b').hp).toBe(guess === 'club' ? 4 : 3);
    replay(game);
  },
);
async function selectFanjianCard(game: Game, guess = 'spade') {
  await answer(game, { cards: [], targets: ['b'] }, 'cards-targets');
  await answer(game, guess, 'choose-option');
  const r = await nextRequest(game.room);
  const cards = (r.data as { preview: { cards: { id: string }[] } }).preview.cards;
  expect(
    game.room.decisions.submit(r.id, r.token, { cards: [cards[0]!.id], targets: [] }).kind,
  ).toBe('accepted');
}
it('反间取消不消耗次数，空手或只有装备时不能发动', async () => {
  const game = scenario({ hands: { a: [card('gift', 'jink')] } });
  await grant(game, 'standard:fanjian');
  const running = playSkill(game, 'fanjian', (ctx, phase) => {
    expect(activeOffers(ctx, game.book, phase).some((o) => o.skill === 'standard:fanjian')).toBe(
      true,
    );
  });
  await cancel(game);
  await running;
  expect(game.room.history.facts('skill.invoked')).toEqual([]);
  await game.room.run('remove', (ctx) =>
    moveCards(ctx, [{ cards: ['gift'], from: 'a:hand', to: 'discard', place: 'bottom' }], 'test'),
  );
  await game.room.run('empty', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', (at, phase) => {
      expect(activeOffers(at, game.book, phase).some((o) => o.skill === 'standard:fanjian')).toBe(
        false,
      );
    }),
  );
  replay(game);
});
it('反间交牌不是弃牌；连营等移牌后效在猜错伤害前完成', async () => {
  const ban = defineSkill({
    id: 'author:no-discard',
    name: '禁弃',
    triggers: [],
    modifiers: [modify(cardQueries.prohibitDiscard, () => true)],
  });
  const game = scenario({
    hands: { a: [card('gift', 'jink', 'heart')] },
    draw: samples(),
    skills: [...standardGeneralSkills, ban],
  });
  await grant(game, 'standard:fanjian');
  await grant(game, 'standard:lianying');
  await grant(game, ban.id);
  game.room.on(damageDealt, {
    id: 'after-lianying',
    owner: null,
    eligible: () => true,
    run(ctx) {
      expect(ownedCards(ctx.world, 'a')).toHaveLength(1);
    },
  });
  const running = playSkill(game, 'fanjian');
  await selectFanjianCard(game);
  await answer(game, true);
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  replay(game);
});
it('已宣告反间失去技能仍执行，移动后来源死亡也不撤销猜错伤害', async () => {
  for (const die of [false, true]) {
    const game = scenario({ hands: { a: [card('gift', 'jink', 'heart')] } });
    await grant(game, 'standard:fanjian');
    game.room.on(costPaid, {
      id: 'lose',
      owner: null,
      eligible: (_ctx, receipt) => receipt.reason === 'standard:fanjian',
      async run(ctx) {
        await game.skills.revoke(ctx, 'a', 'standard:fanjian', source);
      },
    });
    if (die)
      game.room.on(cardsMoved, {
        id: 'death',
        owner: null,
        eligible: (_ctx, event) => event.moves.some((move) => move.to === 'b:hand'),
        async run(ctx) {
          await kill(ctx, {
            player: 'a',
            killer: null,
            reason: 'rule',
            cause: { kind: 'rule', seq: null, data: 'test' },
          });
        },
      });
    const running = playSkill(game, 'fanjian');
    await selectFanjianCard(game);
    await running;
    expect(game.room.world.player('b').hp).toBe(3);
    expect(game.room.history.facts('damage.dealt')[0]!.data.detail).toMatchObject({
      input: { from: 'a', to: 'b' },
    });
    replay(game);
  }
});
it('反间支付后手牌被取走，不生成假牌或多问一次花色，次数仍消耗', async () => {
  const game = scenario({ hands: { a: [card('gift', 'jink')] } });
  await grant(game, 'standard:fanjian');
  game.room.on(costPaid, {
    id: 'take',
    owner: null,
    eligible: (_ctx, receipt) => receipt.reason === 'standard:fanjian',
    async run(ctx) {
      await moveCards(
        ctx,
        [{ cards: ['gift'], from: 'a:hand', to: 'c:hand', place: 'bottom' }],
        'test',
      );
    },
  });
  const running = playSkill(game, 'fanjian', async (ctx, phase) => {
    await moveCards(
      ctx,
      [{ cards: ['gift'], from: 'c:hand', to: 'a:hand', place: 'bottom' }],
      'restore',
    );
    expect(
      activeOffers(ctx, game.book, phase).some((offer) => offer.skill === 'standard:fanjian'),
    ).toBe(false);
  });
  await answer(game, { cards: [], targets: ['b'] }, 'cards-targets');
  await running;
  expect(game.room.history.facts('fanjian.guessed')).toEqual([]);
  expect(game.room.world.player('b').hp).toBe(4);
  replay(game);
});
it.each(['hand', 'equipment'])('离间弃 %s，后选角色使用完整零材料决斗且禁止无懈', async (area) => {
  const game = scenario({
    hands: { a: area === 'hand' ? [card('fee', 'jink')] : [], b: [card('null', 'nullification')] },
    equipment: area === 'equipment' ? { a: [card('fee', 'crossbow')] } : {},
  });
  await genders(game);
  await grant(game, 'standard:lijian');
  installCounterspells(game.room, game.book);
  let counters = 0;
  game.room.on(counterOpening, {
    id: 'trace',
    owner: null,
    eligible: () => true,
    run() {
      counters++;
    },
  });
  const running = playSkill(game, 'lijian', (ctx, phase) => {
    expect(activeOffers(ctx, game.book, phase).some((o) => o.skill === 'standard:lijian')).toBe(
      false,
    );
  });
  await answer(game, { cards: ['fee'], targets: ['b', 'c'] }, 'cards-targets');
  await running;
  expect(game.room.world.position('fee')).toBe('discard');
  expect(game.room.world.position('null')).toBe('b:hand');
  expect(game.room.world.player('b').hp).toBe(3);
  expect(counters).toBe(0);
  expect(game.room.history.facts('card.used')[0]!.data.detail).toMatchObject({
    actor: 'c',
    cards: [],
    declaration: {
      prohibitedCounters: ['standard:nullification'],
      card: { name: 'standard:duel', materials: [] },
    },
  });
  replay(game);
});
it('离间按有序目标验证禁止使用与目标禁令，不接受女性、本人和重复目标', async () => {
  let blocked = true;
  const game = scenario({
    hands: { a: [card('fee', 'jink')] },
    policy: {
      prohibitTarget: (_ctx, actor, target, semantic) =>
        semantic.name === 'standard:duel' && (blocked || (actor === 'c' && target === 'b')),
    },
  });
  await genders(game);
  await grant(game, 'standard:lijian');
  await game.room.run('no-valid-pair', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', (at, phase) => {
      expect(
        activeOffers(at, game.book, phase).some((offer) => offer.skill === 'standard:lijian'),
      ).toBe(false);
    }),
  );
  blocked = false;
  const running = playSkill(game, 'lijian');
  const r = await nextRequest(game.room);
  for (const targets of [
    ['b', 'c'],
    ['a', 'b'],
    ['d', 'b'],
    ['b', 'b'],
  ])
    expect(game.room.decisions.preview(r.id, { cards: ['fee'], targets })?.valid).toBe(false);
  expect(game.room.decisions.preview(r.id, { cards: ['fee'], targets: ['c', 'b'] })?.valid).toBe(
    true,
  );
  expect(
    game.room.decisions.submit(r.id, r.token, { cards: ['fee'], targets: ['c', 'b'] }).kind,
  ).toBe('accepted');
  await running;
  expect(game.room.world.player('c').hp).toBe(3);
  replay(game);
});
it('离间取消不计次、同阶段只支付一次，下一阶段重新可用', async () => {
  const game = scenario({ hands: { a: [card('fee1', 'jink'), card('fee2', 'jink')] } });
  await genders(game);
  await grant(game, 'standard:lijian');
  const cancelled = playSkill(game, 'lijian', (ctx, phase) => {
    expect(
      activeOffers(ctx, game.book, phase).some((offer) => offer.skill === 'standard:lijian'),
    ).toBe(true);
  });
  await cancel(game);
  await cancelled;
  for (const id of ['fee1', 'fee2']) {
    const running = playSkill(game, 'lijian', (ctx, phase) => {
      expect(
        activeOffers(ctx, game.book, phase).some((offer) => offer.skill === 'standard:lijian'),
      ).toBe(false);
    });
    await answer(game, { cards: [id], targets: ['b', 'c'] }, 'cards-targets');
    await running;
  }
  expect(game.room.world.player('b').hp).toBe(2);
  replay(game);
});
it('反间的目标界面只收到暗选项，交牌后才公开牌面与准确的展示事实序号', async () => {
  const match = new RoleMatch({
    id: 'fanjian-public',
    seed: 42,
    players: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
    roles: ['lord', 'rebel', 'loyalist', 'renegade'],
    content: {
      cards: standardCards,
      skills: standardGeneralSkills,
    },
    deck: [
      card('gift', 'jink', 'heart'),
      ...Array.from({ length: 24 }, (_, i) => card('p' + i, 'peach')),
    ],
  });
  await match.prepare();
  await match.room.run('fixture', async (ctx) => {
    const extra = ownedCards(ctx.world, 'a').filter((id) => id !== 'gift');
    if (extra.length)
      await moveCards(
        ctx,
        [{ cards: extra, from: 'a:hand', to: 'discard', place: 'bottom' }],
        'fixture',
      );
    const from = ctx.world.position('gift');
    if (from !== 'a:hand')
      await moveCards(ctx, [{ cards: ['gift'], from, to: 'a:hand', place: 'bottom' }], 'fixture');
    await match.skills.grant(ctx, { owner: 'a', skill: 'standard:fanjian', source });
  });
  const running = match.room.run('play', (ctx) =>
    runPhase(ctx, match.book, 'a', 'play', async (at, phase) => {
      const offer = activeOffers(at, match.book, phase).find(
        (o) => o.skill === 'standard:fanjian',
      )!;
      await activate(at, match.book, phase, {
        instance: offer.choice.instance,
        action: offer.choice.action,
      });
    }),
  );
  let r = await nextRequest(match.room);
  match.room.decisions.submit(r.id, r.token, { cards: [], targets: ['b'] });
  r = await nextRequest(match.room);
  match.room.decisions.submit(r.id, r.token, 'spade');
  r = await nextRequest(match.room);
  const view = projectMatch(match, 'b', r);
  expect(view.decision).toMatchObject({ kind: 'cards-targets', cards: [{ label: '未知手牌 1' }] });
  expect(view.hand.some((card) => card.id === 'gift')).toBe(false);
  const option = (r.data as { preview: { cards: { id: string }[] } }).preview.cards[0]!.id;
  match.room.decisions.submit(r.id, r.token, { cards: [option], targets: [] });
  await running;
  const finished = projectMatch(match, 'b', null);
  const shown = finished.actions.find((action) => action.kind === 'reveal')!;
  expect(shown).toMatchObject({ actor: 'a', targets: ['b'], card: { name: '闪', suit: '♥' } });
  expect(Number.isSafeInteger(shown.seq)).toBe(true);
  expect(match.room.history.facts('cards.given').some((fact) => fact.seq === shown.seq)).toBe(true);
  expect(finished.log.some((line) => line.text.includes('公开：【闪】♥7'))).toBe(true);
});
it('单次反制禁令随持久延时牌保存到后续生效，不依赖原计划句柄', async () => {
  const game = scenario({
    hands: { a: [card('delay', 'indulgence')], b: [card('null', 'nullification')] },
    draw: [card('judgment', 'peach', 'heart')],
  });
  installCounterspells(game.room, game.book);
  await use(game, { ...physical('delay'), prohibitedCounters: ['standard:nullification'] });
  await game.room.run('judgment', (ctx) => runPhase(ctx, game.book, 'b', 'judge'));
  expect(game.room.world.position('null')).toBe('b:hand');
  expect(game.room.decisions.pending).toEqual([]);
  replay(game);
});
it('离间接受后失去技能或性别改变不撤销，最终决斗禁令仍重查且费用不退', async () => {
  const ban = defineSkill({
    id: 'author:ban-duel',
    name: '禁决斗',
    triggers: [],
    modifiers: [
      modify(cardQueries.prohibitUse, (_ctx, { input, self }) =>
        input.actor === self.owner && input.card.name === 'standard:duel' ? true : undefined,
      ),
    ],
  });
  for (const blocked of [false, true]) {
    const game = scenario({
      hands: { a: [card('fee', 'jink')] },
      skills: [...standardGeneralSkills, ban],
    });
    await genders(game);
    await grant(game, 'standard:lijian');
    game.room.on(costPaid, {
      id: 'change',
      owner: null,
      eligible: (_ctx, receipt) => receipt.reason === 'standard:lijian',
      async run(ctx) {
        await game.skills.revoke(ctx, 'a', 'standard:lijian', source);
        setGender(ctx, 'c', 'female');
        if (blocked) await game.skills.grant(ctx, { owner: 'c', skill: ban.id, source });
      },
    });
    const running = playSkill(game, 'lijian');
    await answer(game, { cards: ['fee'], targets: ['b', 'c'] }, 'cards-targets');
    await running;
    expect(game.room.world.position('fee')).toBe('discard');
    expect(game.room.history.facts('card.used')).toHaveLength(blocked ? 0 : 1);
    expect(game.room.world.player('b').hp).toBe(blocked ? 4 : 3);
    replay(game);
  }
});
it('离间的实际决斗者可触发集智，无双要求对方两杀，伤害仍归赢得决斗者', async () => {
  const game = scenario({
    hands: { a: [card('fee', 'jink')], b: [card('b1', 'slash'), card('b2', 'slash')] },
    draw: [card('drawn', 'peach')],
  });
  await genders(game);
  await grant(game, 'standard:lijian');
  await grant(game, 'standard:wushuang', 'c');
  await grant(game, 'standard:jizhi', 'c');
  const running = playSkill(game, 'lijian');
  await answer(game, { cards: ['fee'], targets: ['b', 'c'] }, 'cards-targets');
  await answer(game, true);
  for (const id of ['b1', 'b2'])
    await answer(game, { kind: 'physical', card: id }, 'card-response');
  await running;
  expect(game.room.world.player('c').hp).toBe(3);
  expect(game.room.history.facts('damage.dealt')[0]!.data.detail).toMatchObject({
    input: { from: 'b', to: 'c', card: { actor: 'c' } },
  });
  expect(game.room.world.position('drawn')).toBe('c:hand');
  replay(game);
});
it('本次用牌的反制禁令复制输入，不影响之后的普通决斗', async () => {
  const game = scenario({
    hands: { a: [card('duel', 'duel')], b: [card('null', 'nullification')] },
  });
  installCounterspells(game.room, game.book);
  const prohibitedCounters = ['standard:nullification'];
  const first = use(game, {
    actor: 'a',
    targets: ['b'],
    timing: { kind: 'effect' },
    prohibitedCounters,
    choice: { kind: 'generated', face: { name: 'standard:duel' }, materials: [], reason: 'author' },
  });
  prohibitedCounters.length = 0;
  await first;
  expect(game.room.world.player('b').hp).toBe(3);
  const next = use(game, physical('duel'));
  await answer(game, { kind: 'physical', card: 'null' }, 'use-card');
  await next;
  expect(game.room.world.player('b').hp).toBe(3);
  replay(game);
});
it('禁止无懈仍可由作者的其他反制牌响应，反制其本身时恢复完整牌型目录', async () => {
  const custom: CardDefinition = {
    id: 'author:counter',
    type: 'trick',
    label: '异反制',
    use: {
      count: { min: 0, max: 0 },
      target: () => false,
      canUse: (_ctx, { request }) => (request.timing.kind === 'counter' ? null : 'Counter only'),
      execute: (ctx, { use, book }) => resolveCounter(ctx, use, book),
    },
  };
  const game = scenario({
    hands: {
      a: [card('an', 'nullification')],
      b: [{ id: 'bc', name: custom.id, suit: 'club', rank: 2 }],
    },
    definitions: [custom],
  });
  installCounterspells(game.room, game.book, ['standard:nullification', custom.id]);
  game.room.on(counterOpening, {
    id: 'counter-purpose',
    owner: null,
    eligible: (_ctx, opportunity) => opportunity.subject.kind === 'effect',
    run(ctx, opportunity) {
      const timing = { kind: 'counter', opportunity } as const;
      expect(
        game.book.validateUse(ctx, {
          actor: 'a',
          targets: ['b'],
          timing,
          choice: {
            kind: 'generated',
            face: { name: 'standard:duel' },
            materials: [],
            reason: 'wrong-purpose',
          },
        }).ok,
      ).toBe(false);
      expect(
        game.book.validateUse(ctx, {
          actor: 'a',
          targets: [],
          timing,
          choice: { kind: 'physical', card: 'an' },
        }).ok,
      ).toBe(false);
      expect(
        game.book.validateUse(ctx, {
          actor: 'b',
          targets: [],
          timing,
          choice: { kind: 'physical', card: 'bc' },
        }).ok,
      ).toBe(true);
    },
  });
  const running = use(game, {
    actor: 'a',
    targets: ['b'],
    timing: { kind: 'effect' },
    prohibitedCounters: ['standard:nullification'],
    choice: { kind: 'generated', face: { name: 'standard:duel' }, materials: [], reason: 'author' },
  });
  await answer(game, { kind: 'physical', card: 'bc' }, 'use-card');
  await answer(game, { kind: 'physical', card: 'an' }, 'use-card');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts('card.used')).toHaveLength(3);
  replay(game);
});
it('三名新将混合八人局以基础 AI 正式决策推进至胜负，seed=27', async () => {
  const seed = 27;
  const lineup = [21, 22, 23, 21, 22, 23, 15, 13].map((i) => standardGenerals[i]!.id);
  const match = createOfflineMatch({ seed, preset: 'standard:identity', lineup });
  await playMatch(match, { steps: 12000 });

  const invoked = match.room.history
    .facts('skill.invoked')
    .map((f) => (f.data.detail as { skill: string }).skill);
  expect(invoked).toContain('standard:fanjian');
  expect(invoked).toContain('standard:lijian');
}, 60000);
