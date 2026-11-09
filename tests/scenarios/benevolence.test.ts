import { expect, it } from 'vitest';
import { playMatch } from '../fixtures/match';
import {
  card,
  cardGame,
  use,
  chooseAndActivate as activate,
  grant,
  settled,
} from '../fixtures/cards';
import { nextRequest, answer, cancel } from '../fixtures/room';
import { standardGeneralSkills } from '../fixtures/standard';
import { createRoleMatch } from '../../src/host/content';
import {
  currentPhase,
  moveCards,
  loseHp,
  modify,
  cardQueries,
  Cards,
  Response,
  useCard,
  validateUse,
} from '../../src/sdk';
import { withCardSupply } from '../../src/rules/cards/supply';
import { runPhase, runTurn } from '../../src/rules/turn/turn';
import { activeOffers } from '../../src/rules/skills/active';
import { setKingdom } from '../../src/rules/characters/kingdom';
import { kill } from '../../src/rules/combat/life';
import { installRescue } from '../../src/rules/combat/rescue';
import { defineSkill } from '../../src/rules/skills/skills';
import { viewAs } from '../../src/rules/cards/types';
import { Cost } from '../../src/rules/costs/pay';
import { buildCard, cardOffers } from '../../src/rules/cards/card';
import type { Context, PhaseView, CardChoice } from '../../src/sdk';
import type { SuppliedCard } from '../../src/rules/cards/supply';
import type { UseResult } from '../../src/rules/cards/use';
import { generalGame } from '../fixtures/generals';
import { standardGenerals } from '../fixtures/standard';
import { CardEvent } from '../../src/sdk';
import { Skill } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

type Game = ReturnType<typeof cardGame>;
const source = { kind: 'general', id: 'test' } as const;
const death = {
  killer: null,
  reason: 'rule',
  cause: { kind: 'rule', seq: null, data: 'test' },
} as const;
async function wound(game: Game, player = 'a', hp = 2) {
  await game.room.run('wound', (ctx) =>
    ctx.commit(testTiming('test.hp'), [{ kind: 'vitality', player, hp }], null),
  );
}
async function act(ctx: Context, phase: PhaseView, skill: string) {
  const offer = activeOffers(ctx, phase).find((o) => o.skill === skill)!;
  expect(offer).toBeDefined();
  await activate(ctx, phase, {
    instance: offer.choice.instance,
    action: offer.choice.action,
  });
}
function startActive(game: Game, skill: string, count = 1) {
  return game.room.run('phase', (ctx) =>
    runPhase(ctx, 'a', 'play', async (at, phase) => {
      for (let i = 0; i < count; i++) await act(at, phase, skill);
    }),
  );
}
async function setupJijiang(options: Parameters<typeof generalGame>[0] = {}) {
  const game = generalGame(options);
  const self = await grant(game, 'standard:jijiang');
  await game.room.run('factions', (ctx) => {
    for (const [id, kingdom] of Object.entries({ a: '蜀', b: '魏', c: '蜀', d: '蜀' }))
      setKingdom(ctx, id, kingdom);
  });
  return { game, self };
}
function jijiangChoice(game: Game): CardChoice {
  const self = game.skills
    .bindings(game.room.world)
    .find((b) => b.self.owner === 'a' && b.self.skill === 'standard:jijiang')!.self;
  return { kind: 'viewAs', instance: self.id, recipe: 'ask-slash', materials: [] };
}
function startJijiang(
  game: Game,
  after?: (ctx: Context, phase: PhaseView, result: UseResult) => void | Promise<void>,
) {
  return game.room.run('phase', (ctx) =>
    runPhase(ctx, 'a', 'play', async (at, phase) => {
      const result = await useCard(at, {
        actor: 'a',
        choice: jijiangChoice(game),
        targets: ['b'],
        timing: phase.playTiming(),
      });

      await after?.(at, phase, result);
    }),
  );
}

it('currentPhase 只返回局内当前祖先阶段，嵌套和规则中止后恢复，关闭后为空', async () => {
  const game = generalGame();
  const foreign = generalGame();
  await game.room.run('outer', (ctx) =>
    runPhase(ctx, 'a', 'play', async (at, outer) => {
      expect(currentPhase(at)).toBe(outer);
      await foreign.room.run('foreign', (ctx) => expect(currentPhase(ctx)).toBeNull());
      await runPhase(at, 'b', 'draw', (inner, phase) => {
        expect(currentPhase(inner)).toBe(phase);
        inner.abort('stop inner');
      });
      expect(currentPhase(at)).toBe(outer);
    }),
  );
  await game.room.run('closed', (ctx) => expect(currentPhase(ctx)).toBeNull());
  settled(game);
});
it('仁德分批交给不同角色，累计跨过两张时只回复一次，交牌和累计原子可见', async () => {
  const game = generalGame({
    hands: { a: [card('one', 'jink'), card('two', 'slash'), card('three', 'peach')] },
  });
  await grant(game, 'standard:rende');
  await wound(game);
  const counts: number[] = [];
  game.room.on(Cards.moved, {
    id: 'observe',
    owner: null,
    eligible: (_ctx, m) => m.moves.some((x) => x.from === 'a:hand'),
    run(ctx) {
      counts.push(
        ctx.world.snapshot.states.find((s) => s.key === 'standard:rende-given')!.value as number,
      );
    },
  });
  const running = startActive(game, 'standard:rende', 3);
  await answer(game, { cards: ['one'], targets: ['b'] }, 'cards-targets');
  await answer(game, { cards: ['two'], targets: ['c'] }, 'cards-targets');
  await answer(game, { cards: ['three'], targets: ['b'] }, 'cards-targets');
  await running;
  expect(counts).toEqual([1, 2, 3]);
  expect(game.room.world.player('a').hp).toBe(3);
  expect(game.room.world.zone('b:hand').cards).toEqual(['one', 'three']);
  settled(game);
});
it('仁德满体力跨过两张也消耗首次门槛，随后受伤再给牌不补发回复', async () => {
  const game = generalGame({
    hands: { a: [card('one', 'jink'), card('two', 'slash'), card('three', 'peach')] },
  });
  await grant(game, 'standard:rende');
  const running = game.room.run('phase', (ctx) =>
    runPhase(ctx, 'a', 'play', async (at, phase) => {
      await act(at, phase, 'standard:rende');
      at.commit(testTiming('test.hp'), [{ kind: 'vitality', player: 'a', hp: 2 }], null);
      await act(at, phase, 'standard:rende');
    }),
  );
  await answer(game, { cards: ['one', 'two'], targets: ['b'] }, 'cards-targets');
  await answer(game, { cards: ['three'], targets: ['b'] }, 'cards-targets');
  await running;
  expect(game.room.world.player('a').hp).toBe(2);
});
it('仁德取消不付费，装备/他人牌/自己目标均非法；重新选择可正常发动', async () => {
  const game = generalGame({
    hands: { a: [card('one', 'jink'), card('two', 'slash')], b: [card('foreign', 'peach')] },
    equipment: { a: [card('gear', 'spear')] },
  });
  await grant(game, 'standard:rende');
  await wound(game);
  const running = startActive(game, 'standard:rende', 2);
  const r = await nextRequest(game.room);
  for (const choice of [
    { cards: ['gear'], targets: ['b'] },
    { cards: ['foreign'], targets: ['b'] },
    { cards: ['one'], targets: ['a'] },
  ])
    expect(game.room.decisions.preview(r.id, choice)?.valid).toBe(false);
  await cancel(game);
  await answer(game, { cards: ['one', 'two'], targets: ['b'] }, 'cards-targets');
  await running;
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  expect(game.room.world.player('a').hp).toBe(3);
});
it('仁德计数不因支付后失去并重获技能重置，重复出牌阶段各有独立门槛', async () => {
  const game = generalGame({
    hands: { a: ['one', 'two', 'three', 'four'].map((id) => card(id, 'jink')) },
  });
  await grant(game, 'standard:rende');
  await wound(game);
  let changed = false;
  game.room.on(Cost.paid, {
    id: 'regrant',
    owner: null,
    eligible: (_ctx, r) => r.skill === 'standard:rende' && !changed,
    async run(ctx) {
      changed = true;
      await game.skills.revoke(ctx, 'a', 'standard:rende', source);
      await game.skills.grant(ctx, { owner: 'a', skill: 'standard:rende', source });
    },
  });
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, 'a', {
      phases: ['play', 'play'],
      async body(at, phase) {
        await act(at, phase, 'standard:rende');
      },
    }),
  );
  await answer(game, { cards: ['one', 'two'], targets: ['b'] }, 'cards-targets');
  await answer(game, { cards: ['three', 'four'], targets: ['c'] }, 'cards-targets');
  await running;
  expect(game.room.world.player('a').hp).toBe(4);
  settled(game);
});
it('仁德转交不受弃置禁令约束，目标死亡后已转交牌照常埋葬', async () => {
  const lock = defineSkill({
    id: 'test:lock',
    name: '禁弃',
    triggers: [],
    modifiers: [modify(cardQueries.prohibitDiscard, () => true)],
  });
  const game = generalGame({
    hands: { a: [card('one', 'jink'), card('two', 'slash')] },
    skills: [...standardGeneralSkills, lock],
  });
  await grant(game, 'standard:rende');
  await grant(game, lock.id);
  await wound(game);
  game.room.on(Cost.paid, {
    id: 'death',
    owner: null,
    eligible: (_ctx, r) => r.skill === 'standard:rende',
    async run(ctx) {
      await kill(ctx, { ...death, player: 'b' });
    },
  });
  const running = startActive(game, 'standard:rende');
  await answer(game, { cards: ['one', 'two'], targets: ['b'] }, 'cards-targets');
  await running;
  expect(game.room.world.zone('discard').cards).toEqual(['one', 'two']);
  expect(game.room.world.player('a').hp).toBe(3);
  settled(game);
});
it('青囊可以治疗自己，取消不占次数，成功后本阶段不能再发动', async () => {
  const game = generalGame({ hands: { a: [card('fee', 'jink')] } });
  await grant(game, 'standard:qingnang');
  await wound(game);
  const running = game.room.run('phase', (ctx) =>
    runPhase(ctx, 'a', 'play', async (at, phase) => {
      await act(at, phase, 'standard:qingnang');
      await act(at, phase, 'standard:qingnang');
      expect(activeOffers(at, phase).some((o) => o.skill === 'standard:qingnang')).toBe(false);
    }),
  );
  await cancel(game);
  await answer(game, { cards: ['fee'], targets: ['a'] }, 'cards-targets');
  await running;
  expect(game.room.world.player('a').hp).toBe(3);
  expect(game.room.world.position('fee')).toBe('discard');
  settled(game);
});
it('青囊只弃手牌且受弃置权限约束，无受伤目标时不显示动作', async () => {
  const game = generalGame({ equipment: { a: [card('gear', 'spear')] } });
  await grant(game, 'standard:qingnang');
  await wound(game);
  await game.room.run('no-hand', (ctx) =>
    runPhase(ctx, 'a', 'play', (at, phase) => expect(activeOffers(at, phase)).toEqual([])),
  );
  const lock = defineSkill({
    id: 'test:lock',
    name: '禁弃',
    triggers: [],
    modifiers: [modify(cardQueries.prohibitDiscard, () => true)],
  });
  const blocked = generalGame({
    hands: { a: [card('fee', 'jink')] },
    skills: [...standardGeneralSkills, lock],
  });
  await grant(blocked, 'standard:qingnang');
  await grant(blocked, lock.id);
  await wound(blocked);
  await blocked.room.run('blocked', (ctx) =>
    runPhase(ctx, 'a', 'play', (at, phase) => expect(activeOffers(at, phase)).toEqual([])),
  );
});
it.each(['lost', 'source-dead', 'target-dead'] as const)(
  '青囊宣告后不撤销费用，按目标当前存活结算：%s',
  async (kind) => {
    const game = generalGame({ hands: { a: [card('fee', 'jink')] } });
    await grant(game, 'standard:qingnang');
    await wound(game, 'b');
    game.room.on(Cost.paid, {
      id: 'after',
      owner: null,
      eligible: (_ctx, r) => r.skill === 'standard:qingnang',
      async run(ctx) {
        if (kind === 'lost') await game.skills.revoke(ctx, 'a', 'standard:qingnang', source);
        else await kill(ctx, { ...death, player: kind === 'source-dead' ? 'a' : 'b' });
      },
    });
    const running = startActive(game, 'standard:qingnang');
    await answer(game, { cards: ['fee'], targets: ['b'] }, 'cards-targets');
    await running;
    expect(game.room.world.position('fee')).toBe('discard');
    expect(game.room.world.player('b').hp).toBe(kind === 'target-dead' ? 2 : 3);
    settled(game);
  },
);
it.each(['hand', 'equipment'] as const)(
  '急救回合外红色%s当桃，走真实救援和用牌，不能当普通打出',
  async (area) => {
    const red = card('red', area === 'hand' ? 'slash' : 'chitu', 'heart');
    const game = generalGame({
      hands: { a: area === 'hand' ? [red] : [] },
      equipment: area === 'equipment' ? { a: [red] } : {},
    });
    await grant(game, 'standard:jijiu');
    installRescue(game.room);
    await game.room.run('response-check', (ctx) =>
      expect(
        buildCard(
          ctx,
          'a',
          {
            kind: 'viewAs',
            instance: game.room.world.snapshot.skills[0]!.id,
            recipe: 'red-peach',
            materials: ['red'],
          },
          'response',
        ).ok,
      ).toBe(false),
    );
    const running = game.room.run('dying', (ctx) =>
      loseHp(ctx, { player: 'b', amount: 4, reason: 'test' }),
    );
    const r = await nextRequest(game.room);
    expect(r.kind).toBe('use-card');
    const offer = (
      r.data as { offers: { kind: string; choice: { instance: string; recipe: string } }[] }
    ).offers.find((o) => o.kind === 'viewAs')!;
    await answer(game, { kind: 'viewAs', ...offer.choice, materials: ['red'] }, 'use-card');
    await running;
    expect(game.room.world.player('b').hp).toBe(1);
    expect(game.room.world.player('b').alive).toBe(true);
    expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
    expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
    expect(game.room.world.position('red')).toBe('discard');
    settled(game);
  },
);
it.each(['normal', 'extra'] as const)('急救在本人%s回合不可用，不能用红牌救别人', async (kind) => {
  const game = generalGame({ hands: { a: [card('red', 'slash', 'heart')] } });
  await grant(game, 'standard:jijiu');
  installRescue(game.room);
  await game.room.run('turn', (ctx) =>
    runTurn(ctx, 'a', {
      phases: ['prepare'],
      ...(kind === 'extra'
        ? { origin: { kind: 'extra' as const, id: 'extra', reason: 'test' } }
        : {}),
      async body(at) {
        expect(cardOffers(at, 'a', 'use', ['standard:peach'])).toEqual([]);
        await loseHp(at, { player: 'b', amount: 4, reason: 'test' });
      },
    }),
  );
  expect(game.room.world.player('b').alive).toBe(false);
  expect(game.room.world.position('red')).toBe('a:hand');
});
it('急救不能选择黑色材料，回合外仍完整检查使用桃禁令', async () => {
  const game = generalGame({ hands: { a: [card('black', 'slash')] } });
  const self = await grant(game, 'standard:jijiu');
  await game.room.run('black', (ctx) =>
    expect(
      buildCard(
        ctx,
        'a',
        { kind: 'viewAs', instance: self.id, recipe: 'red-peach', materials: ['black'] },
        'use',
      ).ok,
    ).toBe(false),
  );
  const blocked = generalGame({
    hands: { a: [card('red', 'slash', 'heart')] },
    rules: [modify(cardQueries.prohibitUse, () => true)],
  });
  const skill = await grant(blocked, 'standard:jijiu');
  await blocked.room.run('blocked', (ctx) =>
    expect(
      buildCard(
        ctx,
        'a',
        { kind: 'viewAs', instance: skill.id, recipe: 'red-peach', materials: ['red'] },
        'use',
      ).ok,
    ).toBe(false),
  );
});

it('激将由蜀角色打出、刘备使用：两种归属各一次，实际材料与来源可重建', async () => {
  const { game } = await setupJijiang({ hands: { c: [card('donor', 'slash', 'diamond', 9)] } });
  let played = 0;
  game.room.on(Response.finished, {
    id: 'played',
    owner: null,
    eligible: () => true,
    run(_ctx, r) {
      played++;
      expect(r).toMatchObject({
        actor: 'c',
        subject: { kind: 'supply', beneficiary: 'a', reason: 'standard:jijiang' },
      });
    },
  });
  const running = startJijiang(game, (ctx, phase, result) => {
    expect(result).toMatchObject({
      kind: 'used',
      use: {
        actor: 'a',
        card: {
          suit: 'diamond',
          rank: 9,
          materials: ['donor'],
          source: {
            kind: 'generated',
            reason: 'standard:jijiang',
            origin: { actor: 'c', card: { source: null } },
          },
        },
      },
    });
    expect(
      validateUse(ctx, {
        actor: 'a',
        choice: {
          kind: 'generated',
          face: { name: 'standard:slash' },
          materials: [],
          reason: 'test',
        },
        targets: ['b'],
        timing: phase.playTiming(),
      }).ok,
    ).toBe(false);
  });
  expect((await nextRequest(game.room)).player).toBe('c');
  await answer(game, { kind: 'physical', card: 'donor' }, 'card-response');
  await running;
  expect(played).toBe(1);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(game.room.world.player('b').hp).toBe(3);
  settled(game);
});
it.each(['wusheng', 'longdan', 'spear'] as const)(
  '激将保留供牌者的%s转换和全部材料来源',
  async (kind) => {
    const { game } = await setupJijiang({
      hands: {
        c:
          kind === 'spear'
            ? [card('one', 'peach'), card('two', 'jink')]
            : [card('one', kind === 'longdan' ? 'jink' : 'peach', 'heart')],
      },
      equipment: kind === 'spear' ? { c: [card('weapon', 'spear')] } : {},
    });
    if (kind !== 'spear') await grant(game, `standard:${kind}`, 'c');
    const running = startJijiang(game, (_ctx, _phase, result) => {
      expect(result).toMatchObject({
        kind: 'used',
        use: {
          card: {
            source: { origin: { actor: 'c', card: { source: { kind: 'viewAs' } } } },
            materials: kind === 'spear' ? ['one', 'two'] : ['one'],
          },
        },
      });
    });
    const r = await nextRequest(game.room);
    const offer = (
      r.data as { offers: { kind: string; choice: { instance: string; recipe: string } }[] }
    ).offers.find((o) => o.kind === 'viewAs')!;
    await answer(
      game,
      { kind: 'viewAs', ...offer.choice, materials: kind === 'spear' ? ['one', 'two'] : ['one'] },
      'card-response',
    );
    await running;
    settled(game);
  },
);
it('激将第一人放弃后询问下一人，只有实际供牌者支付', async () => {
  const { game } = await setupJijiang({
    hands: { c: [card('first', 'slash')], d: [card('last', 'slash')] },
  });
  const running = startJijiang(game);
  await cancel(game);
  expect((await nextRequest(game.room)).player).toBe('d');
  await answer(game, { kind: 'physical', card: 'last' }, 'card-response');
  await running;
  expect(game.room.world.position('first')).toBe('c:hand');
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
});
it('激将失败不消耗用杀次数，本阶段隐藏该用牌配方；下一阶段自动恢复', async () => {
  const { game } = await setupJijiang();
  let phaseNumber = 0;
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, 'a', {
      phases: ['play', 'play'],
      async body(at, phase) {
        phaseNumber++;
        if (phaseNumber === 1) {
          const result = await useCard(at, {
            actor: 'a',
            choice: jijiangChoice(game),
            targets: ['b'],
            timing: phase.playTiming(),
          });
          expect(result).toMatchObject({ kind: 'unavailable' });
          expect(cardOffers(at, 'a', 'use').some((o) => o.label === '激将')).toBe(false);
        } else expect(cardOffers(at, 'a', 'use').some((o) => o.label === '激将')).toBe(true);
      },
    }),
  );
  await running;
  expect(game.room.history.facts(CardEvent.used)).toEqual([]);
  expect(game.room.world.snapshot.states.some((s) => s.key === 'standard:jijiang-failed')).toBe(
    false,
  );
  settled(game);
});
it('激将普通打出请求走已有委托，不伪造刘备第二次用牌或打出', async () => {
  const { game } = await setupJijiang({
    hands: { d: [card('aoe', 'savage_assault')], c: [card('donor', 'slash')] },
  });
  const running = use(game, {
    actor: 'd',
    choice: { kind: 'physical', card: 'aoe' },
    targets: [],
    timing: { kind: 'effect' },
  });
  await answer(game, true, 'invoke');
  await answer(game, { kind: 'physical', card: 'donor' }, 'card-response');
  await running;
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.history.facts(Response.delegated)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
  expect(game.room.history.facts(CardEvent.used)).toHaveLength(1);
  settled(game);
});
it('激将以实际供牌牌面重新检查目标禁令，失败不宣告刘备用牌、不追回供牌费用', async () => {
  const { game } = await setupJijiang({
    hands: { c: [card('red', 'slash', 'heart')] },
    rules: [
      modify(
        cardQueries.prohibitTarget,
        (_ctx, { input: { actor, card } }) => actor === 'a' && card.suit === 'heart',
      ),
    ],
  });
  const running = startJijiang(game, (_ctx, _phase, result) =>
    expect(result.kind).toBe('unavailable'),
  );
  await answer(game, { kind: 'physical', card: 'red' }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.position('red')).toBe('discard');
  expect(game.room.history.facts(CardEvent.used)).toEqual([]);
  settled(game);
});
it.each(['moved', 'donor-dead', 'lord-dead'] as const)(
  '激将供牌已支付后失效，不继续收费下一个供牌者：%s',
  async (kind) => {
    const { game } = await setupJijiang({
      hands: { c: [card('first', 'slash')], d: [card('next', 'slash')] },
    });
    game.room.on(Cost.paid, {
      id: 'after-supply',
      owner: null,
      eligible: (_ctx, r) => r.actor === 'c' && r.reason === 'standard:jijiang',
      async run(ctx) {
        if (kind === 'moved')
          await moveCards(
            ctx,
            [
              {
                cards: ['first'],
                from: ctx.world.position('first'),
                to: 'c:hand',
                place: 'bottom',
              },
            ],
            'test',
          );
        else await kill(ctx, { ...death, player: kind === 'donor-dead' ? 'c' : 'a' });
      },
    });
    const running = startJijiang(game);
    await answer(game, { kind: 'physical', card: 'first' }, 'card-response');
    await running;
    expect(game.room.world.position('next')).toBe('d:hand');
    expect(game.room.history.facts(CardEvent.responded)).toHaveLength(1);
    expect(game.room.history.facts(CardEvent.used)).toEqual([]);
    settled(game);
  },
);
it('激将已宣告后失去技能仍完成本次供牌和用杀', async () => {
  const { game } = await setupJijiang({ hands: { c: [card('donor', 'slash')] } });
  game.room.on(Cost.paid, {
    id: 'lose',
    owner: null,
    eligible: (_ctx, r) => r.skill === 'standard:jijiang',
    async run(ctx) {
      await game.skills.revoke(ctx, 'a', 'standard:jijiang', source);
    },
  });
  const running = startJijiang(game);
  await answer(game, { kind: 'physical', card: 'donor' }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  settled(game);
});
it.each(['response', 'use'] as const)(
  '激将检查供牌者的打出禁令，不混用其使用禁令：%s',
  async (kind) => {
    const { game } = await setupJijiang({
      hands: { c: [card('donor', 'slash')] },
      rules: [
        modify(
          kind === 'response' ? cardQueries.prohibitResponse : cardQueries.prohibitUse,
          (_ctx, { input: { actor } }) => actor === 'c',
        ),
      ],
    });
    const running = startJijiang(game);
    if (kind === 'use') await answer(game, { kind: 'physical', card: 'donor' }, 'card-response');
    await running;
    expect(game.room.world.player('b').hp).toBe(kind === 'response' ? 4 : 3);
  },
);
it.each(['physical', 'zero'] as const)('供牌回调中止遵守独立处理区生存期：%s', async (kind) => {
  const zero = defineSkill({
    id: 'test:zero',
    name: '零材料',
    triggers: [],
    viewAs: [
      viewAs({
        id: 'zero',
        label: '零材料',
        count: { min: 0, max: 0 },
        names: () => ['standard:slash'],
        materials: () => [],
        make: () => ({ name: 'standard:slash' }),
      }),
    ],
  });
  const game = generalGame({
    skills: [zero],
    hands: { c: kind === 'physical' ? [card('supply', 'slash')] : [] },
  });
  const self = await grant(game, zero.id, 'c');
  let held: SuppliedCard;
  const running = game.room.run('supply', (ctx) =>
    withCardSupply(
      ctx,
      { actor: 'c', beneficiary: 'a', names: ['standard:slash'], reason: 'test' },
      (at, supply) => {
        held = supply;
        expect(supply.available(at)).toBe(true);
        at.abort('stop');
      },
    ),
  );
  await answer(
    game,
    kind === 'physical'
      ? { kind: 'physical', card: 'supply' }
      : { kind: 'viewAs', instance: self.id, recipe: 'zero', materials: [] },
    'card-response',
  );
  expect(await running).toMatchObject({ kind: 'aborted', reason: 'stop' });
  await game.room.run('closed', (ctx) => expect(held.available(ctx)).toBe(false));
  if (kind === 'physical') expect(game.room.world.position('supply')).toBe('discard');
  settled(game);
});
it('本人出牌阶段激将打出失败后仍可自己响应，但本阶段不能再主动激将', async () => {
  const { game } = await setupJijiang({
    hands: { a: [card('duel', 'duel'), card('own', 'slash')], b: [card('first', 'slash')] },
  });
  const running = game.room.run('phase', (ctx) =>
    runPhase(ctx, 'a', 'play', async (at, phase) => {
      await useCard(at, {
        actor: 'a',
        choice: { kind: 'physical', card: 'duel' },
        targets: ['b'],
        timing: phase.playTiming(),
      });
      expect(cardOffers(at, 'a', 'use').some((o) => o.label === '激将')).toBe(false);
    }),
  );
  await answer(game, { kind: 'physical', card: 'first' }, 'card-response');
  await answer(game, true, 'invoke');
  await answer(game, { kind: 'physical', card: 'own' }, 'card-response');
  await running;
  expect(game.room.history.facts(CardEvent.responded)).toHaveLength(2);
  expect(game.room.world.player('b').hp).toBe(3);
  settled(game);
});
it('刘备、华佗八人标准局以托管 AI 走过供牌与治疗，最终正常结束', async () => {
  const lineup = [13, 14, 0, 3, 2, 11, 9, 12].map((i) => standardGenerals[i]!.id);
  const match = createRoleMatch({ seed: 14, preset: 'standard:identity', lineup });
  await playMatch(match, { steps: 7000 });

  expect(
    match.room.history
      .facts(CardEvent.used)
      .some(
        (f) =>
          (f.data.detail as { declaration: { card: { source: { reason?: string } | null } } })
            .declaration.card.source?.reason === 'standard:jijiang',
      ),
  ).toBe(true);
}, 60000);
