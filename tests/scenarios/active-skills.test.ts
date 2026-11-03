import { expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { card, cardGame, die } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { kurou } from '../../src/content/standard/generals/huanggai';
import { jieyin, xiaoji } from '../../src/content/standard/generals/sunshangxiang';
import { standardGenerals, standardGeneralSkills } from '../../src/content/standard/generals';
import { RoleMatch } from '../../src/app/offline/role-match';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { World } from '../../src/core/state/world';
import { rebuildWorld } from '../../src/core/history/rebuild';
import {
  activeOffers,
  activate,
  validateActive,
  runPhase,
  playPhase,
  defineSkill,
  SkillBook,
  GeneralBook,
  defineGeneral,
  generalOf,
  genderOf,
  setGender,
  moveCards,
  installRescue,
  used,
  withLifetime,
  blockSkill,
  equipmentCard,
  JointSelection,
  ownedCards,
  pay,
  Cards,
  Cost,
  Phase,
} from '../../src/sdk';
import { inspectActive, activeAvailable } from '../../src/rules/skills/active';
import type { ActiveSkill, ActiveRunInput, Context, PhaseView } from '../../src/sdk';
import { Hp } from '../../src/sdk';
import { Skill } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

const source = { kind: 'general', id: 'fixture' } as const;

it('执行取得本次重查的选择模型，跨 await 后支付仍按当前候选校验', async () => {
  let latest: JointSelection | undefined;
  let preview: JointSelection | undefined;
  let projections = 0;
  class Selection extends JointSelection {
    override inspect(input: unknown) {
      projections++;
      return super.inspect(input);
    }
  }
  class Action implements ActiveSkill {
    id = 'act';
    label = '发动';
    #target = 'b';

    available(ctx: Context) {
      return ctx.world.player(this.#target).alive;
    }

    selection(ctx: Context) {
      latest = new Selection({
        targets: () =>
          ctx.world.snapshot.players
            .filter((player) => player.id === this.#target && player.alive)
            .map((player) => ({ id: player.id, label: player.id })),
        targetCount: { min: 1, max: 1 },
      });
      return latest;
    }

    async run(ctx: Context, { self, choice, selection }: ActiveRunInput) {
      expect(selection).toBe(latest);
      expect(selection).not.toBe(preview);
      expect(selection.validate(choice).ok).toBe(true);
      await ctx.flow('target-leaves', (at) =>
        at.commit(
          testTiming('target.left'),
          [{ kind: 'vitality', player: this.#target, hp: 0, alive: false }],
          null,
        ),
      );
      expect(selection.validate(choice).ok).toBe(false);
      expect(
        await pay(ctx, {
          skill: self,
          reason: self.skill,
          legal: () => selection.validate(choice).ok,
        }),
      ).toMatchObject({ kind: 'unavailable', reason: 'Final cost conditions changed.' });
    }
  }
  const action = new Action();
  const skill = defineSkill({ id: 'probe:live-selection', name: '动态选择', active: [action] });
  expect(defineSkill(skill)).toBe(skill);
  expect(() => defineSkill({ id: 'test:bad', name: '坏', active: [action, action] })).toThrow(
    '[test:bad] Duplicate active action ID: act.',
  );
  const game = cardGame({ skills: [skill] });
  expect(game.skills.definition(skill.id)).toBe(skill);
  expect(game.skills.definition(skill.id).active![0]!.label).toBe('发动');
  const instance = await grant(game, skill.id);
  await game.room.run('play', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      const choice = { instance: instance, action: 'act', cards: [], targets: ['b'] };
      expect(activeAvailable(at, game.book, phase)).toBe(true);
      expect(projections).toBe(0);
      const feedback = inspectActive(at, game.book, phase, choice);
      expect(feedback).toMatchObject({ complete: true, selection: { targets: ['b'] } });
      expect(feedback).not.toHaveProperty('preview');
      expect(projections).toBe(1);
      preview = latest;
      await activate(at, game.book, phase, choice);
      expect(activeAvailable(at, game.book, phase)).toBe(false);
    }),
  );
  expect(game.room.history.facts(Cost.paid)).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('装备派生的主动技能保留说明，来源离场后旧动作不能执行', async () => {
  const definition = equipmentCard({
    id: 'test:active-equipment',
    label: '主动装备',
    slot: 'weapon',
    skill: defineSkill({
      id: 'test:ability',
      name: '装备技能',
      description: '装备的主动说明',
      triggers: [],
      active: [
        {
          id: 'act',
          available: () => true,
          selection: (ctx, { self }) =>
            new JointSelection({
              cards: () => ownedCards(ctx.world, self.owner).map((id) => ({ id, label: id })),
              cardCount: { min: 1, max: 1 },
            }),
          run(ctx) {
            ctx.commit(testTiming('must-not-run'), [], null);
          },
        },
      ],
    }),
  });
  const game = cardGame({
    hands: { a: [card('material', 'jink')] },
    equipment: { a: [{ ...card('equipment', 'spear'), name: definition.id }] },
    definitions: [definition],
  });
  await game.room.run('phase', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      const offer = activeOffers(at, game.book, phase)[0]!;
      expect(offer.description).toBe('装备的主动说明');
      expect(offer.label).toBe('装备技能');
      const input = {
        ...offer.choice,
        cards: ['material'],
        targets: [],
      };
      expect(validateActive(at, game.book, phase, input)).toEqual({ ok: true, value: input });
      expect(inspectActive(at, game.book, phase, { ...input, cards: [] })).toMatchObject({
        valid: true,
        complete: false,
      });
      await moveCards(
        at,
        [{ cards: ['material'], from: 'a:hand', to: 'discard', place: 'bottom' }],
        'test',
      );
      expect(activeOffers(at, game.book, phase)).toEqual([]);
      expect(inspectActive(at, game.book, phase, input)).toBeNull();
      expect(validateActive(at, game.book, phase, input).ok).toBe(false);
      await activate(at, game.book, phase, input);
      await moveCards(
        at,
        [{ cards: ['material'], from: 'discard', to: 'a:hand', place: 'bottom' }],
        'test',
      );
      expect(activeOffers(at, game.book, phase)).toHaveLength(1);
      expect(validateActive(at, game.book, phase, input).ok).toBe(true);
      await moveCards(
        at,
        [{ cards: ['equipment'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
        'test',
      );
      expect(validateActive(at, game.book, phase, input).ok).toBe(false);
      await activate(at, game.book, phase, input);
    }),
  );
  expect(game.room.history.facts(testTiming('must-not-run'))).toEqual([]);
});
type Game = ReturnType<typeof cardGame>;
async function grant(game: Game, skill: string) {
  const result = await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill, source }),
  );
  if (result.kind !== 'resolved' || !result.value.after) throw new Error('Grant failed.');
  return result.value.after.id;
}
const startPlay = (game: Game, observer?: (phase: PhaseView) => void) =>
  game.room.run('phase', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      observer?.(phase);
      await playPhase(at, phase, game.book);
    }),
  );
async function playRequest(game: Game) {
  return vi.waitFor(() => {
    const request = game.room.decisions.pending[0];
    expect(request?.kind).toBe('play-action');
    return request!;
  });
}
async function useSkill(
  game: Game,
  skill: string,
  action: string,
  cards: readonly string[] = [],
  targets: readonly string[] = [],
) {
  const request = await playRequest(game);
  expect(
    game.room.decisions.submit(request.id, request.token, {
      instance: skill,
      action,
      cards,
      targets,
    }),
  ).toEqual({
    kind: 'accepted',
  });
}
async function pass(game: Game) {
  const request = await playRequest(game);
  game.room.decisions.cancel(request.id, request.token);
}
function supportGame(extra = false) {
  return cardGame({
    hands: {
      a: [
        card('one', 'jink'),
        card('two', 'jink'),
        ...(extra ? [card('three', 'jink'), card('four', 'jink')] : []),
      ],
      b: [],
    },
    equipment: { a: [card('weapon', 'spear')] },
    skills: [jieyin],
  });
}
async function setupSupport(game: Game) {
  const instance = await grant(game, jieyin.id);
  await game.room.run('setup', (ctx) => {
    setGender(ctx, 'a', 'female');
    setGender(ctx, 'b', 'male');
    setGender(ctx, 'c', 'female');
    setGender(ctx, 'd', 'dual');
    ctx.commit(
      testTiming('wounds'),
      ['a', 'b', 'c', 'd'].map((player) => ({ kind: 'vitality', player, hp: 2 })),
      null,
    );
  });
  return instance;
}

it('零牌也提供苦肉；同一阶段可反复发动，失去体力与摸牌都由领域流程提交', async () => {
  const game = cardGame({
    hands: { a: [], b: [] },
    skills: [kurou],
    draw: Array.from({ length: 8 }, (_, i) => card(`draw-${i}`, 'jink')),
  });
  const instance = await grant(game, kurou.id);
  const running = startPlay(game);
  const first = await playRequest(game);
  expect(first.data).toMatchObject({
    offers: [expect.objectContaining({ kind: 'active', skill: kurou.id })],
  });
  await useSkill(game, instance, 'lose-hp-draw');
  await vi.waitFor(() => expect(game.room.world.player('a').hp).toBe(3));
  await useSkill(game, instance, 'lose-hp-draw');
  await vi.waitFor(() => expect(game.room.world.player('a').hp).toBe(2));
  await pass(game);
  await running;
  expect(game.room.world.zone('a:hand').cards).toHaveLength(4);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(2);
  expect(game.room.history.facts(Hp.lost)).toHaveLength(2);
});

it('不能发动他人技能、失效技能、非当前阶段或已关闭阶段；纯候选不执行写入', async () => {
  const game = cardGame({ skills: [kurou] });
  const instance = await grant(game, kurou.id);
  let saved: PhaseView;
  game.room.on(Phase.before, {
    id: 'before',
    owner: null,
    eligible: () => true,
    run(ctx, phase) {
      expect(activeOffers(ctx, game.book, phase)).toEqual([]);
    },
  });
  await game.room.run('phase', (ctx) =>
    runPhase(ctx, game.book, 'b', 'play', (at, phase) => {
      expect(
        validateActive(at, game.book, phase, {
          instance: instance,
          action: 'lose-hp-draw',
          cards: [],
          targets: [],
        }).ok,
      ).toBe(false);
      saved = phase;
    }),
  );
  await game.room.run('outside', async (ctx) => {
    expect(
      validateActive(ctx, game.book, saved, {
        instance: instance,
        action: 'lose-hp-draw',
        cards: [],
        targets: [],
      }).ok,
    ).toBe(false);
    await activate(ctx, game.book, saved, {
      instance: instance,
      action: 'lose-hp-draw',
      cards: [],
      targets: [],
    });
  });
  await game.room.run('own-phase', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      expect(activeOffers(at, game.book, phase)).toHaveLength(1);
      await withLifetime(at, 'silence', (child, lifetime) => {
        blockSkill(child, instance, lifetime);
        expect(activeOffers(child, game.book, phase)).toHaveLength(0);
      });
      await runPhase(at, game.book, 'b', 'play', (child) => {
        expect(activeOffers(child, game.book, phase)).toHaveLength(0);
      });
      expect(activeOffers(at, game.book, phase)).toHaveLength(1);
    }),
  );
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
});

it('苦肉一血进入濒死，救援成功后才摸两张；死亡后不摸', async () => {
  for (const rescue of [true, false]) {
    const game = cardGame({
      hands: { a: rescue ? [card('save', 'peach', 'heart')] : [], b: [] },
      skills: [kurou],
      draw: [card('d1', 'jink'), card('d2', 'jink')],
    });
    installRescue(game.room, game.book);
    const instance = await grant(game, kurou.id);
    await game.room.run('wound', (ctx) =>
      ctx.commit(testTiming('wound'), [{ kind: 'vitality', player: 'a', hp: 1 }], null),
    );
    const running = startPlay(game);
    await useSkill(game, instance, 'lose-hp-draw');
    if (rescue) {
      const ask = await nextRequest(game.room);
      expect(ask.kind).toBe('use-card');
      expect(game.room.world.zone('draw').cards).toHaveLength(2);
      game.room.decisions.submit(ask.id, ask.token, { kind: 'physical', card: 'save' });
      await pass(game);
    }
    await running;
    expect(game.room.world.player('a').alive).toBe(rescue);
    expect(game.room.world.zone('a:hand').cards).toHaveLength(rescue ? 2 : 0);
    expect(game.room.world.zone('draw').cards).toHaveLength(rescue ? 0 : 2);
  }
});

it('结姻取消不支付；拒绝装备、自己和女性目标，双性男性分支可选', async () => {
  const game = supportGame();
  const instance = await setupSupport(game);
  const running = startPlay(game);
  const choice = await playRequest(game);
  const input = (value: { cards: string[]; targets: string[] }) => ({
    instance: instance,
    action: 'discard-heal',
    ...value,
  });
  for (const value of [
    { cards: ['one', 'weapon'], targets: ['b'] },
    { cards: ['one', 'two'], targets: ['a'] },
    { cards: ['one', 'two'], targets: ['c'] },
  ])
    expect(game.room.decisions.preview(choice.id, input(value))?.valid).toBe(false);
  const snapshot = game.room.world.snapshot;
  const facts = game.room.history.facts().length;
  expect(
    game.room.decisions.submit(
      choice.id,
      choice.token,
      input({ cards: ['one', 'weapon'], targets: ['b'] }),
    ),
  ).toMatchObject({ kind: 'rejected' });
  expect(game.room.world.snapshot).toBe(snapshot);
  expect(game.room.history.facts()).toHaveLength(facts);
  expect(game.room.decisions.pending[0]).toMatchObject({ id: choice.id, token: choice.token });
  expect(
    game.room.decisions.preview(choice.id, input({ cards: ['one', 'two'], targets: ['d'] }))?.valid,
  ).toBe(true);
  game.room.decisions.cancel(choice.id, choice.token);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['one', 'two']);
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
});

it('结姻费用、次数和宣告同次提交；回复先目标后本人，一阶段不能再次发动', async () => {
  const game = supportGame(true);
  const instance = await setupSupport(game);
  let current: PhaseView;
  game.room.on(Cards.moved, {
    id: 'cost-observer',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.cards.includes('one')),
    run(ctx) {
      expect(
        used(ctx.world, 'a', {
          key: 'jieyin',
          source: jieyin.id,
          lifetime: current.lifetime,
          max: 1,
        }),
      ).toBe(1);
      expect(ctx.world.zone('a:hand').cards).toEqual(['three', 'four']);
      expect(ctx.history.facts(Skill.invoked)).toHaveLength(1);
    },
  });
  const running = startPlay(game, (phase) => {
    current = phase;
  });
  await useSkill(game, instance, 'discard-heal', ['one', 'two'], ['b']);
  const next = await playRequest(game);
  expect(
    game.room.decisions.preview(next.id, { instance: instance, action: 'discard-heal' })?.valid,
  ).toBe(false);
  await pass(game);
  await running;
  expect(game.room.history.facts(Hp.recovered).map((fact) => fact.data.detail)).toMatchObject([
    { input: { to: 'b' } },
    { input: { to: 'a' } },
  ]);
  expect(game.room.world.player('a').hp).toBe(3);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.snapshot.states.some((state) => state.key === 'core:use-count')).toBe(
    false,
  );
});

it('结姻不要求本人受伤，下一独立出牌阶段重新获得次数', async () => {
  const game = supportGame(true);
  const instance = await setupSupport(game);
  await game.room.run('heal-source', (ctx) =>
    ctx.commit(testTiming('fixture'), [{ kind: 'vitality', player: 'a', hp: 4 }], null),
  );
  for (const cards of [
    ['one', 'two'],
    ['three', 'four'],
  ]) {
    const running = startPlay(game);
    await useSkill(game, instance, 'discard-heal', cards, ['b']);
    if (cards[0] === 'one') await pass(game);
    await running;
  }
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(2);
});

it('结姻支付后目标死亡仍消耗次数，本人按当前状态回复；技能失去不撤销已宣告效果', async () => {
  const game = supportGame();
  const instance = await setupSupport(game);
  game.room.on(Cost.paid, {
    id: 'cost-aftereffect',
    owner: null,
    eligible: (_ctx, paid) => paid.skill === jieyin.id,
    async run(ctx) {
      await game.skills.revoke(ctx, 'a', jieyin.id, source);
      await die(ctx, 'b');
    },
  });
  const running = startPlay(game);
  await useSkill(game, instance, 'discard-heal', ['one', 'two'], ['b']);
  await running;
  expect(game.room.world.player('b').alive).toBe(false);
  expect(game.room.world.player('a').hp).toBe(3);
  expect(game.room.world.zone('discard').cards).toContain('one');
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
});

for (const answers of [
  [true, true],
  [false, true],
] as const) {
  it(`枭姬批量失去两件装备逐件询问，选择 ${answers.join('/')}，独立支付与摸牌`, async () => {
    const game = cardGame({
      hands: { a: [], b: [] },
      equipment: { a: [card('w', 'spear'), card('h', 'chitu')] },
      skills: [xiaoji],
      draw: Array.from({ length: 6 }, (_, i) => card(`d${i}`, 'jink')),
    });
    await grant(game, xiaoji.id);
    const running = game.room.run('loss', (ctx) =>
      moveCards(
        ctx,
        [{ cards: ['w', 'h'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
        'test',
      ),
    );
    for (const value of answers) {
      const request = await nextRequest(game.room);
      expect(request.kind).toBe('invoke');
      game.room.decisions.submit(request.id, request.token, value);
      await setImmediate();
    }
    await running;
    expect(game.room.world.zone('a:hand').cards).toHaveLength(answers.filter(Boolean).length * 2);
  });
}

it('枭姬不会把装备区内部重排当作失去，首轮摸牌后失去技能会停止后续询问', async () => {
  const game = cardGame({
    hands: { a: [], b: [] },
    equipment: { a: [card('w', 'spear'), card('h', 'chitu')] },
    skills: [xiaoji],
    draw: [card('d1', 'jink'), card('d2', 'jink')],
  });
  await grant(game, xiaoji.id);
  await game.room.run('reorder', (ctx) =>
    moveCards(
      ctx,
      [{ cards: ['w'], from: 'a:equipment', to: 'a:equipment', place: 'bottom' }],
      'test',
    ),
  );
  expect(game.room.decisions.pending).toEqual([]);
  game.room.on(Cards.drawn, {
    id: 'lose-skill',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await game.skills.revoke(ctx, 'a', xiaoji.id, source);
    },
  });
  const running = game.room.run('loss', (ctx) =>
    moveCards(
      ctx,
      [{ cards: ['w', 'h'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
      'test',
    ),
  );
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, true);
  await running;
  expect(game.room.world.zone('a:hand').cards).toHaveLength(2);
  expect(game.room.decisions.pending).toEqual([]);
});

it('武将初始化的体力、性别、技能来源和选将事实可重建；拒绝隐式覆盖与缺失目录', async () => {
  const match = createOfflineMatch({
    seed: 42,
    preset: 'standard:identity',
    lineup: ['standard:sunshangxiang', 'standard:huanggai'],
  });
  await match.prepare();
  expect(match.room.world.player('甲席').maxHp).toBe(3);
  expect(genderOf(match.room.world, '甲席')).toBe('female');
  expect(generalOf(match.room.world, '甲席')).toBe('standard:sunshangxiang');
  expect(
    match.room.world.snapshot.skills
      .filter((skill) => skill.owner === '甲席')
      .map((skill) => skill.skill),
  ).toEqual([xiaoji.id, jieyin.id]);
  expect(() => new GeneralBook([...standardGenerals, standardGenerals[0]!], match.skills)).toThrow(
    /Duplicate general/,
  );
  expect(() => new GeneralBook(standardGenerals, new SkillBook([]))).toThrow(/Unknown skill/);
  expect(() => defineGeneral({ ...standardGenerals[0]!, maxHp: 0 })).toThrow(/Invalid general/);
  const rebuilt = new World(rebuildWorld(match.initial, match.room.history.facts()));
  expect(generalOf(rebuilt.reader, '甲席')).toBe('standard:sunshangxiang');
  expect(
    () =>
      new RoleMatch({
        id: 'bad',
        seed: 1,
        players: [{ id: 'a', general: 'standard:huanggai', maxHp: 5 }, { id: 'b' }],
        content: {
          cards: [],
          skills: standardGeneralSkills,
          generals: standardGenerals,
        },
        deck: [],
      }),
  ).toThrow(/cannot override/);
  expect(() =>
    createOfflineMatch({
      seed: 42,
      preset: 'standard:identity',
      lineup: ['unknown', 'standard:guanyu'],
    }),
  ).toThrow(/Unknown general/);
  match.room.abort('done');
});
