import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import keji from '../../src/content/standard/skills/keji';
import guicai from '../../src/content/standard/skills/guicai';
import {
  activePhase,
  activeTurn,
  cardActivities,
  judge,
  runPhase,
  runTurn,
  Lifetime,
  Phase,
  Turn,
  useCard,
} from '../../src/sdk';
import type { CardActivity, Context, PhaseView } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame } from '../fixtures/cards';
import { CardEvent } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

type Game = ReturnType<typeof cardGame>;
const extra = { kind: 'extra', id: 'nested', reason: 'author:inserted-turn' } as const;
async function create(hand = [card('hit', 'slash')]) {
  const game = cardGame({ hands: { a: hand }, skills: [keji] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, {
      owner: 'a',
      skill: keji.id,
      source: { kind: 'general', id: 'lumeng' },
    }),
  );
  return game;
}
async function slash(ctx: Context, phase?: PhaseView, id = 'hit') {
  expect(
    (
      await useCard(ctx, {
        actor: 'a',
        choice: { kind: 'physical', card: id },
        targets: ['b'],
        timing: phase?.playTiming() ?? { kind: 'effect' },
      })
    ).kind,
  ).toBe('used');
}
function outer(game: Game, body: (ctx: Context, phase: PhaseView) => Promise<void>) {
  return game.room.run('outer-turn', (ctx) =>
    runTurn(ctx, 'a', {
      phases: ['play', 'discard'],
      async body(at, phase) {
        if (phase.kind === 'play') await body(at, phase);
        else at.commit(testTiming('test.discard-body'), [], null);
      },
    }),
  );
}
async function complete(
  game: Game,
  running: Promise<unknown>,
  invokes: number,
  replies: readonly { readonly kind: string; readonly value: unknown }[] = [],
) {
  let done = false;
  let questions = 0;
  let answered = 0;
  let failure: unknown = null;
  const completion = running.then(
    () => {
      done = true;
    },
    (error: unknown) => {
      failure = error;
      done = true;
    },
  );
  try {
    for (let step = 0; !done && step < 10_000; step++) {
      await setImmediate();
      const request = game.room.decisions.pending[0];
      if (!request) continue;
      if (request.kind !== 'invoke') {
        const reply = replies[answered++];
        expect(request.kind).toBe(reply?.kind);
        expect(game.room.decisions.submit(request.id, request.token, reply?.value).kind).toBe(
          'accepted',
        );
        continue;
      }
      expect(request.kind).toBe('invoke');
      expect(request.data).toMatchObject({ skill: keji.id });
      expect(game.room.decisions.submit(request.id, request.token, true).kind).toBe('accepted');
      questions++;
    }
    expect(done).toBe(true);
    await completion;
    if (failure !== null)
      throw failure instanceof Error
        ? failure
        : new Error('Non-Error test rejection.', { cause: failure });
    expect(questions).toBe(invokes);
    expect(answered).toBe(replies.length);
    expect(game.room.history.facts(testTiming('test.discard-body'))).toHaveLength(
      Number(invokes === 0),
    );
    expect(game.room.decisions.pending).toEqual([]);
    expect(activeTurn.of(game.room.world)).toBeNull();
    expect(activePhase.of(game.room.world)).toBeNull();
    expect(game.room.world.snapshot.states.filter((state) => state.scopeId !== null)).toEqual([]);
    expect(game.room.world.position('hit')).toBe('discard');
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  } finally {
    if (!done) game.room.abort('test cleanup');
    await completion;
  }
}

it.each(['a', 'b'])('外层克己不计入嵌套 %s 的额外回合中的真实杀，因果祖先仍保留', async (owner) => {
  const game = await create();
  const running = outer(game, async (ctx) => {
    await runTurn(ctx, owner, {
      phases: ['play'],
      origin: extra,
      body: (at, phase) => slash(at, owner === 'a' ? phase : undefined),
    });
  });
  await complete(game, running, 1);
});

it('出牌阶段开始前由规则使用的杀不计入该出牌阶段，之后仍可克己', async () => {
  const game = await create();
  game.room.on(Phase.before, {
    id: 'pre-phase-slash',
    owner: null,
    eligible: (_ctx, phase) => phase.kind === 'play',
    run: (ctx) => slash(ctx),
  });
  await complete(
    game,
    outer(game, async () => {}),
    1,
  );
});

it('外层出牌阶段内嵌的判定阶段中用杀，不算实际出牌阶段活动', async () => {
  const game = await create();
  await complete(
    game,
    outer(game, async (ctx) => {
      await runPhase(ctx, 'a', 'judge', (at) => slash(at));
    }),
    1,
  );
});

it('出牌阶段生存期已结束后的后效用杀，不再计入已关闭的阶段', async () => {
  const game = await create();
  game.room.on(Lifetime.ended, {
    id: 'after-phase-slash',
    owner: null,
    eligible: (_ctx, ended) => ended.kind === 'play',
    run: (ctx) => slash(ctx),
  });
  await complete(
    game,
    outer(game, async () => {}),
    1,
  );
});

it('空嵌套回合的开始效果用杀，不借尚在因果路径中的外层出牌阶段', async () => {
  const game = await create();
  game.room.on(Turn.started, {
    id: 'nested-start-slash',
    owner: null,
    eligible: (_ctx, turn) => turn.origin.kind === 'extra',
    run: (ctx) => slash(ctx),
  });
  await complete(
    game,
    outer(game, async (ctx) => {
      await runTurn(ctx, 'a', { phases: [], origin: extra });
    }),
    1,
  );
});

it('本回合实际出牌阶段使用杀仍禁止克己，关闭阶段不会倒改已记录的归属', async () => {
  const game = await create();
  let during: readonly CardActivity[] = [];
  let turnId: string | null = null;
  let phaseId = '';
  await complete(
    game,
    outer(game, async (ctx, phase) => {
      turnId = phase.turn!.id;
      phaseId = phase.id;
      await slash(ctx, phase);
      during = cardActivities(ctx.history.facts());
    }),
    0,
  );
  expect(during).toHaveLength(1);
  expect(during[0]).toMatchObject({ turnId, phase: { id: phaseId, owner: 'a', kind: 'play' } });
  expect(cardActivities(game.room.history.facts())).toEqual(during);
  expect(Object.isFrozen(during)).toBe(true);
  expect(Object.isFrozen(during[0]!.phase)).toBe(true);
});

it.each([false, true])('普通响应的实际回合/阶段来自打出时点，嵌套回合=%s', async (nested) => {
  const game = cardGame({
    hands: { a: [card('hit', 'slash')], b: [card('duel', 'duel')] },
    skills: [keji],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, {
      owner: 'a',
      skill: keji.id,
      source: { kind: 'general', id: 'lumeng' },
    }),
  );
  let responseTurn = '';
  let responsePhase = '';
  const duel = async (ctx: Context, phase: PhaseView) => {
    responseTurn = phase.turn!.id;
    responsePhase = phase.id;
    await useCard(ctx, {
      actor: 'b',
      choice: { kind: 'physical', card: 'duel' },
      targets: ['a'],
      timing: { kind: 'effect' },
    });
  };
  await complete(
    game,
    outer(game, async (ctx, phase) => {
      if (nested) await runTurn(ctx, 'a', { phases: ['play'], origin: extra, body: duel });
      else await duel(ctx, phase);
    }),
    Number(nested),
    [{ kind: 'card-response', value: { kind: 'physical', card: 'hit' } }],
  );
  const responses = cardActivities(game.room.history.facts()).filter(
    (entry) => entry.kind === 'response',
  );
  expect(responses).toHaveLength(1);
  expect(responses[0]).toMatchObject({
    actor: 'a',
    turnId: responseTurn,
    phase: { id: responsePhase, kind: 'play' },
  });
});

it('嵌套判定阶段中鬼才打出的杀归属实际判定阶段，不漏打出也不污染克己', async () => {
  const game = cardGame({
    hands: { a: [card('hit', 'slash')] },
    draw: [card('top', 'jink')],
    skills: [keji, guicai],
  });
  await game.room.run('grant', async (ctx) => {
    for (const skill of [keji.id, 'standard:guicai'])
      await game.skills.grant(ctx, {
        owner: 'a',
        skill,
        source: { kind: 'general', id: 'probe' },
      });
  });
  let phaseId = '';
  await complete(
    game,
    outer(game, async (ctx) => {
      await runPhase(ctx, 'a', 'judge', async (at, phase) => {
        phaseId = phase.id;
        await judge(at, { player: 'b', reason: 'probe', match: () => true });
      });
    }),
    1,
    [{ kind: 'cards-targets', value: { cards: ['hit'], targets: [] } }],
  );
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  expect(
    cardActivities(game.room.history.facts()).filter((entry) => entry.kind === 'response'),
  ).toMatchObject([{ actor: 'a', phase: { id: phaseId, owner: 'a', kind: 'judge' } }]);
});

it('窄因果作用域查询仍保留外部祖先的回合/阶段归属，纯事实历史可重建同一投影', async () => {
  const game = await create();
  let activityScope = '';
  let initial: readonly CardActivity[] = [];
  await complete(
    game,
    outer(game, async (ctx, phase) => {
      await ctx.flow('author:ordinary-child', async (child) => {
        activityScope = child.scope.id;
        await slash(child, phase);
        initial = cardActivities(child.history.facts(), activityScope);
      });
    }),
    0,
  );
  const facts = game.room.history.facts();
  expect(initial).toHaveLength(1);
  expect(initial[0]!.turnId).not.toBeNull();
  expect(initial[0]!.phase?.kind).toBe('play');
  expect(cardActivities(facts, activityScope)).toEqual(initial);
  expect(cardActivities(facts, 'unrelated-scope')).toEqual([]);
});

it('独立阶段有阶段身份但不伪造回合；独立根用牌两个归属均为空', async () => {
  const game = cardGame({ hands: { a: [card('first', 'slash'), card('second', 'slash')] } });
  let phaseId = '';
  await game.room.run('independent-phase', (ctx) =>
    runPhase(ctx, 'a', 'play', async (at, phase) => {
      phaseId = phase.id;
      await useCard(at, {
        actor: 'a',
        choice: { kind: 'physical', card: 'first' },
        targets: ['b'],
        timing: phase.playTiming(),
      });
    }),
  );
  await game.room.run('independent-use', (ctx) =>
    useCard(ctx, {
      actor: 'a',
      choice: { kind: 'physical', card: 'second' },
      targets: ['b'],
      timing: { kind: 'effect' },
    }),
  );
  expect(cardActivities(game.room.history.facts())).toMatchObject([
    { turnId: null, phase: { id: phaseId, owner: 'a', kind: 'play' } },
    { turnId: null, phase: null },
  ]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('嵌套回合返回后恢复外层实际出牌阶段，之后真正使用杀仍禁止外层克己', async () => {
  const game = await create([card('hit', 'slash'), card('outer', 'slash')]);
  let outerTurn = '';
  let outerPhase = '';
  let innerTurn = '';
  let innerPhase = '';
  await complete(
    game,
    outer(game, async (ctx, phase) => {
      outerTurn = phase.turn!.id;
      outerPhase = phase.id;
      await runTurn(ctx, 'a', {
        phases: ['play'],
        origin: extra,
        async body(at, nested) {
          innerTurn = nested.turn!.id;
          innerPhase = nested.id;
          await slash(at, nested);
        },
      });
      await slash(ctx, phase, 'outer');
    }),
    0,
  );
  const activities = cardActivities(game.room.history.facts());
  expect(activities).toMatchObject([
    { turnId: innerTurn, phase: { id: innerPhase } },
    { turnId: outerTurn, phase: { id: outerPhase } },
  ]);
  expect(activities[0]!.scopePath).toEqual(
    expect.arrayContaining([outerTurn, outerPhase, innerTurn, innerPhase]),
  );
});

it('同一回合嵌套的真实出牌阶段仍属于本回合，不能误排除而允许克己', async () => {
  const game = await create();
  let turnId = '';
  let phaseId = '';
  await complete(
    game,
    outer(game, async (ctx, phase) => {
      turnId = phase.turn!.id;
      await runPhase(
        ctx,
        'a',
        'play',
        async (at, nested) => {
          phaseId = nested.id;
          await slash(at, nested);
        },
        phase.turn,
      );
    }),
    0,
  );
  expect(cardActivities(game.room.history.facts())[0]).toMatchObject({
    turnId,
    phase: { id: phaseId, kind: 'play' },
  });
});

it('内层阶段开始前的用牌不穿透到暂停的外层出牌阶段', async () => {
  const game = await create();
  game.room.on(Phase.before, {
    id: 'inner-before',
    owner: null,
    eligible: (_ctx, phase) => phase.kind === 'draw',
    run: (ctx) => slash(ctx),
  });
  let turnId = '';
  await complete(
    game,
    outer(game, async (ctx, phase) => {
      turnId = phase.turn!.id;
      await runPhase(ctx, 'a', 'draw', () => {});
    }),
    1,
  );
  expect(cardActivities(game.room.history.facts())[0]).toMatchObject({ turnId, phase: null });
});

it.each(['play', 'turn'])('普通 Flow 即使命名为 %s，也不伪装成新的领域阶段/回合', async (kind) => {
  const game = await create();
  let turnId = '';
  let phaseId = '';
  await complete(
    game,
    outer(game, async (ctx, phase) => {
      turnId = phase.turn!.id;
      phaseId = phase.id;
      await ctx.flow(kind, (child) => slash(child, phase));
    }),
    0,
  );
  expect(cardActivities(game.room.history.facts())[0]).toMatchObject({
    turnId,
    phase: { id: phaseId, kind: 'play' },
  });
});

it('嵌套回合生存期结束后的后效不穿透到外层回合/阶段，因果路径仍完整', async () => {
  const game = await create();
  let once = false;
  let outerId = '';
  game.room.on(Lifetime.ended, {
    id: 'after-inner-turn',
    owner: null,
    eligible: (_ctx, ended) => ended.kind === 'turn' && !once,
    async run(ctx) {
      once = true;
      await slash(ctx);
    },
  });
  await complete(
    game,
    outer(game, async (ctx, phase) => {
      outerId = phase.turn!.id;
      await runTurn(ctx, 'a', { phases: [], origin: extra });
    }),
    1,
  );
  expect(cardActivities(game.room.history.facts())[0]).toMatchObject({ turnId: null, phase: null });
  expect(cardActivities(game.room.history.facts())[0]!.scopePath).toContain(outerId);
});
