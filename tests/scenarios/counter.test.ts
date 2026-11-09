import type { Context } from '../../src/sdk';
import { expect, it } from 'vitest';
import { resolveCounter, ownedCards, Use, Target, Resolve } from '../../src/sdk';
import { installCounterspells, Counter } from '../../src/rules/cards/counter';
import { defineSkill } from '../../src/rules/skills/skills';
import { viewAs } from '../../src/rules/cards/types';
import { finishGame } from '../../src/rules/game/end';
import type { CounterOpportunity, UseTiming } from '../../src/rules/cards/types';
import { card, cardGame, use, die } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { CardEvent } from '../../src/sdk';

function create(count = 1) {
  const game = cardGame({
    hands: {
      a: [card('duel', 'duel')],
      b: count >= 1 ? [card('n1', 'nullification')] : [],
      c: count >= 2 ? [card('n2', 'nullification')] : [],
      d: count >= 3 ? [card('n3', 'nullification')] : [],
    },
  });
  installCounterspells(game.room);
  return game;
}
const intent = {
  actor: 'a',
  choice: { kind: 'physical', card: 'duel' },
  targets: ['b'],
  timing: { kind: 'effect' },
} as const;

it.each([1, 2, 3])('%s 层无懈嵌套为真正用牌：顺序、处理区和结算结果独立', async (count) => {
  const game = create(count);
  const order: string[] = [];
  let maxProcessing = 0;
  game.room.on(Use.declared, {
    id: 'stack',
    owner: null,
    eligible: () => true,
    run: (ctx) => {
      maxProcessing = Math.max(
        maxProcessing,
        ctx.world.snapshot.zones.filter((zone) => zone.kind === 'processing').length,
      );
    },
  });
  game.room.on(Use.finished, {
    id: 'finished',
    owner: null,
    eligible: () => true,
    run: (_ctx, use) => {
      order.push(use.card.materials[0]!);
    },
  });
  const running = use(game, intent);
  for (let i = 1; i <= count; i++) {
    const request = await nextRequest(game.room);
    expect(request).toMatchObject({
      player: ['b', 'c', 'd'][i - 1],
      kind: 'use-card',
      data: { timing: 'counter', targets: [] },
    });
    expect(
      game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: `n${i}` })
        .kind,
    ).toBe('accepted');
  }
  const result = await running;
  expect(result).toMatchObject({
    value: { use: { effects: [{ state: count % 2 ? 'cancelled' : 'resolved' }] } },
  });
  expect(game.room.world.player('b').hp).toBe(count % 2 ? 4 : 3);
  expect(order).toEqual([...Array.from({ length: count }, (_, i) => `n${count - i}`), 'duel']);
  expect(maxProcessing).toBe(count + 1);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(count + 1);
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  expect(game.room.world.snapshot.zones.filter((zone) => zone.kind === 'processing')).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('拒绝无懈后按座次继续；下一层可以重新参加，不能伪造规则生成牌', async () => {
  const game = create(2);
  const running = use(game, intent);
  const b = await nextRequest(game.room);
  game.room.decisions.cancel(b.id, b.token);
  const c = await nextRequest(game.room);
  expect(c.player).toBe('c');
  expect(
    game.room.decisions.submit(c.id, c.token, {
      kind: 'generated',
      face: { name: 'standard:nullification' },
      materials: [],
      reason: 'fake',
    }).kind,
  ).toBe('rejected');
  game.room.decisions.submit(c.id, c.token, { kind: 'physical', card: 'n2' });
  const again = await nextRequest(game.room);
  expect(again.player).toBe('b');
  game.room.decisions.submit(again.id, again.token, { kind: 'physical', card: 'n1' });
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
});

it('无懈不能主动打出，过期机会或同文本 ID 的其他局也不能复用', async () => {
  const game = create();
  const captured: { opportunity?: CounterOpportunity } = {};
  game.room.on(Counter.opening, {
    id: 'capture',
    owner: null,
    eligible: () => true,
    run: (_ctx, opportunity) => {
      captured.opportunity = opportunity;
    },
  });
  expect(
    await use(game, {
      actor: 'b',
      choice: { kind: 'physical', card: 'n1' },
      targets: [],
      timing: { kind: 'effect' },
    }),
  ).toMatchObject({ value: { kind: 'unavailable' } });
  const running = use(game, intent);
  const request = await nextRequest(game.room);
  game.room.decisions.cancel(request.id, request.token);
  await running;
  const timing: UseTiming = { kind: 'counter', opportunity: captured.opportunity! };
  expect(
    await use(game, { actor: 'b', choice: { kind: 'physical', card: 'n1' }, targets: [], timing }),
  ).toMatchObject({ value: { kind: 'unavailable' } });
  const other = create();
  expect(
    await use(other, { actor: 'b', choice: { kind: 'physical', card: 'n1' }, targets: [], timing }),
  ).toMatchObject({ value: { kind: 'unavailable' } });
  expect(game.room.world.position('n1')).toBe('b:hand');
});

it('目标效果在主组取消后不再征询无懈；机会中失去意义也不额外支付', async () => {
  for (const duringOpening of [false, true]) {
    const game = create();
    let cancel: (ctx: Context) => void = () => {};
    game.room.on(Target.confirming, {
      id: 'capture-target',
      owner: null,
      eligible: () => true,
      run: (_ctx, { effect }) => {
        cancel = (ctx) => effect.cancel(ctx, 'probe');
      },
    });
    if (duringOpening)
      game.room.on(Counter.opening, {
        id: 'cancel-in-counter',
        owner: null,
        eligible: () => true,
        run: (ctx) => cancel(ctx),
      });
    else
      game.room.on(Resolve.starting, {
        id: 'cancel-before',
        owner: null,
        eligible: () => true,
        run: (ctx) => cancel(ctx),
      });
    await use(game, intent);
    expect(game.room.world.position('n1')).toBe('b:hand');
    expect(game.room.world.player('b').hp).toBe(4);
    expect(game.room.decisions.pending).toEqual([]);
  }
});

it('转换无懈走同一用牌管线，失去来源不吞掉已经宣告的反制', async () => {
  const skill = defineSkill({
    id: 'probe:counter',
    name: '反制',
    triggers: [],
    viewAs: [
      viewAs({
        id: 'counter',
        label: '反制',
        names: () => ['standard:nullification'],
        materials: (ctx, { self }) => ownedCards(ctx.world, self.owner),
        count: { min: 1, max: 1 },
        make: () => ({ name: 'standard:nullification' }),
      }),
    ],
  });
  const game = cardGame({
    hands: { a: [card('duel', 'duel')], b: [card('cost', 'peach')] },
    skills: [skill],
  });
  installCounterspells(game.room);
  const source = { kind: 'general', id: 'b' } as const;
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'b', skill: skill.id, source }),
  );
  const instance = game.room.world.snapshot.skills[0]!.id;
  game.room.on(Use.declared, {
    id: 'lose-skill',
    owner: null,
    eligible: (_ctx, plan) => plan.card.name === 'standard:nullification',
    async run(ctx) {
      await game.skills.revoke(ctx, 'b', skill.id, source);
    },
  });
  const running = use(game, intent);
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, {
    kind: 'viewAs',
    instance,
    recipe: 'counter',
    materials: ['cost'],
  });
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('cost')).toBe('discard');
});

it('链中来源死亡仍完成已宣告无懈，终局则停止新机会并清理全部材料', async () => {
  for (const terminal of [false, true]) {
    const game = create();
    game.room.on(Use.declared, {
      id: 'after-payment',
      owner: null,
      eligible: (_ctx, use) => use.card.name === 'standard:nullification',
      async run(ctx) {
        if (terminal) await finishGame(ctx, { winners: ['a'], reason: 'probe' });
        else await die(ctx, 'b');
      },
    });
    const running = use(game, { ...intent, targets: ['c'] });
    const request = await nextRequest(game.room);
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'n1' });
    await running;
    expect(game.room.world.player('c').hp).toBe(4);
    expect(game.room.world.position('n1')).toBe('discard');
    expect(game.room.world.position('duel')).toBe('discard');
    expect(game.room.decisions.pending).toEqual([]);
  }
});

it('反制提交记录明确关联原效果与每层用牌，结果不包含生命周期闭包', async () => {
  const game = create(2);
  const subjects: string[] = [];
  game.room.on(Counter.finished, {
    id: 'subjects',
    owner: null,
    eligible: () => true,
    run: (_ctx, result) => {
      subjects.push(result.subject.kind);
    },
  });
  const running = use(game, intent);
  for (const id of ['n1', 'n2']) {
    const request = await nextRequest(game.room);
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: id });
  }
  const result = await running;
  expect(subjects).toEqual(['use', 'use', 'effect']);
  expect(() => structuredClone(result)).not.toThrow();
  const facts = game.room.history.facts(CardEvent.used);
  expect(facts[1]!.data.detail).toMatchObject({
    declaration: {
      context: { kind: 'counter', subject: { kind: 'effect', effect: { target: 'b' } } },
    },
  });
  expect(facts[2]!.data.detail).toMatchObject({
    declaration: { context: { kind: 'counter', subject: { kind: 'use' } } },
  });
});

it('自定义反制牌可替代默认无懈名称，后续层保留同一规则而不修改运行核心', async () => {
  const game = cardGame({
    hands: {
      a: [card('duel', 'duel')],
      b: [{ ...card('custom', 'nullification'), name: 'probe:counter-card' }],
    },
    definitions: [
      {
        id: 'probe:counter-card',
        type: 'trick',
        label: '反制',
        use: {
          count: { min: 0, max: 0 },
          target: () => false,
          canUse: (_ctx, { request }) =>
            request.timing.kind === 'counter' ? null : 'Counter only',
          execute: (ctx, { use }) => resolveCounter(ctx, use),
        },
      },
    ],
  });
  installCounterspells(game.room, ['probe:counter-card']);
  const running = use(game, intent);
  const request = await nextRequest(game.room);
  expect(request.data).toMatchObject({ names: ['probe:counter-card'] });
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'custom' });
  expect(await running).toMatchObject({ value: { use: { effects: [{ state: 'cancelled' }] } } });
  expect(game.room.world.player('b').hp).toBe(4);
});
