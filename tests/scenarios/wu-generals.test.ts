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
import { standardGeneralSkills } from '../../src/content/standard/generals';
import { createRoleMatch } from '../../src/host/content';
import {
  recover,
  kill,
  runPhase,
  runTurn,
  activeOffers,
  moveCards,
  defineSkill,
  modify,
  cardQueries,
  setKingdom,
  installRescue,
  loseHp,
  cardActivities,
  judge,
  Hp,
  Cost,
} from '../../src/sdk';
import type { Context, PhaseView, RecoveryDraft } from '../../src/sdk';
import { generalGame } from '../fixtures/generals';
import { standardGenerals } from '../../src/content/standard/generals';
import { CardEvent } from '../../src/sdk';
import { Phase } from '../../src/sdk';
import { Skill } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';
type Game = ReturnType<typeof cardGame>;
const source = { kind: 'general', id: 'test' } as const;
const death = {
  killer: null,
  reason: 'rule',
  cause: { kind: 'rule', seq: null, data: 'test' },
} as const;
async function wound(game: Game, hp = 1, player = 'a') {
  await game.room.run('wound', (ctx) =>
    ctx.commit(testTiming('test.hp'), [{ kind: 'vitality', player, hp }], null),
  );
}
async function zhiheng(ctx: Context, game: Game, phase: PhaseView) {
  const offer = activeOffers(ctx, game.book, phase).find((o) => o.skill === 'standard:zhiheng')!;
  expect(offer).toBeDefined();
  await activate(ctx, game.book, phase, {
    instance: offer.choice.instance,
    action: offer.choice.action,
  });
}
const handCards = () =>
  ['one', 'two', 'three', 'four', 'five', 'six'].map((id) => card(id, 'jink'));
const startKeji = (
  game: Game,
  body: (ctx: Context, phase: PhaseView) => void | Promise<void> = () => {},
) =>
  game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['play', 'discard'],
      async body(at, phase) {
        if (phase.kind === 'play') await body(at, phase);
        else at.commit(testTiming('test.discard-body'), [], null);
      },
    }),
  );

it('回复草案修改尝试值，提交前重读当前体力并封口，实际值受上限裁剪', async () => {
  const game = generalGame();
  await wound(game, 1);
  let held: RecoveryDraft;
  game.room.on(Hp.recovering, {
    id: 'edit',
    owner: null,
    eligible: () => true,
    run(ctx, draft) {
      held = draft;
      expect(() => ctx.query(() => draft.adjust(1, 'impure'))).toThrow(/Pure queries/);
      expect(() => draft.adjust(0.5, 'fraction')).toThrow();
      expect(() => draft.setAmount(-1, 'negative')).toThrow();
      draft.adjust(2, 'bonus');
      ctx.commit(testTiming('test.hp'), [{ kind: 'vitality', player: 'a', hp: 3 }], null);
    },
  });
  game.room.on(Hp.recovered, {
    id: 'sealed',
    owner: null,
    eligible: () => true,
    run() {
      expect(() => held.setAmount(10, 'late')).toThrow();
    },
  });
  const result = await game.room.run('heal', (ctx) =>
    recover(ctx, { from: null, to: 'a', amount: 1 }),
  );
  expect(result).toMatchObject({
    value: {
      input: { amount: 1 },
      attemptedAmount: 3,
      amount: 1,
      beforeHp: 3,
      afterHp: 4,
      edits: [{ before: 1, after: 3, reason: 'bonus' }],
    },
  });
  settled(game);
});
it.each(['zero', 'dead', 'already-dead'] as const)(
  '回复零值、窗口中死亡和已死亡均不产生虚假实际回复：%s',
  async (kind) => {
    const game = generalGame();
    await wound(game);
    if (kind === 'already-dead')
      await game.room.run('kill', (ctx) => kill(ctx, { ...death, player: 'a' }));
    let opened = 0;
    game.room.on(Hp.recovering, {
      id: 'change',
      owner: null,
      eligible: () => true,
      async run(ctx, draft) {
        opened++;
        if (kind === 'zero') draft.setAmount(0, 'stop');
        else await kill(ctx, { ...death, player: 'a' });
      },
    });
    expect(
      await game.room.run('heal', (ctx) => recover(ctx, { from: null, to: 'a', amount: 1 })),
    ).toMatchObject({
      value: { kind: kind === 'zero' ? 'unchanged' : 'unavailable', amount: 0 },
    });
    expect(opened).toBe(kind === 'already-dead' ? 0 : 1);
    expect(game.room.history.facts(Hp.recovered)).toEqual([]);
  },
);
it.each(['wu', 'shu', 'self', 'changed'] as const)(
  '救援按实际桃使用者与当前势力增加回复：%s',
  async (kind) => {
    const game = generalGame({
      hands: { [kind === 'self' ? 'a' : 'b']: [card('peach', 'peach', 'heart')] },
    });
    await grant(game, 'standard:jiuyuan');
    installRescue(game.room, game.book);
    await game.room.run('kingdom', (ctx) => setKingdom(ctx, 'b', kind === 'shu' ? '蜀' : '吴'));
    if (kind === 'changed') await game.room.run('change', (ctx) => setKingdom(ctx, 'b', '蜀'));
    const running = game.room.run('dying', (ctx) =>
      loseHp(ctx, { player: 'a', amount: 4, reason: 'test' }),
    );
    await answer(game, { kind: 'physical', card: 'peach' }, 'use-card');
    await running;
    const hp = kind === 'wu' ? 2 : 1;
    expect(game.room.world.player('a').hp).toBe(hp);
    expect(game.room.history.facts(Hp.recovered)[0]!.data.detail).toMatchObject({
      attemptedAmount: hp,
      amount: hp,
    });
    settled(game);
  },
);
it('救援不奖励普通技能回复，也不超过体力上限', async () => {
  const game = generalGame();
  await grant(game, 'standard:jiuyuan');
  await game.room.run('kingdom', (ctx) => setKingdom(ctx, 'b', '吴'));
  await wound(game, 3);
  const result = await game.room.run('heal', (ctx) =>
    recover(ctx, { from: 'b', to: 'a', amount: 5 }),
  );
  expect(result).toMatchObject({ value: { amount: 1, attemptedAmount: 5, edits: [] } });
});
it('制衡手牌/装备同批弃置，后效后按实际费用数量摸牌，一阶段一次', async () => {
  const game = generalGame({
    hands: { a: [card('one', 'slash'), card('two', 'peach')] },
    equipment: { a: [card('gear', 'spear')] },
    draw: [card('d1', 'jink'), card('d2', 'slash'), card('d3', 'jink')],
  });
  await grant(game, 'standard:zhiheng');
  const running = game.room.run('play', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      await zhiheng(at, game, phase);
      expect(activeOffers(at, game.book, phase).some((o) => o.skill === 'standard:zhiheng')).toBe(
        false,
      );
    }),
  );
  await answer(game, { cards: ['one', 'two', 'gear'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['d1', 'd2', 'd3']);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  expect(game.room.world.zone('discard').cards).toEqual(['one', 'two', 'gear']);
  settled(game);
});
it('制衡取消不计次数，禁止弃置牌不可作为费用', async () => {
  const lock = defineSkill({
    id: 'test:lock',
    name: '保护',
    triggers: [],
    modifiers: [
      modify(cardQueries.prohibitDiscard, (_ctx, { input: r }) =>
        r.card === 'locked' ? true : undefined,
      ),
    ],
  });
  const game = generalGame({
    hands: { a: [card('locked', 'slash'), card('fee', 'jink')] },
    draw: [card('d', 'peach')],
    skills: [...standardGeneralSkills, lock],
  });
  await grant(game, 'standard:zhiheng');
  await grant(game, lock.id);
  const running = game.room.run('play', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, phase) => {
      await zhiheng(at, game, phase);
      await zhiheng(at, game, phase);
    }),
  );
  const r = await nextRequest(game.room);
  expect(game.room.decisions.preview(r.id, { cards: ['locked'], targets: [] })?.valid).toBe(false);
  await cancel(game);
  await answer(game, { cards: ['fee'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.position('locked')).toBe('a:hand');
});
it.each(['lost', 'dead'] as const)('制衡支付后失去技能仍摸牌，死亡则停止：%s', async (kind) => {
  const game = generalGame({ hands: { a: [card('fee', 'slash')] }, draw: [card('new', 'peach')] });
  await grant(game, 'standard:zhiheng');
  game.room.on(Cost.paid, {
    id: 'after',
    owner: null,
    eligible: (_ctx, r) => r.skill === 'standard:zhiheng',
    async run(ctx) {
      if (kind === 'lost') await game.skills.revoke(ctx, 'a', 'standard:zhiheng', source);
      else await kill(ctx, { ...death, player: 'a' });
    },
  });
  const running = game.room.run('play', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', (at, phase) => zhiheng(at, game, phase)),
  );
  await answer(game, { cards: ['fee'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.position('new')).toBe(kind === 'lost' ? 'a:hand' : 'draw');
  settled(game);
});
it('克己无杀时可跳弃牌，支付后效已看到跳过标记', async () => {
  const game = generalGame({ hands: { a: handCards() } });
  await grant(game, 'standard:keji');
  game.room.on(Cost.paid, {
    id: 'atomic',
    owner: null,
    eligible: (_ctx, r) => r.skill === 'standard:keji',
    run(ctx) {
      expect(
        ctx.world.snapshot.states.some(
          (s) => s.key === 'core:phase-skip' && s.value === 'standard:keji',
        ),
      ).toBe(true);
    },
  });
  const running = startKeji(game);
  await answer(game, true);
  await running;
  expect(game.room.history.facts(testTiming('test.discard-body'))).toEqual([]);
  expect(game.room.history.facts(Phase.skipped)).toHaveLength(1);
  expect(game.room.world.zone('a:hand').cards).toHaveLength(6);
  settled(game);
});
it('克己可以拒绝；独立弃牌阶段无本回合出牌记录也可发动', async () => {
  const game = generalGame();
  await grant(game, 'standard:keji');
  const first = startKeji(game);
  await answer(game, false);
  await first;
  expect(game.room.history.facts(testTiming('test.discard-body'))).toHaveLength(1);
  const second = game.room.run('discard', (ctx) => runPhase(ctx, game.book, 'a', 'discard'));
  await answer(game, true);
  await second;
  expect(game.room.history.facts(Phase.skipped)).toHaveLength(1);
});
it.each(['physical', 'converted', 'before-grant'] as const)(
  '出牌阶段真实使用杀后不能克己，包括获得技能前的活动：%s',
  async (kind) => {
    const game = generalGame({
      hands: { a: [card('hit', kind === 'converted' ? 'peach' : 'slash', 'heart')] },
    });
    if (kind !== 'before-grant') await grant(game, 'standard:keji');
    if (kind === 'converted') await grant(game, 'standard:wusheng');
    await startKeji(game, async (ctx, phase) => {
      const instance = game.skills
        .bindings(ctx.world)
        .find((b) => b.self.skill === 'standard:wusheng')?.self.id;
      await game.book.use(ctx, {
        actor: 'a',
        choice:
          kind === 'converted'
            ? { kind: 'viewAs', instance: instance!, recipe: 'red-slash', materials: ['hit'] }
            : { kind: 'physical', card: 'hit' },
        targets: ['b'],
        timing: phase.playTiming(),
      });
      if (kind === 'before-grant')
        await game.skills.grant(ctx, { owner: 'a', skill: 'standard:keji', source });
    });
    expect(game.room.history.facts(testTiming('test.discard-body'))).toHaveLength(1);
    expect(game.room.history.facts(Phase.skipped)).toEqual([]);
    settled(game);
  },
);
it('克己识别本人出牌阶段鬼才打出的杀，不把改判漏出活动查询', async () => {
  const game = generalGame({
    hands: { a: [card('retrial', 'slash')] },
    draw: [card('old', 'jink')],
  });
  await grant(game, 'standard:keji');
  await grant(game, 'standard:guicai');
  const running = startKeji(game, (ctx) =>
    judge(ctx, { player: 'b', reason: 'test', match: () => true }).then(() => {}),
  );
  await answer(game, { cards: ['retrial'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  expect(
    cardActivities(game.room.history.facts()).filter((a) => a.kind === 'response'),
  ).toMatchObject([{ actor: 'a', card: { name: 'standard:slash' } }]);
  expect(game.room.history.facts(testTiming('test.discard-body'))).toHaveLength(1);
});
it('其他阶段打出的杀、他人在本人出牌阶段使用杀不妨碍克己', async () => {
  const game = generalGame({
    hands: { b: [card('other', 'slash')], a: [card('retrial', 'slash')] },
    draw: [card('old', 'jink')],
  });
  await grant(game, 'standard:keji');
  await grant(game, 'standard:guicai');
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['judge', 'play', 'discard'],
      async body(at, phase) {
        if (phase.kind === 'judge')
          await judge(at, { player: 'b', reason: 'test', match: () => true });
        else if (phase.kind === 'play')
          await game.book.use(at, {
            actor: 'b',
            choice: { kind: 'physical', card: 'other' },
            targets: ['c'],
            timing: { kind: 'effect' },
          });
        else at.commit(testTiming('test.discard-body'), [], null);
      },
    }),
  );
  await answer(game, { cards: ['retrial'], targets: [] }, 'cards-targets');
  await answer(game, true);
  await running;
  expect(game.room.history.facts(Phase.skipped)).toHaveLength(1);
});
it('重复出牌阶段的使用记录都属于本回合，不能只查看最后一段', async () => {
  const game = generalGame({ hands: { a: [card('hit', 'slash')] } });
  await grant(game, 'standard:keji');
  let index = 0;
  await game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['play', 'play', 'discard'],
      async body(at, phase) {
        if (phase.kind === 'play' && index++ === 0)
          await game.book.use(at, {
            actor: 'a',
            choice: { kind: 'physical', card: 'hit' },
            targets: ['b'],
            timing: phase.playTiming(),
          });
        else if (phase.kind === 'discard') at.commit(testTiming('test.discard-body'), [], null);
      },
    }),
  );
  expect(game.room.history.facts(Phase.skipped)).toEqual([]);
  expect(game.room.history.facts(testTiming('test.discard-body'))).toHaveLength(1);
});
it.each(['snatch', 'indulgence'] as const)(
  '谦逊禁止%s成为目标，失去技能后恢复合法性',
  async (name) => {
    const game = generalGame({ hands: { b: [card('trick', name)], a: [card('hand', 'jink')] } });
    await grant(game, 'standard:qianxun');
    await game.room.run('check', async (ctx) => {
      const intent = {
        actor: 'b',
        choice: { kind: 'physical' as const, card: 'trick' },
        targets: ['a'],
        timing: { kind: 'effect' as const },
      };
      expect(game.book.validateUse(ctx, intent).ok).toBe(false);
      expect(
        game.book.inspectUse(ctx, { ...intent, targets: [] }).targets.find((t) => t.id === 'a')
          ?.selectable,
      ).toBe(false);
      await game.skills.revoke(ctx, 'a', 'standard:qianxun', source);
      expect(game.book.validateUse(ctx, intent).ok).toBe(true);
    });
  },
);
it('连营一次失去多张最后手牌只询问一次，并且记录发生于原牌效果之前', async () => {
  const game = generalGame({
    hands: { a: [card('one', 'jink'), card('two', 'peach')] },
    draw: [card('new', 'slash')],
  });
  await grant(game, 'standard:lianying');
  const running = game.room.run('lose', (ctx) =>
    moveCards(
      ctx,
      [{ cards: ['one', 'two'], from: 'a:hand', to: 'discard', place: 'bottom' }],
      'test',
    ),
  );
  await answer(game, true);
  await running;
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  expect(game.room.world.zone('a:hand').cards).toEqual(['new']);
  settled(game);
});
it('连营不会因部分手牌或仅装备离场发动，拒绝发动不产生摸牌', async () => {
  const game = generalGame({
    hands: { a: [card('one', 'jink'), card('two', 'peach')] },
    equipment: { a: [card('gear', 'spear')] },
    draw: [card('new', 'slash')],
  });
  await grant(game, 'standard:lianying');
  await game.room.run('partial', (ctx) =>
    moveCards(
      ctx,
      [
        { cards: ['one'], from: 'a:hand', to: 'discard', place: 'bottom' },
        { cards: ['gear'], from: 'a:equipment', to: 'discard', place: 'bottom' },
      ],
      'test',
    ),
  );
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  const running = game.room.run('last', (ctx) =>
    moveCards(ctx, [{ cards: ['two'], from: 'a:hand', to: 'discard', place: 'bottom' }], 'test'),
  );
  await answer(game, false);
  await running;
  expect(game.room.world.position('new')).toBe('draw');
});
it('连营宣告后收到手牌仍摸一张，失去技能也不撤销已宣告效果', async () => {
  const game = generalGame({
    hands: { a: [card('last', 'jink')], b: [card('gift', 'peach')] },
    draw: [card('new', 'slash')],
  });
  await grant(game, 'standard:lianying');
  game.room.on(Cost.paid, {
    id: 'after',
    owner: null,
    eligible: (_ctx, r) => r.skill === 'standard:lianying',
    async run(ctx) {
      await moveCards(
        ctx,
        [{ cards: ['gift'], from: 'b:hand', to: 'a:hand', place: 'bottom' }],
        'gift',
      );
      await game.skills.revoke(ctx, 'a', 'standard:lianying', source);
    },
  });
  const running = game.room.run('last', (ctx) =>
    moveCards(ctx, [{ cards: ['last'], from: 'a:hand', to: 'discard', place: 'bottom' }], 'test'),
  );
  await answer(game, true);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['gift', 'new']);
  settled(game);
});
it('连营支付后死亡不再摸牌，批量埋葬也不向死亡角色询问', async () => {
  const game = generalGame({ hands: { a: [card('last', 'jink')] }, draw: [card('new', 'slash')] });
  await grant(game, 'standard:lianying');
  game.room.on(Cost.paid, {
    id: 'death',
    owner: null,
    eligible: (_ctx, r) => r.skill === 'standard:lianying',
    async run(ctx) {
      await kill(ctx, { ...death, player: 'a' });
    },
  });
  const running = game.room.run('last', (ctx) =>
    moveCards(ctx, [{ cards: ['last'], from: 'a:hand', to: 'discard', place: 'bottom' }], 'test'),
  );
  await answer(game, true);
  await running;
  expect(game.room.world.position('new')).toBe('draw');
  expect(game.room.decisions.pending).toEqual([]);
  settled(game);
});
it('连营嵌在最后手牌用牌费用中，摸牌不会追回或重建原用牌材料', async () => {
  const game = generalGame({ hands: { a: [card('hit', 'slash')] }, draw: [card('new', 'jink')] });
  await grant(game, 'standard:lianying');
  const running = use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 'hit' },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  await answer(game, true);
  await running;
  expect(game.room.world.position('hit')).toBe('discard');
  expect(game.room.world.position('new')).toBe('a:hand');
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.history.facts(Skill.invoked)[0]!.seq).toBeLessThan(
    game.room.history.facts(CardEvent.effect)[0]!.seq,
  );
  settled(game);
});
it('克己识别出牌阶段决斗中的本人普通打出杀', async () => {
  const game = generalGame({
    hands: { a: [card('duel', 'duel'), card('own', 'slash')], b: [card('other', 'slash')] },
  });
  await grant(game, 'standard:keji');
  const running = startKeji(game, async (ctx, phase) => {
    await game.book.use(ctx, {
      actor: 'a',
      choice: { kind: 'physical', card: 'duel' },
      targets: ['b'],
      timing: phase.playTiming(),
    });
  });
  await answer(game, { kind: 'physical', card: 'other' }, 'card-response');
  await answer(game, { kind: 'physical', card: 'own' }, 'card-response');
  await running;
  expect(
    cardActivities(game.room.history.facts()).filter(
      (a) => a.actor === 'a' && a.kind === 'response',
    ),
  ).toHaveLength(1);
  expect(game.room.history.facts(testTiming('test.discard-body'))).toHaveLength(1);
});
it('普通移走杀不算使用或打出，前一回合的杀也不阻止本回合克己', async () => {
  const game = generalGame({ hands: { a: [card('old', 'slash'), card('discarded', 'slash')] } });
  await grant(game, 'standard:keji');
  await startKeji(game, async (ctx, phase) => {
    await game.book.use(ctx, {
      actor: 'a',
      choice: { kind: 'physical', card: 'old' },
      targets: ['b'],
      timing: phase.playTiming(),
    });
  });
  const next = startKeji(game, async (ctx) => {
    await moveCards(
      ctx,
      [{ cards: ['discarded'], from: 'a:hand', to: 'discard', place: 'bottom' }],
      'test',
    );
  });
  await answer(game, true);
  await next;
  expect(game.room.history.facts(Phase.skipped)).toHaveLength(1);
});
it('连营重新得到手牌再失去，会得到新的独立发动机会', async () => {
  const game = generalGame({
    hands: { a: [card('old', 'slash')] },
    draw: [card('first', 'jink'), card('second', 'peach')],
  });
  await grant(game, 'standard:lianying');
  for (const card of ['old', 'first']) {
    const running = game.room.run('lose', (ctx) =>
      moveCards(ctx, [{ cards: [card], from: 'a:hand', to: 'discard', place: 'bottom' }], 'test'),
    );
    await answer(game, true);
    await running;
  }
  expect(game.room.world.zone('a:hand').cards).toEqual(['second']);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(2);
  settled(game);
});
it('救援同样识别急救转换的桃，并保留真实使用者', async () => {
  const game = generalGame({ hands: { b: [card('red', 'slash', 'heart')] } });
  await grant(game, 'standard:jiuyuan');
  await grant(game, 'standard:jijiu', 'b');
  await game.room.run('kingdom', (ctx) => setKingdom(ctx, 'b', '吴'));
  installRescue(game.room, game.book);
  const running = game.room.run('dying', (ctx) =>
    loseHp(ctx, { player: 'a', amount: 4, reason: 'test' }),
  );
  const r = await nextRequest(game.room);
  const offer = (
    r.data as { offers: { kind: string; choice: { instance: string; recipe: string } }[] }
  ).offers.find((o) => o.kind === 'viewAs')!;
  await answer(game, { kind: 'viewAs', ...offer.choice, materials: ['red'] }, 'use-card');
  await running;
  expect(game.room.history.facts(Hp.recovered)[0]!.data.detail).toMatchObject({
    input: { from: 'b', card: { card: { name: 'standard:peach', source: { kind: 'viewAs' } } } },
    attemptedAmount: 2,
    amount: 2,
  });
  settled(game);
});
it('未发生实际回复时不开放回复后窗口，满体力仍保留尝试量结果', async () => {
  const game = generalGame();
  let after = 0;
  game.room.on(Hp.recovered, {
    id: 'after',
    owner: null,
    eligible: () => true,
    run() {
      after++;
    },
  });
  expect(
    await game.room.run('full', (ctx) => recover(ctx, { from: null, to: 'a', amount: 1 })),
  ).toMatchObject({ value: { kind: 'unchanged', attemptedAmount: 1, amount: 0 } });
  expect(after).toBe(0);
});
it('三名新吴将八人局由基础 AI 经正式决策走到胜负', async () => {
  const lineup = [15, 16, 17, 13, 14, 11, 9, 8].map((i) => standardGenerals[i]!.id);
  const match = createRoleMatch({ seed: 14, preset: 'standard:identity', lineup });
  await playMatch(match, { steps: 7000 });

  expect(
    match.room.history
      .facts(Skill.invoked)
      .some((f) => (f.data.detail as { skill: string }).skill === 'standard:zhiheng'),
  ).toBe(true);
}, 60000);
