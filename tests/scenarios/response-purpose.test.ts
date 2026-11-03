import { expect, it } from 'vitest';
import { card, cardGame, use, settled } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import {
  moveCards,
  setKingdom,
  kill,
  runPhase,
  defineSkill,
  viewAs,
  Use,
  Response,
  Cost,
} from '../../src/sdk';
import type { UseTiming } from '../../src/sdk';
import { standardGeneralSkills } from '../../src/content/standard/generals';
import { CardEvent } from '../../src/sdk';
import { Damage } from '../../src/sdk';
import { Skill } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

const attack = (name = 'slash') => ({
  actor: 'a',
  choice: { kind: 'physical', card: 'attack' } as const,
  targets: name === 'slash' ? ['b'] : [],
  timing: { kind: 'effect' } as const,
});
function create(name = 'slash', prohibitResponse = false, prohibitUse = false) {
  return cardGame({
    hands: { a: [card('attack', name)], b: [card('dodge', 'jink')] },
    policy: {
      prohibitResponse: (_ctx, _actor, semantic) =>
        prohibitResponse && semantic.name === 'standard:jink',
      prohibitUse: (_ctx, _actor, semantic) => prohibitUse && semantic.name === 'standard:jink',
    },
  });
}
async function dodge(game: ReturnType<typeof create>, running: Promise<unknown>) {
  const request = await nextRequest(game.room);
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'dodge' }).kind,
  ).toBe('accepted');
  await running;
}
it('抵消杀的闪是完整使用，提交使用事实和完成时点，不伪造打出', async () => {
  const game = create();
  const completed: string[] = [];
  game.room.on(Use.finished, {
    id: 'used',
    owner: null,
    eligible: () => true,
    run(_ctx, result) {
      if (result.card.name === 'standard:jink') completed.push('use');
    },
  });
  game.room.on(Response.finished, {
    id: 'responded',
    owner: null,
    eligible: () => true,
    run(_ctx, result) {
      if (result.card.name === 'standard:jink') completed.push('response');
    },
  });
  await dodge(game, use(game, attack()));
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(0);
  expect(completed).toEqual(['use']);
  settled(game);
});
it('禁止打出闪不禁止抵消杀时使用闪', async () => {
  const game = create('slash', true);
  game.room.on(Response.requested, {
    id: 'provide',
    owner: null,
    eligible: (_ctx, request) => request.actor === 'b',
    async run(ctx, request) {
      await request.provide(ctx, { kind: 'physical', card: 'dodge' });
    },
  });
  await use(game, attack());
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('dodge')).toBe('discard');
  settled(game);
});
it('禁止使用闪不禁止万箭齐发要求的打出，实际完成类型仍为打出', async () => {
  const game = create('archery_attack', false, true);
  await dodge(game, use(game, attack('archery_attack')));
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  settled(game);
});

it('禁止使用闪时杀无法被本人闪抵消，实体与未开启的八卦判定不支付', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('dodge', 'jink')] },
    equipment: { b: [card('armor', 'eight_diagram')] },
    draw: [card('red', 'peach', 'heart')],
    policy: { prohibitUse: (_ctx, _actor, semantic) => semantic.name === 'standard:jink' },
  });
  await use(game, attack());
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('dodge')).toBe('b:hand');
  expect(game.room.world.position('red')).toBe('draw');
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  settled(game);
});
it('禁止打出闪时万箭齐发未获得响应，普通闪与八卦均不绕过', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'archery_attack')], b: [card('dodge', 'jink')] },
    equipment: { b: [card('armor', 'eight_diagram')] },
    draw: [card('red', 'peach', 'heart')],
    policy: { prohibitResponse: () => true },
  });
  await use(game, attack('archery_attack'));
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('dodge')).toBe('b:hand');
  expect(game.room.world.position('red')).toBe('draw');
  settled(game);
});
it.each(['effect', 'play'] as const)(
  '闪有使用定义也不能在没有响应机会的 %s 用途主动使用',
  async (kind) => {
    const game = create();
    await game.room.run('probe', async (ctx) => {
      if (kind === 'effect') {
        expect(
          (
            await game.book.use(ctx, {
              actor: 'b',
              choice: { kind: 'physical', card: 'dodge' },
              targets: [],
              timing: { kind: 'effect' },
            })
          ).kind,
        ).toBe('unavailable');
      } else {
        await runPhase(ctx, game.book, 'b', 'play', async (at, phase) => {
          expect(
            (
              await game.book.use(at, {
                actor: 'b',
                choice: { kind: 'physical', card: 'dodge' },
                targets: [],
                timing: { kind: 'play', owner: 'b', phase: phase.lifetime },
              })
            ).kind,
          ).toBe('unavailable');
        });
      }
    });
    expect(game.room.world.position('dodge')).toBe('b:hand');
    expect(game.room.history.facts(CardEvent.used)).toEqual([]);
    settled(game);
  },
);
it('响应使用资格只属于指定角色和活跃请求，关闭后或其他 World 不能复用', async () => {
  const game = create();
  let timing: UseTiming | undefined;
  game.room.on(Use.declared, {
    id: 'capture',
    owner: null,
    eligible: (_ctx, plan) => plan.card.name === 'standard:jink',
    run(ctx, plan) {
      timing = plan.timing;
      expect(
        game.book.validateUse(ctx, {
          actor: 'c',
          choice: {
            kind: 'generated',
            face: { name: 'standard:jink' },
            materials: [],
            reason: 'probe',
          },
          targets: [],
          timing,
        }).ok,
      ).toBe(false);
    },
  });
  await dodge(game, use(game, attack()));
  for (const room of [game.room, create().room]) {
    await room.run('stale', async (ctx) => {
      expect(
        (
          await game.book.use(ctx, {
            actor: 'b',
            choice: {
              kind: 'generated',
              face: { name: 'standard:jink' },
              materials: [],
              reason: 'probe',
            },
            targets: [],
            timing: timing!,
          })
        ).kind,
      ).toBe('unavailable');
    });
  }
  settled(game);
});

async function grant(game: ReturnType<typeof create>, owner: string, skill: string) {
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner, skill, source: { kind: 'general', id: 'probe' } }),
  );
}
it('真实倾国按使用用途转换黑色杀为闪，使用后效归本人且不提交打出', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('black', 'slash')] },
    skills: standardGeneralSkills,
  });
  await grant(game, 'b', 'standard:qingguo');
  const running = use(game, attack());
  const request = await nextRequest(game.room);
  expect(request.data).toMatchObject({ purpose: 'use' });
  const offer = (request.data as { offers: { kind: string; choice: object }[] }).offers.find(
    (item) => item.kind === 'viewAs',
  )!;
  expect(
    game.room.decisions.submit(request.id, request.token, {
      kind: 'viewAs',
      ...offer.choice,
      materials: ['black'],
    }).kind,
  ).toBe('accepted');
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(CardEvent.used)[1]?.data.detail).toMatchObject({
    actor: 'b',
    declaration: {
      card: { name: 'standard:jink', source: { kind: 'viewAs', skill: 'standard:qingguo' } },
    },
  });
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  settled(game);
});
it.each(['slash', 'archery_attack'])(
  '真实护驾响应 %s：队友打出，只有杀请求还需主公完整使用',
  async (name) => {
    const game = cardGame({
      hands: { a: [card('attack', name)], c: [card('dodge', 'jink')] },
      skills: standardGeneralSkills,
    });
    await grant(game, 'b', 'standard:hujia');
    await game.room.run('kingdom', (ctx) => {
      setKingdom(ctx, 'b', '魏');
      setKingdom(ctx, 'c', '魏');
    });
    const running = use(game, attack(name));
    const invoke = await nextRequest(game.room);
    expect(invoke.data).toMatchObject({ skill: 'standard:hujia' });
    expect(game.room.decisions.submit(invoke.id, invoke.token, true).kind).toBe('accepted');
    await dodge(game, running);
    expect(game.room.world.player('b').hp).toBe(4);
    expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
    expect(game.room.history.facts(CardEvent.responded)[0]?.data.detail).toMatchObject({
      actor: 'c',
      declaration: { beneficiary: 'b' },
    });
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(name === 'slash' ? 2 : 1);
    if (name === 'slash')
      expect(game.room.history.facts(CardEvent.used)[1]?.data.detail).toMatchObject({
        actor: 'b',
        declaration: {
          card: { source: { kind: 'generated', origin: { actor: 'c' } } },
          context: { kind: 'response' },
        },
      });
    settled(game);
  },
);
it('委托时主公禁止打出与队友禁止使用不会误伤正确的两种活动', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], c: [card('dodge', 'jink')] },
    policy: {
      prohibitResponse: (_ctx, actor) => actor === 'b',
      prohibitUse: (_ctx, actor) => actor === 'c',
    },
  });
  game.room.on(Response.requested, {
    id: 'delegate',
    owner: null,
    eligible: (_ctx, request) => request.actor === 'b',
    async run(ctx, request) {
      expect((await request.delegate(ctx, 'c')).kind).toBe('used');
    },
  });
  await dodge(game, use(game, attack()));
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  settled(game);
});
it('实际代打者禁止打出时委托失败，主公仍可自行使用闪', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('dodge', 'jink')], c: [card('other', 'jink')] },
    policy: { prohibitResponse: (_ctx, actor) => actor === 'c' },
  });
  game.room.on(Response.requested, {
    id: 'delegate',
    owner: null,
    eligible: (_ctx, request) => request.actor === 'b',
    async run(ctx, request) {
      expect((await request.delegate(ctx, 'c')).kind).toBe('unavailable');
    },
  });
  await dodge(game, use(game, attack()));
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('other')).toBe('c:hand');
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  settled(game);
});
it.each(['prohibit', 'take', 'death'] as const)(
  '供牌完成后 %s 使主公不能继续使用：实际打出保留，材料不追回',
  async (change) => {
    let prohibited = false;
    const game = cardGame({
      hands: { a: [card('attack', 'slash')], c: [card('dodge', 'jink')] },
      policy: {
        prohibitUse: (_ctx, actor, card) =>
          prohibited && actor === 'b' && card.name === 'standard:jink',
      },
    });
    game.room.on(Response.requested, {
      id: 'delegate',
      owner: null,
      eligible: (_ctx, request) => request.actor === 'b',
      async run(ctx, request) {
        await request.delegate(ctx, 'c');
      },
    });
    game.room.on(Response.finished, {
      id: 'change',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        if (change === 'prohibit') prohibited = true;
        else if (change === 'take')
          await moveCards(
            ctx,
            [
              {
                cards: ['dodge'],
                from: ctx.world.position('dodge'),
                to: 'd:hand',
                place: 'bottom',
              },
            ],
            'probe:take',
          );
        else
          await kill(ctx, {
            player: 'b',
            killer: null,
            reason: 'rule',
            cause: { kind: 'rule', seq: null, data: null },
          });
      },
    });
    await dodge(game, use(game, attack()));
    expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
    expect(game.room.world.player('b').alive).toBe(change !== 'death');
    if (change !== 'death') expect(game.room.world.player('b').hp).toBe(3);
    expect(game.room.world.position('dodge')).toBe(change === 'take' ? 'd:hand' : 'discard');
    settled(game);
  },
);
it('两层委托仍只有末端 d 打出与原请求者 b 使用，候选不重复收费', async () => {
  const game = cardGame({ hands: { a: [card('attack', 'slash')], d: [card('dodge', 'jink')] } });
  game.room.on(Response.requested, {
    id: 'delegate',
    owner: null,
    eligible: (_ctx, request) => request.actor === 'b' || request.actor === 'c',
    async run(ctx, request) {
      expect((await request.delegate(ctx, request.actor === 'b' ? 'c' : 'd')).kind).toBe('used');
    },
  });
  await dodge(game, use(game, attack()));
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.responded)[0]?.data.detail).toMatchObject({
    actor: 'd',
  });
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(game.room.history.facts(Response.delegated)).toHaveLength(2);
  for (const fact of game.room.history.facts(Response.delegated))
    expect(fact.data.detail).toMatchObject({ provider: 'd' });
  settled(game);
});
it('本人取消使用闪不支付，杀正常命中且请求关闭', async () => {
  const game = create();
  const running = use(game, attack());
  const request = await nextRequest(game.room);
  expect(request.prompt).toContain('使用闪');
  expect(game.room.decisions.cancel(request.id, request.token).kind).toBe('accepted');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('dodge')).toBe('b:hand');
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  settled(game);
});
it('连续两闪各有独立使用身份、完成和处理区，不合并为一次使用或打出', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], b: [card('dodge', 'jink'), card('second', 'jink')] },
    policy: { responseTimes: () => 2 },
  });
  const running = use(game, attack());
  const first = await nextRequest(game.room);
  expect(
    game.room.decisions.submit(first.id, first.token, { kind: 'physical', card: 'dodge' }).kind,
  ).toBe('accepted');
  const second = await nextRequest(game.room);
  expect(
    game.room.decisions.submit(second.id, second.token, { kind: 'physical', card: 'second' }).kind,
  ).toBe('accepted');
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  const uses = game.room.history.facts(CardEvent.used);
  expect(uses).toHaveLength(3);
  expect(
    new Set(
      uses.map(
        (fact) => (fact.data.detail as { declaration: { useId: string } }).declaration.useId,
      ),
    ).size,
  ).toBe(3);
  expect(game.room.history.facts(CardEvent.finished)).toHaveLength(3);
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  settled(game);
});
it('主公实际使用完成后死亡不撤销已提交使用与供牌结果，不重开请求', async () => {
  const game = cardGame({ hands: { a: [card('attack', 'slash')], c: [card('dodge', 'jink')] } });
  game.room.on(Response.requested, {
    id: 'delegate',
    owner: null,
    eligible: (_ctx, request) => request.actor === 'b',
    async run(ctx, request) {
      expect((await request.delegate(ctx, 'c')).kind).toBe('used');
    },
  });
  game.room.on(Use.finished, {
    id: 'death',
    owner: null,
    eligible: (_ctx, result) => result.card.name === 'standard:jink',
    async run(ctx) {
      await kill(ctx, {
        player: 'b',
        killer: null,
        reason: 'rule',
        cause: { kind: 'rule', seq: null, data: null },
      });
    },
  });
  await dodge(game, use(game, attack()));
  expect(game.room.world.player('b').alive).toBe(false);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(game.room.history.facts(Response.delegated)).toHaveLength(1);
  expect(game.room.history.facts(testTiming('damage.committed'))).toEqual([]);
  settled(game);
});
it('主公禁止使用闪时不诱导护驾供牌或收取发动费用', async () => {
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], c: [card('dodge', 'jink')] },
    skills: standardGeneralSkills,
    policy: { prohibitUse: (_ctx, actor, card) => actor === 'b' && card.name === 'standard:jink' },
  });
  await grant(game, 'b', 'standard:hujia');
  await game.room.run('kingdom', (ctx) => setKingdom(ctx, 'c', '魏'));
  await use(game, attack());
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('dodge')).toBe('c:hand');
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  settled(game);
});
it('出牌候选按真实时机过滤实体与多名称配方，闪和无懈不会造成空候选等待', async () => {
  const recipe = defineSkill({
    id: 'probe:timing',
    name: '时机配方',
    triggers: [],
    viewAs: [
      viewAs({
        id: 'many',
        label: '多名称',
        names: () => ['standard:jink', 'standard:slash', 'standard:nullification'],
        materials: () => [],
        count: { min: 0, max: 0 },
        make: () => ({ name: 'standard:slash' }),
      }),
    ],
  });
  const game = cardGame({
    hands: { a: [], b: [card('jink', 'jink'), card('counter', 'nullification')] },
    skills: [recipe],
  });
  await grant(game, 'b', recipe.id);
  await game.room.run('timing', (ctx) =>
    runPhase(ctx, game.book, 'b', 'play', (at, phase) => {
      const offers = game.book.offers(at, 'b', phase.playTiming());
      expect(offers).toHaveLength(1);
      expect(offers[0]!.names).toEqual(['standard:slash']);
    }),
  );
  await game.room.run('revoke', (ctx) =>
    game.skills.revoke(ctx, 'b', recipe.id, { kind: 'general', id: 'probe' }),
  );
  await game.room.run('no-playable', (ctx) => runPhase(ctx, game.book, 'b', 'play'));
  expect(game.room.history.facts(CardEvent.used)).toEqual([]);
  settled(game);
});
it('护驾已发动后主公被禁止使用闪，供牌前再次检查并保留队友牌', async () => {
  let prohibited = false;
  const game = cardGame({
    hands: { a: [card('attack', 'slash')], c: [card('dodge', 'jink')] },
    skills: standardGeneralSkills,
    policy: {
      prohibitUse: (_ctx, actor, card) =>
        prohibited && actor === 'b' && card.name === 'standard:jink',
    },
  });
  await grant(game, 'b', 'standard:hujia');
  await game.room.run('kingdom', (ctx) => setKingdom(ctx, 'c', '魏'));
  game.room.on(Cost.paid, {
    id: 'prohibit',
    owner: null,
    eligible: (_ctx, receipt) => receipt.skill === 'standard:hujia',
    run() {
      prohibited = true;
    },
  });
  const running = use(game, attack());
  const request = await nextRequest(game.room);
  expect(game.room.decisions.submit(request.id, request.token, true).kind).toBe('accepted');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('dodge')).toBe('c:hand');
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  settled(game);
});
it('响应中的使用局部中止向上延续，不伪造缺闪伤害或撤销已提交材料', async () => {
  const game = create();
  game.room.on(Use.declared, {
    id: 'interrupt',
    owner: null,
    eligible: (_ctx, plan) => plan.card.name === 'standard:jink',
    run(ctx) {
      ctx.abort('probe:jink-interrupted');
    },
  });
  await dodge(game, use(game, attack()));
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('dodge')).toBe('discard');
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
  expect(game.room.history.facts(Damage.dealt)).toEqual([]);
  settled(game);
});
