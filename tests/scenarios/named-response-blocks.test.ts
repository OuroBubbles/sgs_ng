import { expect, it } from 'vitest';
import { standardGeneralSkills } from '../../src/content/standard/generals';
import {
  effectReference,
  isResponseBlocked,
  pay,
  defineSkill,
  modify,
  cardQueries,
  Use,
  Resolve,
  Response,
} from '../../src/sdk';
import { qingguo } from '../../src/content/standard/generals/zhenji';
import type { CardEffect } from '../../src/sdk';
import { card, cardGame, use, settled } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Skill } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

const attack = {
  actor: 'a',
  choice: { kind: 'physical', card: 'attack' },
  targets: ['b'],
  timing: { kind: 'effect' },
} as const;
function create() {
  return cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('dodge', 'jink'), card('answer', 'slash')] },
  });
}

it('只禁闪时混合请求仅开放杀，真实打出与原杀受伤分别成立', async () => {
  const game = create();
  game.room.on(Response.requested, {
    id: 'provide-slash',
    owner: null,
    eligible: () => true,
    async run(ctx, request) {
      expect(request.names).toEqual(['standard:slash']);
      expect(request.canProvide(ctx, { kind: 'physical', card: 'dodge' })).toBe(false);
      expect(request.canProvide(ctx, { kind: 'physical', card: 'answer' })).toBe(true);
      expect((await request.provide(ctx, { kind: 'physical', card: 'answer' })).kind).toBe(
        'responded',
      );
    },
  });
  game.room.on(Resolve.starting, {
    id: 'mixed-response',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'probe:only-jink', ['standard:jink']);
      expect(
        await game.book.respond(ctx, 'b', ['standard:jink', 'standard:slash'], effect),
      ).toMatchObject({ kind: 'responded', actor: 'b', card: { name: 'standard:slash' } });
    },
  });
  expect(await use(game, attack)).toMatchObject({
    value: {
      kind: 'used',
      use: {
        effects: [
          { responseBlocks: [{ actor: 'b', names: ['standard:jink'], reason: 'probe:only-jink' }] },
        ],
      },
    },
  });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('dodge')).toBe('b:hand');
  expect(game.room.world.position('answer')).toBe('discard');
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  settled(game);
});

it('红判铁骑只禁止本次效果的闪，不拦截作者在同效果下另行请求的杀', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('dodge', 'jink'), card('answer', 'slash')] },
    draw: [card('red', 'peach', 'heart')],
    skills: standardGeneralSkills,
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, {
      owner: 'a',
      skill: 'standard:tieqi',
      source: { kind: 'general', id: 'machao' },
    }),
  );
  game.room.on(Response.requested, {
    id: 'author-supply',
    owner: null,
    eligible: () => true,
    async run(ctx, request) {
      await request.provide(ctx, { kind: 'physical', card: 'answer' });
    },
  });
  game.room.on(Resolve.starting, {
    id: 'author-asks-slash',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      expect((await game.book.respond(ctx, 'b', ['standard:slash'], effect)).kind).toBe(
        'responded',
      );
      expect((await game.book.respond(ctx, 'b', ['standard:jink'], effect)).kind).toBe(
        'unavailable',
      );
    },
  });
  const running = use(game, attack);
  const request = await nextRequest(game.room);
  expect(request.data).toMatchObject({ skill: 'standard:tieqi' });
  expect(game.room.decisions.submit(request.id, request.token, true).kind).toBe('accepted');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('dodge')).toBe('b:hand');
  expect(game.room.world.position('answer')).toBe('discard');
  settled(game);
});

it('响应次数按实际请求牌名查询，禁闪不把杀次数归零，政策可区分名称', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')] },
    policy: { responseTimes: (_ctx, _effect, _actor, name) => (name === 'standard:slash' ? 2 : 1) },
  });
  game.room.on(Resolve.starting, {
    id: 'count',
    owner: null,
    eligible: () => true,
    run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'probe:only-jink', ['standard:jink']);
      expect(game.book.responseTimes(ctx, effect, 'b', 'standard:jink')).toBe(0);
      expect(game.book.responseTimes(ctx, effect, 'b', 'standard:slash')).toBe(2);
      expect(game.book.responseTimes(ctx, effect, 'c', 'standard:jink')).toBe(1);
    },
  });
  await use(game, attack);
  settled(game);
});

it('一次真实供牌完成便关闭待决供牌窗口，后续候选不能再次索取费用', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('answer', 'slash')], c: [card('fee', 'jink')] },
  });
  game.room.on(Resolve.starting, {
    id: 'probe',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'no-jink', ['standard:jink']);
      expect((await game.book.respond(ctx, 'b', ['standard:slash'], effect)).kind).toBe(
        'responded',
      );
    },
  });
  game.room.on(Response.requested, {
    id: 'a-supply',
    owner: null,
    eligible: () => true,
    async run(ctx, request) {
      await request.provide(ctx, { kind: 'physical', card: 'answer' });
    },
  });
  game.room.on(Response.requested, {
    id: 'b-late-cost',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      ctx.commit(testTiming('test.extra-provider'), [], null);
      await pay(ctx, { actor: 'c', cards: ['fee'], to: 'discard', reason: 'late-provider' });
    },
  });
  await use(game, attack);
  expect(game.room.history.facts(testTiming('test.extra-provider'))).toEqual([]);
  expect(game.room.world.position('fee')).toBe('c:hand');
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  settled(game);
});

it('混合请求的菜单和最终回复仅允许未被禁用的牌，八卦不为已禁闪开启判定', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('dodge', 'jink'), card('answer', 'slash')] },
    equipment: { b: [card('armor', 'eight_diagram')] },
    draw: [card('red', 'peach', 'heart')],
  });
  game.room.on(Resolve.starting, {
    id: 'mixed',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'no-jink', ['standard:jink']);
      expect(
        (await game.book.respond(ctx, 'b', ['standard:jink', 'standard:slash'], effect)).kind,
      ).toBe('responded');
    },
  });
  const running = use(game, attack);
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('card-response');
  expect(request.data).toMatchObject({ names: ['standard:slash'] });
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'dodge' }).kind,
  ).toBe('rejected');
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'answer' })
      .kind,
  ).toBe('accepted');
  await running;
  expect(game.room.world.zone('draw').cards).toEqual(['red']);
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  expect(game.room.history.facts(Response.requested)[0]!.data.detail).toMatchObject({
    requestedNames: ['standard:jink', 'standard:slash'],
    names: ['standard:slash'],
  });
  settled(game);
});

it('具名禁令按语义响应牌判断，倾国不能把被禁闪伪装成未禁用的黑色实体杀', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('answer', 'slash')] },
    skills: [qingguo],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, {
      owner: 'b',
      skill: qingguo.id,
      source: { kind: 'general', id: 'zhenji' },
    }),
  );
  const instance = game.room.world.snapshot.skills[0]!.id;
  game.room.on(Response.requested, {
    id: 'semantic',
    owner: null,
    eligible: () => true,
    async run(ctx, request) {
      expect(
        request.canProvide(ctx, {
          kind: 'viewAs',
          instance,
          recipe: 'black-jink',
          materials: ['answer'],
        }),
      ).toBe(false);
      expect((await request.provide(ctx, { kind: 'physical', card: 'answer' })).kind).toBe(
        'responded',
      );
    },
  });
  game.room.on(Resolve.starting, {
    id: 'mixed',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'no-jink', ['standard:jink']);
      await game.book.respond(ctx, 'b', ['standard:jink', 'standard:slash'], effect);
    },
  });
  await use(game, attack);
  expect(game.room.history.facts(CardEvent.responded)[0]!.data.detail).toMatchObject({
    declaration: { card: { name: 'standard:slash', source: null } },
  });
  settled(game);
});

it('委托不能扩展已过滤的名称，禁令归属仍是受益者，实际代打者保留独立身份', async () => {
  const game = cardGame({
    hands: {
      a: [card('attack', 'slash')],
      b: [card('dodge', 'jink')],
      c: [card('supply', 'slash')],
    },
  });
  const seen: string[] = [];
  game.room.on(Response.requested, {
    id: 'delegate',
    owner: null,
    eligible: () => true,
    async run(ctx, request) {
      seen.push(request.actor);
      expect(request.beneficiary).toBe('b');
      expect(request.names).toEqual(['standard:slash']);
      if (request.actor === 'b') {
        expect((await request.delegate(ctx, 'c', ['standard:jink'])).kind).toBe('unavailable');
        expect(await request.delegate(ctx, 'c', request.names)).toMatchObject({
          kind: 'responded',
          actor: 'c',
        });
      } else await request.provide(ctx, { kind: 'physical', card: 'supply' });
    },
  });
  game.room.on(Resolve.starting, {
    id: 'mixed',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'no-jink', ['standard:jink']);
      // c 不能为自己响应此效果，并不等于 c 被禁止替 b 打出牌。
      effect.blockResponses(ctx, 'c', 'c-cannot-answer', ['standard:slash']);
      await game.book.respond(ctx, 'b', ['standard:jink', 'standard:slash'], effect);
    },
  });
  await use(game, attack);
  expect(seen).toEqual(['b', 'c']);
  expect(game.room.history.facts(CardEvent.responded)[0]!.data.detail).toMatchObject({
    actor: 'c',
    declaration: { beneficiary: 'b' },
  });
  expect(game.room.world.position('supply')).toBe('discard');
  expect(game.room.world.position('dodge')).toBe('b:hand');
  settled(game);
});

it('实际代打者的禁止打出查询仍生效，委托失败后原请求继续并能由本人响应', async () => {
  const forbidden = defineSkill({
    id: 'probe:no-supply',
    name: '不能供杀',
    triggers: [],
    modifiers: [
      modify(cardQueries.prohibitResponse, (_ctx, { input: request, self }) =>
        request.actor === self.owner && request.card.name === 'standard:slash' ? true : undefined,
      ),
    ],
  });
  const game = cardGame({
    hands: {
      a: [card('attack', 'slash')],
      b: [card('answer', 'slash')],
      c: [card('supply', 'slash')],
    },
    skills: [forbidden],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, {
      owner: 'c',
      skill: forbidden.id,
      source: { kind: 'general', id: 'probe' },
    }),
  );
  game.room.on(Response.requested, {
    id: 'a-delegate',
    owner: null,
    eligible: (_ctx, request) => request.actor === 'b',
    async run(ctx, request) {
      expect((await request.delegate(ctx, 'c')).kind).toBe('unavailable');
      expect(request.available(ctx)).toBe(true);
    },
  });
  game.room.on(Response.requested, {
    id: 'b-fallback',
    owner: null,
    eligible: (_ctx, request) => request.actor === 'b',
    async run(ctx, request) {
      await request.provide(ctx, { kind: 'physical', card: 'answer' });
    },
  });
  game.room.on(Resolve.starting, {
    id: 'mixed',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'no-jink', ['standard:jink']);
      await game.book.respond(ctx, 'b', ['standard:slash'], effect);
    },
  });
  await use(game, attack);
  expect(game.room.world.position('supply')).toBe('c:hand');
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.responded)[0]!.data.detail).toMatchObject({
    actor: 'b',
  });
  settled(game);
});

it.each([undefined, null] as const)(
  '省略牌名或显式 null 仍是全部禁止，不开放供牌窗口：%s',
  async (names) => {
    const game = create();
    let opened = 0;
    game.room.on(Response.requested, {
      id: 'spy',
      owner: null,
      eligible: () => true,
      run: () => {
        opened++;
      },
    });
    game.room.on(Resolve.starting, {
      id: 'all',
      owner: null,
      eligible: () => true,
      async run(ctx, { effect }) {
        effect.blockResponses(ctx, 'b', 'all', names);
        expect(
          (await game.book.respond(ctx, 'b', ['standard:jink', 'standard:slash'], effect)).kind,
        ).toBe('unavailable');
        for (const name of ['standard:jink', 'standard:slash'])
          expect(game.book.responseTimes(ctx, effect, 'b', name)).toBe(0);
      },
    });
    expect(await use(game, attack)).toMatchObject({
      value: { use: { effects: [{ responseBlocks: [{ names: null }] }] } },
    });
    expect(opened).toBe(0);
    settled(game);
  },
);

it('多个具名禁令取并集，均被禁止时不询问、不收集供牌来源或计算响应次数', async () => {
  let counts = 0;
  let collections = 0;
  const game = cardGame({
    hands: { a: [card('attack', 'slash')] },
    policy: {
      responseTimes: () => {
        counts++;
        return 1;
      },
    },
  });
  game.room.addTriggerSource({
    collect(type) {
      if (type === Response.requested) collections++;
      return [];
    },
  });
  let opened = 0;
  game.room.on(Response.requested, {
    id: 'spy',
    owner: null,
    eligible: () => true,
    run: () => {
      opened++;
    },
  });
  game.room.on(Resolve.starting, {
    id: 'union',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'first', ['standard:jink']);
      effect.blockResponses(ctx, 'b', 'second', ['standard:slash']);
      expect(
        (await game.book.respond(ctx, 'b', ['standard:jink', 'standard:slash'], effect)).kind,
      ).toBe('unavailable');
    },
  });
  await use(game, attack);
  expect(opened).toBe(0);
  expect(counts).toBe(0);
  expect(collections).toBe(0);
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  settled(game);
});

it.each([[], [''], ['  '], ['standard:jink', 'standard:jink'], [1]].map((names) => ({ names })))(
  '非法具名禁令拒绝整次改写，不留下半条记录：$names',
  async ({ names }) => {
    const game = cardGame({ hands: { a: [card('attack', 'slash')] } });
    game.room.on(Resolve.starting, {
      id: 'validate',
      owner: null,
      eligible: () => true,
      run(ctx, { effect }) {
        const revision = ctx.world.snapshot.revision;
        expect(() =>
          effect.blockResponses(ctx, 'b', 'bad', names as unknown as readonly string[]),
        ).toThrow(/distinct nonempty/);
        expect(effect.responseBlocks).toEqual([]);
        expect(ctx.world.snapshot.revision).toBe(revision);
      },
    });
    await use(game, attack);
    settled(game);
  },
);

it('具名列表在宣告时复制并冻结，纯查询/封口后不能改写，原因保留在事实快照', async () => {
  const game = create();
  const names = ['standard:jink'];
  let held: CardEffect | undefined;
  game.room.on(Resolve.starting, {
    id: 'snapshot',
    owner: null,
    eligible: () => true,
    run(ctx, { effect }) {
      held = effect;
      expect(() => ctx.query(() => effect.blockResponses(ctx, 'b', 'impure', names))).toThrow(
        /Pure queries/,
      );
      effect.blockResponses(ctx, 'b', 'named', names);
      names[0] = 'standard:slash';
      const frozen = effectReference(effect);
      expect(isResponseBlocked(frozen, 'b', 'standard:jink')).toBe(true);
      expect(isResponseBlocked(frozen, 'b', 'standard:slash')).toBe(false);
      expect(Object.isFrozen(frozen.responseBlocks![0]!.names)).toBe(true);
    },
  });
  expect(await use(game, attack)).toMatchObject({
    value: {
      use: { effects: [{ responseBlocks: [{ names: ['standard:jink'], reason: 'named' }] }] },
    },
  });
  await game.room.run('late', (ctx) => {
    expect(() => held!.blockResponses(ctx, 'b', 'late', ['standard:slash'])).toThrow();
  });
  settled(game);
});

it('禁令只属于指定效果与响应角色，多目标的另一人仍可正常打闪', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('bj', 'jink')], c: [card('cj', 'jink')] },
    policy: { attackRange: () => 3 },
  });
  game.room.on(Use.declared, {
    id: 'extra-target',
    owner: null,
    eligible: (_ctx, plan) => plan.card.name === 'standard:slash',
    run(ctx, plan) {
      plan.addTarget(ctx, 'c', 'probe');
    },
  });
  game.room.on(Resolve.starting, {
    id: 'block-b',
    owner: null,
    eligible: (_ctx, event) => event.effect.target === 'b',
    run(ctx, { effect }) {
      effect.blockResponses(ctx, 'b', 'b-only', ['standard:jink']);
    },
  });
  game.room.on(Response.requested, {
    id: 'provide',
    owner: null,
    eligible: () => true,
    async run(ctx, request) {
      expect(request.actor).toBe('c');
      await request.provide(ctx, { kind: 'physical', card: 'cj' });
    },
  });
  await use(game, attack);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.player('c').hp).toBe(4);
  expect(game.room.world.position('bj')).toBe('b:hand');
  expect(game.room.world.position('cj')).toBe('discard');
  settled(game);
});

it('纯查询修正可按响应牌名计算次数，具名禁止仍优先于追加最低要求', async () => {
  const named = defineSkill({
    id: 'probe:named-count',
    name: '具名次数',
    triggers: [],
    modifiers: [
      modify(cardQueries.responseCount, (_ctx, { input: request }) =>
        request.name === 'standard:slash' ? 3 : undefined,
      ),
    ],
  });
  const game = cardGame({ hands: { a: [card('attack', 'slash')] }, skills: [named] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, {
      owner: 'a',
      skill: named.id,
      source: { kind: 'general', id: 'probe' },
    }),
  );
  game.room.on(Resolve.starting, {
    id: 'counts',
    owner: null,
    eligible: () => true,
    run(ctx, { effect }) {
      effect.requireResponses(ctx, 'b', 2, 'minimum');
      expect(ctx.query(() => game.book.responseTimes(ctx, effect, 'b', 'standard:jink'))).toBe(2);
      expect(game.book.responseTimes(ctx, effect, 'b', 'standard:slash')).toBe(3);
      effect.blockResponses(ctx, 'b', 'only-jink', ['standard:jink']);
      expect(game.book.responseTimes(ctx, effect, 'b', 'standard:jink')).toBe(0);
      expect(game.book.responseTimes(ctx, effect, 'b', 'standard:slash')).toBe(3);
    },
  });
  await use(game, attack);
  settled(game);
});
