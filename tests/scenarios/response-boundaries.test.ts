import { expect, it } from 'vitest';
import {
  CardBook,
  SkillBook,
  judge,
  withCardSupply,
  loseHp,
  installRescue,
  defineSkill,
  modify,
  cardQueries,
  pay,
  Use,
  Cards,
  Response,
  Dying,
  Cost,
} from '../../src/sdk';
import type { Context, EffectRef, ResponseResult, Timing, SkillDefinition } from '../../src/sdk';
import { Room } from '../../src/core/runtime/room';
import { standardCards } from '../../src/content/standard/cards';
import { guicai } from '../../src/content/standard/generals/simayi';
import { wushuang } from '../../src/content/standard/generals/lvbu';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use } from '../fixtures/cards';
import { worldSeed, nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Damage } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

const owners = ['a', 'b', 'c', 'd'];
function watchOrder<T>(game: ReturnType<typeof cardGame>, window: Timing<T, unknown>): string[] {
  const seen: string[] = [];
  // 所有席位均有被动观察者，令首席锚点错误成为可见的规则差异。
  for (const owner of owners)
    game.room.on(window, {
      id: `probe:${window.id}:${owner}`,
      owner,
      eligible: () => true,
      run: () => {
        seen.push(owner);
      },
    });
  return seen;
}
async function answer(room: Room, value: unknown) {
  const request = await nextRequest(room);
  expect(room.decisions.submit(request.id, request.token, value)).toEqual({ kind: 'accepted' });
}

for (const delegated of [false, true]) {
  it(`实际 c ${delegated ? '代 b 打出' : '自己使用'}闪：支付与各自完成窗口按实际角色起算`, async () => {
    const game = cardGame({ hands: { a: [card('s', 'slash')], c: [card('j', 'jink')] } });
    if (delegated)
      game.room.on(Response.requested, {
        id: 'probe:delegate',
        owner: null,
        eligible: (_ctx, request) => request.actor === 'b',
        run: async (ctx, request) => {
          await request.delegate(ctx, 'c');
        },
      });
    const finished = watchOrder(game, Response.finished);
    const used = watchOrder(game, Use.finished);
    const paid = watchOrder(game, Cost.paid);
    const materialMoved: string[] = [];
    for (const owner of owners)
      game.room.on(Cards.moved, {
        id: `probe:payment-move:${owner}`,
        owner,
        eligible: (_ctx, move) =>
          move.moves.some((item) => item.from === 'c:hand' && item.cards.includes('j')),
        run: () => {
          materialMoved.push(owner);
        },
      });
    const running = use(game, {
      actor: 'a',
      choice: { kind: 'physical', card: 's' },
      targets: [delegated ? 'b' : 'c'],
      timing: { kind: 'effect', ignoreDistance: true },
    });
    await answer(game.room, { kind: 'physical', card: 'j' });
    await running;
    expect(finished).toEqual(delegated ? ['c', 'd', 'a', 'b'] : []);
    expect(used).toEqual([
      ...(delegated ? ['b', 'c', 'd', 'a'] : ['c', 'd', 'a', 'b']),
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(paid).toEqual([
      'a',
      'b',
      'c',
      'd',
      'c',
      'd',
      'a',
      'b',
      ...(delegated ? ['b', 'c', 'd', 'a'] : []),
    ]);
    expect(materialMoved).toEqual(['c', 'd', 'a', 'b']);
    expect(game.room.world.position('j')).toBe('discard');
    expect(game.room.history.facts(CardEvent.responded)).toHaveLength(delegated ? 1 : 0);
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  });
}

it('鬼才由 c 为 b 改判：实际打出者决定支付和打出完成窗口座次，不改判定受益者', async () => {
  const game = cardGame({
    hands: { a: [], c: [card('replacement', 'peach', 'heart')] },
    draw: [card('top', 'slash')],
    skills: [guicai],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, {
      owner: 'c',
      skill: 'standard:guicai',
      source: { kind: 'general', id: 'probe' },
    }),
  );
  const finished = watchOrder(game, Response.finished);
  const paid = watchOrder(game, Cost.paid);
  const running = game.room.run('judge', (ctx) =>
    judge(ctx, {
      player: 'b',
      reason: 'probe:judgment',
      match: (_at, card) => card.suit === 'heart',
    }),
  );
  await answer(game.room, { cards: ['replacement'], targets: [] });
  expect(await running).toMatchObject({
    kind: 'resolved',
    value: { kind: 'judged', matched: true, player: 'b' },
  });
  expect(finished).toEqual(['c', 'd', 'a', 'b']);
  expect(paid).toEqual(['c', 'd', 'a', 'b']);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('独立供牌保留原接收者与查询守卫，从实际 c 结算完成窗口并统一善后', async () => {
  const game = cardGame({ hands: { a: [], c: [card('supply', 'slash')] } });
  class Input {
    actor = 'c';
    beneficiary = 'b';
    names = ['standard:slash'];
    reason = 'probe:supply';
    write = false;
    #world = game.room.world;

    available(ctx: Context) {
      if (this.write) ctx.commit(testTiming('probe.supply-query-write'), [], null);
      const actor = this.#world.player(this.actor);
      return ctx.world === this.#world && actor.alive && actor.hp < actor.maxHp;
    }
  }
  const input = new Input();
  const finished = watchOrder(game, Response.finished);
  const paid = watchOrder(game, Cost.paid);
  expect(
    await game.room.run('unavailable', (ctx) => withCardSupply(ctx, input, () => 'unexpected')),
  ).toMatchObject({ value: { kind: 'unavailable' } });
  expect(game.room.world.position('supply')).toBe('c:hand');
  await game.room.run('wound', (ctx) => loseHp(ctx, { player: 'c', amount: 1, reason: 'probe' }));
  const running = game.room.run('supply', (ctx) =>
    withCardSupply(ctx, input, (at, supply) => {
      input.write = true;
      expect(() => supply.available(at)).toThrow('Pure queries');
      input.write = false;
      expect(supply.available(at)).toBe(true);
      return supply.card.name;
    }),
  );
  await nextRequest(game.room);
  input.available = () => false;
  await answer(game.room, { kind: 'physical', card: 'supply' });
  expect(await running).toMatchObject({
    kind: 'resolved',
    value: { kind: 'supplied', value: 'standard:slash' },
  });
  expect(finished).toEqual(['c', 'd', 'a', 'b']);
  expect(paid).toEqual(['c', 'd', 'a', 'b']);
  expect(game.room.world.position('supply')).toBe('discard');
  expect(game.room.history.facts(testTiming('probe.supply-query-write'))).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('供牌支付后的异步资格不能被布尔组合掩盖，已提交费用不回滚', async () => {
  const game = cardGame({ hands: { c: [card('supply', 'slash')] } });
  let asynchronous = false;
  const running = game.room.run('supply', (ctx) =>
    withCardSupply(
      ctx,
      {
        actor: 'c',
        beneficiary: 'b',
        names: ['standard:slash'],
        reason: 'probe:supply',
        available(): boolean {
          // @ts-expect-error 模拟未经类型检查的异步资格回调。
          return asynchronous ? Promise.resolve(false) : true;
        },
      },
      (at, supply) => {
        asynchronous = true;
        if (supply.available(at)) at.commit(testTiming('probe.supply-after-async'), [], null);
        return supply.card.name;
      },
    ),
  );
  const failed = expect(running).rejects.toThrow('Queries cannot await');
  await answer(game.room, { kind: 'physical', card: 'supply' });
  await failed;
  expect(game.room.status).toBe('faulted');
  expect(game.room.history.facts(testTiming('probe.supply-after-async'))).toEqual([]);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(game.room.world.position('supply')).not.toBe('c:hand');
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('支付后窗口使用已提交 receipt 的实际支付者，不重读被后效修改的调用参数', async () => {
  const game = cardGame({ hands: { c: [card('fee', 'jink')] } });
  const spec = { actor: 'c', cards: ['fee'], to: 'discard', reason: 'probe:fee' };
  game.room.on(Cards.moved, {
    id: 'probe:change-input',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.cards.includes('fee')),
    run: () => {
      spec.actor = 'a';
    },
  });
  const paid = watchOrder(game, Cost.paid);
  expect(await game.room.run('pay', (ctx) => pay(ctx, spec))).toMatchObject({
    kind: 'resolved',
    value: { kind: 'paid', receipt: { actor: 'c' } },
  });
  expect(spec.actor).toBe('a');
  expect(paid).toEqual(['c', 'd', 'a', 'b']);
  expect(game.room.world.position('fee')).toBe('discard');
});

it('救援 b 时，受伤的 a 不能把这次桃改用于自己；合法救援仍经真实濒死流程', async () => {
  const game = cardGame({ hands: { a: [card('peach', 'peach', 'heart')] } });
  await game.room.run('wound-a', (ctx) => loseHp(ctx, { player: 'a', amount: 1, reason: 'probe' }));
  game.room.on(Dying.rescue, {
    id: 'probe:rescue',
    owner: null,
    group: 'rescue',
    eligible: () => true,
    async run(ctx, event) {
      const intent = {
        actor: 'a',
        choice: { kind: 'physical', card: 'peach' },
        targets: ['a'],
        timing: { kind: 'rescue', dying: event.player },
      } as const;
      expect(game.book.validateUse(ctx, intent).ok).toBe(false);
      expect(ctx.world.position('peach')).toBe('a:hand');
      const rescued = await game.book.use(ctx, { ...intent, targets: [event.player] });

      expect(rescued.kind).toBe('used');
    },
  });
  await game.room.run('dying-b', (ctx) => loseHp(ctx, { player: 'b', amount: 4, reason: 'probe' }));
  expect(game.room.world.player('a').hp).toBe(3);
  expect(game.room.world.player('b')).toMatchObject({ hp: 1, alive: true });
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

/** 可信规则扩展可中止响应子流程；牌 resolver 不能把它当作玩家拒绝。 */
class InterruptedResponseBook extends CardBook {
  #requests = 0;
  readonly actors: string[] = [];
  constructor(
    skills: SkillBook,
    readonly interruptAt: number,
  ) {
    super(standardCards, skills);
  }
  override respond(ctx: Context, actor: string, names: readonly string[], target: EffectRef) {
    this.#requests++;
    this.actors.push(actor);
    return this.#requests === this.interruptAt
      ? ctx.flow<ResponseResult>('probe:interrupted-response', (at) =>
          at.abort('author:response-interrupted'),
        )
      : super.respond(ctx, actor, names, target);
  }
}
function interruptedDuel(interruptAt: number, definitions: readonly SkillDefinition[] = []) {
  const seed = worldSeed();
  const initial = {
    ...seed,
    cards: seed.cards.map((entry) => ({
      ...entry,
      name: entry.id === 'a1' ? 'standard:duel' : 'standard:slash',
    })),
  };
  const room = new Room({ id: 'duel-interruption', seed: 42, world: initial });
  const skills = new SkillBook(definitions);
  const book = new InterruptedResponseBook(skills, interruptAt);
  skills.attach(room);
  return { room, skills, book, initial };
}
for (const interruptAt of [1, 2]) {
  it(`决斗第 ${interruptAt} 次响应局部中止：不伪造响应失败伤害，已提交打出不撤销`, async () => {
    const { room, book, initial } = interruptedDuel(interruptAt);
    const running = room.run('use', (ctx) =>
      book.use(ctx, {
        actor: 'a',
        choice: { kind: 'physical', card: 'a1' },
        targets: ['b'],
        timing: { kind: 'effect' },
      }),
    );
    if (interruptAt === 2) await answer(room, { kind: 'physical', card: 'b1' });
    expect(await running).toMatchObject({
      kind: 'resolved',
      value: {
        kind: 'used',
        use: { effects: [{ state: 'aborted', reason: 'author:response-interrupted' }] },
      },
    });
    expect(room.world.player('a').hp).toBe(4);
    expect(room.world.player('b').hp).toBe(4);
    expect(room.history.facts(Damage.dealt)).toHaveLength(0);
    expect(room.history.facts(CardEvent.responded)).toHaveLength(interruptAt - 1);
    expect(room.world.position('a1')).toBe('discard');
    if (interruptAt === 2) expect(room.world.position('b1')).toBe('discard');
    expect(room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
    expect(rebuildWorld(initial, room.history.facts())).toEqual(room.world.snapshot);
    expect(room.status).toBe('ready');
  });
}

it('无双决斗要求 b 连续两杀：第二张流程中止不变成失败，第一张已打出保留', async () => {
  const { room, book, skills, initial } = interruptedDuel(2, [wushuang]);
  await room.run('grant', (ctx) =>
    skills.grant(ctx, { owner: 'a', skill: wushuang.id, source: { kind: 'general', id: 'probe' } }),
  );
  const running = room.run('use', (ctx) =>
    book.use(ctx, {
      actor: 'a',
      choice: { kind: 'physical', card: 'a1' },
      targets: ['b'],
      timing: { kind: 'effect' },
    }),
  );
  await answer(room, { kind: 'physical', card: 'b1' });
  expect(await running).toMatchObject({
    kind: 'resolved',
    value: { use: { effects: [{ state: 'aborted' }] } },
  });
  expect(book.actors).toEqual(['b', 'b']);
  expect(room.world.player('b').hp).toBe(4);
  expect(room.world.position('b1')).toBe('discard');
  expect(room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(rebuildWorld(initial, room.history.facts())).toEqual(room.world.snapshot);
});

it('多目标决斗只中止当前 b 效果，后续 c 的真实未提供响应仍按规则受到伤害', async () => {
  const extra = defineSkill({
    id: 'probe:duel-target',
    name: '多目标',
    triggers: [],
    modifiers: [
      modify(cardQueries.extraTargets, (_ctx, { input: use }) =>
        use.card.name === 'standard:duel' ? 1 : undefined,
      ),
    ],
  });
  const { room, book, skills, initial } = interruptedDuel(1, [extra]);
  await room.run('grant', (ctx) =>
    skills.grant(ctx, { owner: 'a', skill: extra.id, source: { kind: 'general', id: 'probe' } }),
  );
  const result = await room.run('use', (ctx) =>
    book.use(ctx, {
      actor: 'a',
      choice: { kind: 'physical', card: 'a1' },
      targets: ['b', 'c'],
      timing: { kind: 'effect' },
    }),
  );
  expect(result).toMatchObject({
    kind: 'resolved',
    value: {
      use: {
        effects: [
          { target: 'b', state: 'aborted' },
          { target: 'c', state: 'resolved' },
        ],
      },
    },
  });
  expect(room.world.player('b').hp).toBe(4);
  expect(room.world.player('c').hp).toBe(3);
  expect(room.history.facts(Damage.dealt)).toHaveLength(1);
  expect(room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(rebuildWorld(initial, room.history.facts())).toEqual(room.world.snapshot);
});

for (const hasSlash of [false, true]) {
  it(`决斗正常的${hasSlash ? '主动放弃' : '无可用杀'}仍是未响应，不被当作中止`, async () => {
    const game = cardGame({
      hands: { a: [card('duel', 'duel')], b: hasSlash ? [card('s', 'slash')] : [] },
    });
    const running = use(game, {
      actor: 'a',
      choice: { kind: 'physical', card: 'duel' },
      targets: ['b'],
      timing: { kind: 'effect' },
    });
    if (hasSlash) {
      const request = await nextRequest(game.room);
      expect(game.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
    }
    expect(await running).toMatchObject({
      kind: 'resolved',
      value: { kind: 'used', use: { effects: [{ state: 'resolved' }] } },
    });
    expect(game.room.world.player('b').hp).toBe(3);
    expect(game.room.history.facts(Damage.dealt)).toHaveLength(1);
  });
}

it('救援桃仍可治疗濒死的自己，救援装配使用的是真实用牌而非打出', async () => {
  const game = cardGame({ hands: { a: [], b: [card('self-peach', 'peach', 'heart')] } });
  installRescue(game.room, game.book);
  const running = game.room.run('dying', (ctx) =>
    loseHp(ctx, { player: 'b', amount: 4, reason: 'probe' }),
  );
  const request = await nextRequest(game.room);
  expect(request.player).toBe('b');
  expect(request.kind).toBe('use-card');
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'self-peach' }),
  ).toEqual({ kind: 'accepted' });
  await running;
  expect(game.room.world.player('b')).toMatchObject({ hp: 1, alive: true });
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});
