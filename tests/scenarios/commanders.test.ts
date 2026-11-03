import { expect, it } from 'vitest';
import { playMatch } from '../fixtures/match';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { standardGeneralSkills, standardGenerals } from '../../src/content/standard/generals';
import { standardCards } from '../../src/content/standard/cards';
import { RoleMatch } from '../../src/app/offline/role-match';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { projectMatch } from '../../src/app/offline/projection';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { rebuildWorld } from '../../src/core/history/rebuild';
import {
  kingdomOf,
  setKingdom,
  roleOf,
  runPhase,
  runTurn,
  phaseBefore,
  phaseStarted,
  phaseEnding,
  costPaid,
  cardsMoved,
  cardsDrawn,
  drawing,
  damageCausing,
  damageDealt,
  moveCards,
  responseRequested,
  responseFinished,
  kill,
  withProcessing,
  defineSkill,
  modify,
  cardQueries,
  effectStarting,
} from '../../src/sdk';
import type { PhaseView, UseIntent } from '../../src/sdk';
import { legacyGenerals } from '../fixtures/generals';

type Game = ReturnType<typeof cardGame>;
const source = { kind: 'general', id: 'test' } as const;
const death = {
  killer: null,
  reason: 'rule',
  cause: { kind: 'rule', seq: null, data: 'test' },
} as const;
function scenario(options: Parameters<typeof cardGame>[0] = {}) {
  return cardGame({
    ...options,
    hands: { a: [], ...options.hands },
    skills: options.skills ?? standardGeneralSkills,
  });
}
async function grant(game: Pick<Game, 'room' | 'skills'>, skill: string, owner = 'a') {
  await game.room.run('grant', (ctx) => game.skills.grant(ctx, { owner, skill, source }));
}
async function answer(game: Pick<Game, 'room'>, value: unknown, kind = 'invoke') {
  const request = await nextRequest(game.room);
  expect(request.kind).toBe(kind);
  expect(game.room.decisions.submit(request.id, request.token, value)).toEqual({
    kind: 'accepted',
  });
}
async function cancel(game: Pick<Game, 'room'>) {
  const request = await nextRequest(game.room);
  expect(game.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
}
async function takeHidden(game: Game, target: string) {
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('cards-targets');
  expect(request.prompt).toContain(target);
  const data = (request.data as { preview: { cards: { id: string; label: string }[] } }).preview;
  expect(JSON.stringify(data)).not.toContain('secret-');
  expect(data.cards[0]!.label).toContain('未知手牌');
  await answer(game, { cards: [data.cards[0]!.id], targets: [] }, 'cards-targets');
}
function replay(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.world.snapshot.zones.filter((zone) => zone.kind === 'processing')).toEqual([]);
}
const slash = (actor = 'b', target = 'a'): UseIntent => ({
  actor,
  targets: [target],
  choice: { kind: 'physical', card: 'hit' },
  timing: { kind: 'effect', ignoreDistance: true },
});
async function factions(
  game: Game,
  values: Readonly<Record<string, string | null>> = { a: '魏', b: '吴', c: '魏', d: '魏' },
) {
  await game.room.run('factions', (ctx) => {
    for (const [id, value] of Object.entries(values)) setKingdom(ctx, id, value);
  });
}

it('曹操、张辽初始化当前势力，身份模式只为主公授予主公技；非主公仍能查看说明', async () => {
  for (const general of legacyGenerals.slice(11, 13)) {
    const match = createOfflineMatch({
      seed: 42,
      preset: 'standard:identity',
      lineup: Array(6).fill(general.id),
    });
    await match.prepare();
    for (const player of match.room.world.snapshot.players) {
      expect(kingdomOf(match.room.world, player.id)).toBe('魏');
      expect(player.maxHp).toBe(4 + Number(roleOf(match.room.world, player.id) === 'lord'));
      const view = projectMatch(match, player.id, null).players.find(
        (seat) => seat.id === player.id,
      )!;
      if (general.id === 'standard:caocao')
        expect(view.skills.find((skill) => skill.id === 'standard:hujia')).toMatchObject({
          name: '护驾',
          effective: roleOf(match.room.world, player.id) === 'lord',
        });
    }
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
  }
});
it('势力可独立变更为自定义值或无势力，投影/AI/重放读取当前状态', async () => {
  const match = createOfflineMatch({
    seed: 42,
    preset: 'standard:identity',
    lineup: ['standard:caocao', 'standard:zhaoyun'],
  });
  await match.prepare();
  await match.room.run('change', (ctx) => {
    setKingdom(ctx, '甲席', '自定势力');
    setKingdom(ctx, '乙席', null);
  });
  expect(projectMatch(match, '甲席', null).players.map((p) => p.kingdom)).toEqual(['自定势力', '']);
  expect(observeAgent(match, '甲席').players.map((p) => p.kingdom)).toEqual(['自定势力', null]);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  expect(
    () =>
      new RoleMatch({
        id: 'bad',
        seed: 1,
        players: [{ id: 'a', general: 'standard:caocao', kingdom: '吴' }, { id: 'b' }],
        content: {
          cards: standardCards,
          skills: standardGeneralSkills,
          generals: standardGenerals,
        },
        deck: [],
      }),
  ).toThrow(/cannot override/);
});

it('替代默认阶段体仍完整开放开始/结束窗口，与跳阶段不同；重复阶段各自独立', async () => {
  const game = scenario();
  const events: string[] = [];
  let first = true;
  game.room.on(phaseBefore, {
    id: 'before',
    owner: null,
    eligible: () => true,
    run(ctx, phase) {
      expect(() => phase.replace(ctx, 'early')).toThrow(/at its start/);
    },
  });
  game.room.on(phaseStarted, {
    id: 'replace',
    owner: null,
    eligible: () => true,
    run(ctx, phase) {
      events.push('start');
      if (first) {
        phase.replace(ctx, 'test');
        phase.replace(ctx, 'ignored');
        expect(() => phase.replaceChange(ctx, 'again')).toThrow(/already replaced/);
        first = false;
      }
    },
  });
  game.room.on(phaseEnding, {
    id: 'end',
    owner: null,
    eligible: () => true,
    run(ctx, phase) {
      events.push('end');
      expect(() => phase.replace(ctx, 'late')).toThrow(/at its start/);
    },
  });
  const result = await game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['draw', 'draw'],
      body(ctx, phase) {
        events.push('body');
        expect(phase.replaced).toBe(false);
        expect(() => phase.replace(ctx, 'late')).toThrow(/at its start/);
      },
    }),
  );
  expect(events).toEqual(['start', 'end', 'start', 'body', 'end']);
  expect(result).toMatchObject({
    value: {
      phases: [
        { exit: 'replaced', phase: { skipped: false, replaced: true }, reason: 'test' },
        { exit: 'completed' },
      ],
    },
  });
  replay(game);
});
it('阶段替代句柄拒绝外局、局外上下文与关闭后的使用；跳阶段无替代机会', async () => {
  const game = scenario();
  const foreign = scenario();
  let retained: PhaseView;
  game.room.on(phaseStarted, {
    id: 'capture',
    owner: null,
    eligible: () => true,
    async run(_ctx, phase) {
      retained = phase;
      await foreign.room.run('foreign', (at) =>
        expect(() => phase.replace(at, 'foreign')).toThrow(/Lifetime/),
      );
    },
  });
  await game.room.run('phase', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
  await game.room.run('closed', (ctx) =>
    expect(() => retained.replace(ctx, 'closed')).toThrow(/Lifetime/),
  );
  game.room.on(phaseBefore, {
    id: 'skip',
    owner: null,
    eligible: () => true,
    run(ctx, phase) {
      phase.skip(ctx, 'skip');
    },
  });
  expect(await game.room.run('skip', (ctx) => runPhase(ctx, game.book, 'a', 'draw'))).toMatchObject(
    { value: { exit: 'skipped', phase: { replaced: false } } },
  );
});

it('奸雄按一次伤害发动一次，移动后效已能看到取得事实；实牌不再被用牌清理弃置', async () => {
  const game = scenario({ hands: { b: [card('hit', 'slash')] } });
  await grant(game, 'standard:jianxiong');
  game.room.on(damageCausing, {
    id: 'two',
    owner: null,
    eligible: () => true,
    run(_ctx, hit) {
      hit.setAmount(2, 'test');
    },
  });
  game.room.on(cardsMoved, {
    id: 'observe',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.to === 'a:hand'),
    run() {
      expect(game.room.history.facts('use.materials-obtained')).toHaveLength(1);
    },
  });
  const running = use(game, slash());
  await answer(game, true);
  await running;
  expect(game.room.world.player('a').hp).toBe(2);
  expect(game.room.world.position('hit')).toBe('a:hand');
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  replay(game);
});
it.each(['full', 'partial', 'empty'] as const)(
  '奸雄只取得完整虚拟牌实体材料，不把语义牌名写回实体：%s',
  async (kind) => {
    const game = scenario({ hands: { b: [card('one', 'peach'), card('two', 'jink')] } });
    await grant(game, 'standard:jianxiong');
    if (kind === 'partial')
      game.room.on(damageDealt, {
        id: 'remove',
        owner: null,
        eligible: () => true,
        async run(ctx, hit) {
          await moveCards(
            ctx,
            [{ cards: ['one'], from: hit.input.card!.processing, to: 'b:hand', place: 'bottom' }],
            'test',
          );
        },
      });
    const running = use(game, {
      ...slash(),
      choice: {
        kind: 'generated',
        face: { name: 'standard:slash' },
        materials: kind === 'empty' ? [] : ['one', 'two'],
        reason: 'test',
      },
    });
    if (kind === 'full') await answer(game, true);
    await running;
    expect(game.room.history.facts('skill.invoked')).toHaveLength(kind === 'full' ? 1 : 0);
    expect(game.room.world.position('two')).toBe(
      kind === 'full' ? 'a:hand' : kind === 'partial' ? 'discard' : 'b:hand',
    );
    expect(game.room.world.card('one').name).toBe('standard:peach');
    replay(game);
  },
);
it('奸雄不从另一处理区追回材料，即使另一处理区尚未清理', async () => {
  const game = scenario({ hands: { b: [card('hit', 'slash')] } });
  await grant(game, 'standard:jianxiong');
  let elsewhere = '';
  game.room.on(damageDealt, {
    id: 'elsewhere',
    owner: null,
    eligible: () => true,
    async run(ctx, hit) {
      await moveCards(
        ctx,
        [{ cards: ['hit'], from: hit.input.card!.processing, to: elsewhere, place: 'bottom' }],
        'test',
      );
    },
  });
  await game.room.run('outer', (ctx) =>
    withProcessing(ctx, [], async (at, pool) => {
      elsewhere = pool.zone;
      await game.book.use(at, slash());
    }),
  );
  expect(game.room.history.facts('skill.invoked')).toHaveLength(0);
  expect(game.room.world.position('hit')).toBe('discard');
});
it.each(['lost', 'moved', 'dead'] as const)(
  '奸雄支付后效重查材料和存活，失去技能不撤销已宣告效果：%s',
  async (kind) => {
    const game = scenario({ hands: { b: [card('hit', 'slash')] } });
    await grant(game, 'standard:jianxiong');
    game.room.on(costPaid, {
      id: 'after',
      owner: null,
      eligible: (_ctx, receipt) => receipt.skill === 'standard:jianxiong',
      async run(ctx) {
        if (kind === 'lost') await game.skills.revoke(ctx, 'a', 'standard:jianxiong', source);
        if (kind === 'moved')
          await moveCards(
            ctx,
            [{ cards: ['hit'], from: ctx.world.position('hit'), to: 'b:hand', place: 'bottom' }],
            'test',
          );
        if (kind === 'dead') await kill(ctx, { ...death, player: 'a' });
      },
    });
    const running = use(game, slash());
    await answer(game, true);
    await running;
    expect(game.room.world.position('hit')).toBe(
      kind === 'lost' ? 'a:hand' : kind === 'moved' ? 'b:hand' : 'discard',
    );
    replay(game);
  },
);
it('奸雄取得群体牌后，后续目标依然结算，但不能重复取得已离开处理区的材料', async () => {
  const game = scenario({ hands: { a: [card('aoe', 'savage_assault')] } });
  await grant(game, 'standard:jianxiong', 'b');
  await grant(game, 'standard:jianxiong', 'c');
  const running = use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 'aoe' },
    targets: [],
    timing: { kind: 'effect' },
  });
  await answer(game, true);
  await running;
  expect(['b', 'c', 'd'].map((id) => game.room.world.player(id).hp)).toEqual([3, 3, 3]);
  expect(game.room.world.position('aoe')).toBe('b:hand');
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  replay(game);
});

it('护驾不读取手牌可用性，按座次先询问无闪魏角色，再由后一人支付；只结算一次打出', async () => {
  const game = scenario({ hands: { b: [card('hit', 'slash')], d: [card('j', 'jink')] } });
  await grant(game, 'standard:hujia');
  await factions(game);
  let finished = 0;
  game.room.on(responseFinished, {
    id: 'played',
    owner: null,
    eligible: () => true,
    run(_ctx, response) {
      finished++;
      expect(response.actor).toBe('d');
    },
  });
  const running = use(game, slash());
  await answer(game, true);
  expect((await nextRequest(game.room)).player).toBe('d');
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  await running;
  expect(
    game.room.history
      .facts('response.requested')
      .map((fact) => (fact.data.detail as { actor: string }).actor),
  ).toEqual(['a', 'c', 'd']);
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.world.position('j')).toBe('discard');
  expect(finished).toBe(1);
  expect(game.room.history.facts('card.responded')).toHaveLength(1);
  replay(game);
});
it.each(['cancel', 'none'] as const)('护驾失败或不发动，仍可自己打闪：%s', async (kind) => {
  const game = scenario({
    hands: { a: [card('own', 'jink')], b: [card('hit', 'slash')], c: [card('other', 'jink')] },
  });
  await grant(game, 'standard:hujia');
  await factions(game);
  const running = use(game, slash());
  await answer(game, kind === 'none');
  if (kind === 'none') await cancel(game);
  expect((await nextRequest(game.room)).player).toBe('a');
  await answer(game, { kind: 'physical', card: 'own' }, 'card-response');
  await running;
  expect(game.room.world.position('other')).toBe('c:hand');
  expect(game.room.world.player('a').hp).toBe(4);
});
it('护驾按当前回合角色起算的行动顺序委托，不固定从曹操之后起算', async () => {
  const game = scenario({
    hands: { a: [card('hit', 'slash')], b: [card('first', 'jink')], d: [card('later', 'jink')] },
  });
  await grant(game, 'standard:hujia', 'c');
  await factions(game, { a: '吴', b: '魏', c: '魏', d: '魏' });
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['play'],
      async body(at) {
        await game.book.use(at, slash('a', 'c'));
      },
    }),
  );
  await answer(game, true);
  expect((await nextRequest(game.room)).player).toBe('b');
  await answer(game, { kind: 'physical', card: 'first' }, 'card-response');
  await running;
  expect(game.room.world.position('later')).toBe('d:hand');
});
it('没有其他存活魏角色时不询问护驾，也不会依静态武将势力猜测', async () => {
  const game = scenario({ hands: { b: [card('hit', 'slash')], c: [card('j', 'jink')] } });
  await grant(game, 'standard:hujia');
  await factions(game, { a: '魏', b: '吴', c: '蜀', d: '魏' });
  await game.room.run('dead', (ctx) => kill(ctx, { ...death, player: 'd' }));
  await use(game, slash());
  expect(game.room.history.facts('skill.invoked')).toEqual([]);
  expect(game.room.world.player('a').hp).toBe(3);
});
it('原请求允许杀或闪时，护驾委托仍只允许闪，不能误用供牌者的杀', async () => {
  const game = scenario({
    hands: { b: [card('hit', 'slash')], c: [card('wrong', 'slash'), card('right', 'jink')] },
  });
  await grant(game, 'standard:hujia');
  await factions(game);
  game.room.on(effectStarting, {
    id: 'mixed',
    owner: null,
    eligible: () => true,
    async run(ctx, { effect }) {
      const result = await game.book.respond(ctx, 'a', ['standard:slash', 'standard:jink'], effect);
      expect(result).toMatchObject({
        kind: 'responded',
        actor: 'c',
        card: { name: 'standard:jink' },
      });
      effect.cancel(ctx, 'mixed response probe');
    },
  });
  const running = use(game, slash());
  await answer(game, true);
  const request = await nextRequest(game.room);
  expect(request.data).toMatchObject({ names: ['standard:jink'] });
  expect(game.room.decisions.preview(request.id, { kind: 'physical', card: 'wrong' })?.valid).toBe(
    false,
  );
  await answer(game, { kind: 'physical', card: 'right' }, 'card-response');
  await running;
  expect(game.room.world.position('wrong')).toBe('c:hand');
  replay(game);
});
it('委托名称不能扩张原请求、为空或重复；失败不会支付或打开子请求', async () => {
  const game = scenario({
    hands: { a: [card('own', 'jink')], b: [card('hit', 'slash')], c: [card('wrong', 'slash')] },
  });
  game.room.on(responseRequested, {
    id: 'invalid-delegation',
    owner: null,
    eligible: (_ctx, request) => request.actor === 'a',
    async run(ctx, request) {
      for (const names of [[], ['standard:slash'], ['standard:jink', 'standard:jink']])
        expect(await request.delegate(ctx, 'c', names)).toMatchObject({ kind: 'unavailable' });
    },
  });
  const running = use(game, slash());
  await answer(game, { kind: 'physical', card: 'own' }, 'card-response');
  await running;
  expect(game.room.history.facts('response.requested')).toHaveLength(1);
  expect(game.room.history.facts('card.responded')).toHaveLength(0);
  expect(game.room.history.facts('card.used')).toHaveLength(2);
  expect(game.room.world.position('wrong')).toBe('c:hand');
});
it.each(['qingguo', 'longdan', 'armor'] as const)(
  '护驾供牌者复用自己的转换或装备能力：%s',
  async (kind) => {
    const game = scenario({
      hands: {
        b: [card('hit', 'slash')],
        c: kind === 'armor' ? [] : [card('material', kind === 'qingguo' ? 'peach' : 'slash')],
      },
      equipment: kind === 'armor' ? { c: [card('armor', 'eight_diagram')] } : {},
      draw: [card('red', 'peach', 'heart')],
    });
    await grant(game, 'standard:hujia');
    await factions(game);
    if (kind !== 'armor') await grant(game, `standard:${kind}`, 'c');
    const running = use(game, slash());
    await answer(game, true);
    if (kind === 'armor') await answer(game, true);
    else {
      const request = await nextRequest(game.room);
      const offer = (
        request.data as { offers: { kind: string; choice: { instance: string; recipe: string } }[] }
      ).offers.find((offer) => offer.kind === 'viewAs')!;
      await answer(
        game,
        { kind: 'viewAs', ...offer.choice, materials: ['material'] },
        'card-response',
      );
    }
    await running;
    expect(game.room.world.player('a').hp).toBe(4);
    expect(game.room.history.facts('response.delegated')).toHaveLength(1);
    replay(game);
  },
);
it.each(['provider', 'beneficiary'] as const)(
  '响应禁令检查实际供牌者；不把受益者的个人禁令当作全局禁止：%s',
  async (kind) => {
    const game = scenario({
      hands: { b: [card('hit', 'slash')], c: [card('j', 'jink')] },
      policy: { prohibitResponse: (_ctx, actor) => actor === (kind === 'provider' ? 'c' : 'a') },
    });
    await grant(game, 'standard:hujia');
    await factions(game);
    const running = use(game, slash());
    await answer(game, true);
    if (kind === 'beneficiary')
      await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
    await running;
    expect(game.room.world.player('a').hp).toBe(kind === 'provider' ? 3 : 4);
  },
);
it('护驾委托不会再次发动供牌者的护驾；动态势力按每次委托前的当前值判断', async () => {
  const game = scenario({ hands: { b: [card('hit', 'slash')], d: [card('j', 'jink')] } });
  await grant(game, 'standard:hujia');
  await grant(game, 'standard:hujia', 'c');
  await factions(game, { a: '魏', b: '吴', c: '魏', d: '蜀' });
  game.room.on(responseRequested, {
    id: 'new-faction',
    owner: null,
    eligible: (_ctx, request) => request.actor === 'c',
    run(ctx) {
      setKingdom(ctx, 'd', '魏');
    },
  });
  const running = use(game, slash());
  await answer(game, true);
  await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
  await running;
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  expect(game.room.world.player('a').hp).toBe(4);
});
it.each(['lost', 'dead', 'faction'] as const)(
  '护驾支付后不重复检查技能持有，但重查本人和供牌者当前资格：%s',
  async (kind) => {
    const game = scenario({ hands: { b: [card('hit', 'slash')], c: [card('j', 'jink')] } });
    await grant(game, 'standard:hujia');
    await factions(game);
    game.room.on(costPaid, {
      id: 'after',
      owner: null,
      eligible: (_ctx, receipt) => receipt.skill === 'standard:hujia',
      async run(ctx) {
        if (kind === 'lost') await game.skills.revoke(ctx, 'a', 'standard:hujia', source);
        if (kind === 'dead') await kill(ctx, { ...death, player: 'a' });
        if (kind === 'faction') setKingdom(ctx, 'c', '蜀');
      },
    });
    const running = use(game, slash());
    await answer(game, true);
    if (kind === 'lost') await answer(game, { kind: 'physical', card: 'j' }, 'card-response');
    await running;
    expect(game.room.history.facts('card.responded')).toHaveLength(kind === 'lost' ? 1 : 0);
    expect(game.room.world.position('j')).toBe(kind === 'lost' ? 'discard' : 'c:hand');
    replay(game);
  },
);

it('突袭选一至两名手牌目标，实际结算按座次，暗选不暴露实体身份且不经过摸牌', async () => {
  const game = scenario({
    hands: { b: [card('secret-b', 'peach')], c: [card('secret-c', 'slash')] },
    draw: [card('draw1', 'jink'), card('draw2', 'slash')],
  });
  await grant(game, 'standard:tuxi');
  let drawn = 0;
  game.room.on(drawing, {
    id: 'drawing-observer',
    owner: null,
    eligible: () => true,
    run() {
      drawn++;
    },
  });
  game.room.on(cardsDrawn, {
    id: 'drawn-observer',
    owner: null,
    eligible: () => true,
    run() {
      drawn++;
    },
  });
  game.room.on(costPaid, {
    id: 'atomic',
    owner: null,
    eligible: (_ctx, receipt) => receipt.skill === 'standard:tuxi',
    run() {
      expect(
        game.room.history
          .facts('skill.invoked')[0]!
          .data.changes.some(
            (change) => change.kind === 'setState' && change.state.key === 'core:phase-replacement',
          ),
      ).toBe(true);
    },
  });
  const running = game.room.run('draw', (ctx) => runPhase(ctx, game.book, 'a', 'draw'));
  const request = await nextRequest(game.room);
  for (const targets of [[], ['a'], ['b', 'b'], ['b', 'c', 'd']])
    expect(game.room.decisions.preview(request.id, { cards: [], targets })?.valid).toBe(false);
  await answer(game, { cards: [], targets: ['c', 'b'] }, 'cards-targets');
  await takeHidden(game, 'b');
  await takeHidden(game, 'c');
  expect(await running).toMatchObject({
    value: {
      exit: 'replaced',
      reason: 'standard:tuxi',
      phase: { skipped: false, replaced: true },
    },
  });
  expect(drawn).toBe(0);
  expect(game.room.world.zone('a:hand').cards).toEqual(['secret-b', 'secret-c']);
  expect(game.room.world.zone('draw').cards).toEqual(['draw1', 'draw2']);
  replay(game);
});
it.each(['cancel', 'empty'] as const)('突袭取消或无合法目标，正常摸两张：%s', async (kind) => {
  const game = scenario({
    hands: { b: kind === 'cancel' ? [card('secret-b', 'peach')] : [] },
    draw: [card('draw1', 'jink'), card('draw2', 'slash')],
  });
  await grant(game, 'standard:tuxi');
  const running = game.room.run('draw', (ctx) => runPhase(ctx, game.book, 'a', 'draw'));
  if (kind === 'cancel') await cancel(game);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['draw1', 'draw2']);
  expect(game.room.history.facts('skill.invoked')).toHaveLength(0);
});
it.each(['lost', 'empty', 'dead-target', 'dead-source'] as const)(
  '突袭宣告后目标或来源变化不会恢复默认摸牌：%s',
  async (kind) => {
    const game = scenario({
      hands: { b: [card('secret-b', 'peach')], c: [card('secret-c', 'slash')] },
      draw: [card('draw1', 'jink'), card('draw2', 'slash')],
    });
    await grant(game, 'standard:tuxi');
    game.room.on(costPaid, {
      id: 'after',
      owner: null,
      eligible: (_ctx, receipt) => receipt.skill === 'standard:tuxi',
      async run(ctx) {
        if (kind === 'lost') await game.skills.revoke(ctx, 'a', 'standard:tuxi', source);
        if (kind === 'empty')
          await moveCards(
            ctx,
            [{ cards: ['secret-b'], from: 'b:hand', to: 'discard', place: 'bottom' }],
            'test',
          );
        if (kind === 'dead-target') await kill(ctx, { ...death, player: 'b' });
        if (kind === 'dead-source') await kill(ctx, { ...death, player: 'a' });
      },
    });
    const running = game.room.run('draw', (ctx) => runPhase(ctx, game.book, 'a', 'draw'));
    await answer(game, { cards: [], targets: ['b', 'c'] }, 'cards-targets');
    if (kind === 'lost') await takeHidden(game, 'b');
    if (kind !== 'dead-source') await takeHidden(game, 'c');
    expect(await running).toMatchObject({ value: { exit: 'replaced' } });
    expect(game.room.world.zone('draw').cards).toHaveLength(2);
    expect(game.room.history.facts('cards.drawn')).toHaveLength(0);
    replay(game);
  },
);
it('取牌不混用弃牌权限；无手牌而只有装备的角色不是突袭目标', async () => {
  const lock = defineSkill({
    id: 'test:protected',
    name: '禁弃',
    triggers: [],
    modifiers: [modify(cardQueries.prohibitDiscard, () => true)],
  });
  const game = scenario({
    hands: { b: [card('secret-b', 'peach')] },
    equipment: { c: [card('weapon', 'spear')] },
    skills: [...standardGeneralSkills, lock],
  });
  await grant(game, 'standard:tuxi');
  await grant(game, lock.id, 'b');
  const running = game.room.run('draw', (ctx) => runPhase(ctx, game.book, 'a', 'draw'));
  const request = await nextRequest(game.room);
  expect(game.room.decisions.preview(request.id, { cards: [], targets: ['c'] })?.valid).toBe(false);
  await answer(game, { cards: [], targets: ['b'] }, 'cards-targets');
  await takeHidden(game, 'b');
  await running;
  expect(game.room.world.position('secret-b')).toBe('a:hand');
});

it('含曹操、张辽的八人局，基础 AI 通过正式委托、替代摸牌和取得材料走到胜负', async () => {
  const lineup = [11, 12, 8, 9, 10, 0, 2, 5].map((index) => legacyGenerals[index]!.id);
  const match = createOfflineMatch({ seed: 14, preset: 'standard:identity', lineup });
  await playMatch(match, { steps: 6000 });

  expect(
    match.room.history
      .facts('skill.invoked')
      .some((fact) => (fact.data.detail as { skill: string }).skill === 'standard:tuxi'),
  ).toBe(true);
  expect(match.room.history.facts('use.materials-obtained').length).toBeGreaterThan(0);
  expect(match.room.history.facts('response.delegated').length).toBeGreaterThan(0);
}, 60_000);
