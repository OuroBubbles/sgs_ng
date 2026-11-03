import { expect, it } from 'vitest';
import { playMatch } from '../fixtures/match';
import { card, cardGame, use, grant, settled } from '../fixtures/cards';
import { nextRequest, room, answer } from '../fixtures/room';
import { ganglie } from '../../src/content/standard/generals/xiahoudun';
import { luoyiAftereffect } from '../../src/content/standard/generals/xuchu';
import { luoshen, qingguo } from '../../src/content/standard/generals/zhenji';
import { standardGeneralSkills } from '../../src/content/standard/generals';
import {
  damage,
  judge,
  draw,
  runTurn,
  runPhase,
  defaultPhaseBody,
  moveCards,
  kill,
  defineSkill,
  modify,
  cardQueries,
  SkillBook,
  Cards,
  Judgment,
  Damage,
  Cost,
} from '../../src/sdk';
import type { Context, PhaseView } from '../../src/sdk';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { standardGenerals } from '../../src/content/standard/generals';
import { CardEvent } from '../../src/sdk';
import { Draw } from '../../src/rules/cards/draw';
import { Skill } from '../../src/sdk';

const source = { kind: 'general', id: 'test' } as const;
const hit = (ctx: Context, from: string | null = 'b', amount = 1) =>
  damage(ctx, { from, to: 'a', amount, nature: 'normal' });

it('刚烈在一次两点伤害后只判定一次；少于两张可弃手牌时直接造成一点伤害', async () => {
  const game = cardGame({
    hands: { a: [], b: [card('only', 'peach')] },
    skills: [ganglie],
    draw: [card('judge', 'slash')],
  });
  await grant(game, 'standard:ganglie');
  const running = game.room.run('damage', (ctx) => hit(ctx, 'b', 2));
  await answer(game, true);
  await running;
  expect(game.room.world.player('a').hp).toBe(2);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('only')).toBe('b:hand');
  expect(game.room.history.facts(Judgment.finished)).toHaveLength(1);
  settled(game);
});

it('刚烈来源可以支付两张手牌；受保护手牌和装备不进入候选，不产生额外伤害', async () => {
  const locked = defineSkill({
    id: 'test:protect',
    name: '保护',
    triggers: [],
    modifiers: [
      modify(
        cardQueries.prohibitDiscard,
        (_ctx, { input: request }) => request.card === 'protected',
      ),
    ],
  });
  const game = cardGame({
    hands: { a: [], b: [card('one', 'slash'), card('two', 'slash'), card('protected', 'peach')] },
    equipment: { b: [card('weapon', 'spear')] },
    draw: [card('judge', 'slash')],
    skills: [ganglie, locked],
  });
  await grant(game, 'standard:ganglie');
  await grant(game, locked.id);
  const running = game.room.run('damage', hit);
  await answer(game, true);
  const request = await nextRequest(game.room);
  expect(request.player).toBe('b');
  const feedback = game.room.decisions.preview(request.id, { cards: [], targets: [] })!
    .feedback as { cards: { id: string }[] };
  expect(feedback.cards.map((entry) => entry.id)).toEqual(['one', 'two']);
  await answer(game, { cards: ['one', 'two'], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.zone('b:hand').cards).toEqual(['protected']);
  expect(game.room.world.position('weapon')).toBe('b:equipment');
  settled(game);
});

it('刚烈来源可拒绝弃置；没有来源也仍判定，红桃时没有来源选择', async () => {
  for (const branch of ['decline', 'no-source', 'heart'] as const) {
    const game = cardGame({
      hands: { a: [], b: [card('one', 'slash'), card('two', 'slash')] },
      skills: [ganglie],
      draw: [card('judge', 'slash', branch === 'heart' ? 'heart' : 'club')],
    });
    await grant(game, 'standard:ganglie');
    const running = game.room.run('damage', (ctx) => hit(ctx, branch === 'no-source' ? null : 'b'));
    await answer(game, true);
    if (branch === 'decline') {
      const request = await nextRequest(game.room);
      expect(game.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
    }
    await running;
    expect(game.room.world.player('b').hp).toBe(branch === 'decline' ? 3 : 4);
    expect(game.room.world.zone('b:hand').cards).toEqual(['one', 'two']);
    expect(game.room.history.facts(Judgment.finished)).toHaveLength(1);
  }
});

it('刚烈判定可被改为红桃；已经发动后失去技能仍执行判定，来源死亡则不继续追讨', async () => {
  for (const branch of ['retrial', 'revoke', 'dead-source'] as const) {
    const game = cardGame({
      hands: { a: [], c: [card('red', 'jink', 'heart')] },
      skills: [ganglie],
      draw: [card('judge', 'slash')],
    });
    await grant(game, 'standard:ganglie');
    if (branch === 'revoke')
      game.room.on(Cost.paid, {
        id: 'lose-skill',
        owner: 'a',
        eligible: (_ctx, paid) => paid.skill === 'standard:ganglie',
        run: async (ctx) => {
          await game.skills.revoke(ctx, 'a', 'standard:ganglie', source);
        },
      });
    if (branch === 'retrial')
      game.room.on(Judgment.revealed, {
        id: 'retrial',
        owner: 'c',
        eligible: () => true,
        run: async (ctx, judgment) => {
          await judgment.replace(ctx, { card: 'red', from: 'c:hand', reason: 'test' });
        },
      });
    if (branch === 'dead-source')
      game.room.on(Judgment.finished, {
        id: 'kill-source',
        owner: 'c',
        eligible: () => true,
        run: async (ctx) => {
          await kill(ctx, {
            player: 'b',
            killer: null,
            reason: 'rule',
            cause: { kind: 'rule', seq: null, data: 'test' },
          });
        },
      });
    const running = game.room.run('damage', hit);
    await answer(game, true);
    await running;
    expect(game.room.history.facts(Judgment.finished)).toHaveLength(1);
    expect(game.room.history.facts(Damage.dealt)).toHaveLength(branch === 'revoke' ? 2 : 1);
    settled(game);
  }
});

it('拒绝发动刚烈不翻牌，濒死未获救死亡也不再发动受伤技能', async () => {
  const game = cardGame({
    hands: { a: [] },
    skills: [ganglie],
    draw: [card('judge', 'slash')],
  });
  await grant(game, 'standard:ganglie');
  const first = game.room.run('damage', hit);
  await answer(game, false);
  await first;
  await game.room.run('lethal', (ctx) => hit(ctx, 'b', 3));
  expect(game.room.world.player('a').alive).toBe(false);
  expect(game.room.history.facts(Judgment.finished)).toEqual([]);
  expect(game.room.world.position('judge')).toBe('draw');
});

it('裸衣只减少显式阶段摸牌，内嵌同原因摸牌不继承阶段；声明与回合效果同次提交', async () => {
  const game = cardGame({
    hands: { a: [] },
    skills: standardGeneralSkills,
    effects: [luoyiAftereffect],
    draw: ['one', 'two', 'three', 'four'].map((id) => card(id, 'slash')),
  });
  await grant(game, 'standard:luoyi');
  let nested = false;
  game.room.on(Cost.paid, {
    id: 'nested-draw',
    owner: 'a',
    eligible: (_ctx, paid) => paid.skill === 'standard:luoyi' && !nested,
    async run(ctx) {
      nested = true;
      expect(game.book.effects.instances(ctx.world, luoyiAftereffect)).toHaveLength(1);
      await draw(ctx, { player: 'a', count: 2, reason: 'draw-phase' });
    },
  });
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', { phases: ['draw'] }),
  );
  await answer(game, true);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['one', 'two', 'three']);
  const results = game.room.history.facts(Draw.completed).map((fact) => fact.data.detail);
  expect(results).toMatchObject([
    { count: 2, input: { count: 2 } },
    { count: 1, input: { phase: { kind: 'draw' } } },
  ]);
  expect(game.book.effects.instances(game.room.world, luoyiAftereffect)).toHaveLength(0);
  expect(JSON.stringify(results)).not.toContain('lifetime');
  settled(game);
});

it('裸衣少摸后杀增伤，失去技能仍增伤，回合结束自动消失；非牌伤害不会借用裸衣', async () => {
  const game = cardGame({
    hands: { a: [card('s1', 'slash'), card('s2', 'slash')] },
    skills: standardGeneralSkills,
    effects: [luoyiAftereffect],
    draw: [card('draw', 'jink')],
  });
  await grant(game, 'standard:luoyi');
  const body = async (ctx: Context, phase: PhaseView) => {
    if (phase.kind === 'draw') return defaultPhaseBody(ctx, phase, game.book);
    await game.skills.revoke(ctx, 'a', 'standard:luoyi', source);
    await game.book.use(ctx, {
      actor: 'a',
      choice: { kind: 'physical', card: 's1' },
      targets: ['b'],
      timing: phase.playTiming(),
    });
    await damage(ctx, { from: 'a', to: 'c', amount: 1, nature: 'normal' });
  };
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', { phases: ['draw', 'play'], body }),
  );
  await answer(game, true);
  await running;
  expect(game.room.world.player('b').hp).toBe(2);
  expect(game.room.world.player('c').hp).toBe(3);
  await use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 's2' },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  expect(game.room.world.player('b').hp).toBe(1);
  settled(game);
});

it('决斗目标打回伤害仍是实际来源，但不是其本人使用的决斗，不借用裸衣', async () => {
  const game = cardGame({
    hands: { a: [card('response', 'slash')], b: [card('duel', 'duel')] },
    skills: standardGeneralSkills,
    effects: [luoyiAftereffect],
    draw: [card('draw', 'jink')],
  });
  await grant(game, 'standard:luoyi');
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['draw', 'play'],
      body: async (at, phase) => {
        if (phase.kind === 'draw') return defaultPhaseBody(at, phase, game.book);
        await game.book.use(at, {
          actor: 'b',
          choice: { kind: 'physical', card: 'duel' },
          targets: ['a'],
          timing: { kind: 'effect' },
        });
      },
    }),
  );
  await answer(game, true);
  await answer(game, { kind: 'physical', card: 'response' }, 'card-response');
  await running;
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.history.facts(Damage.dealt)[0]?.data.detail).toMatchObject({
    input: { from: 'a', to: 'b', card: { actor: 'b' } },
    hpLoss: 1,
    edits: [],
  });
  settled(game);
});

it.each(['physical', 'generated'] as const)(
  '裸衣对本人使用的 %s 决斗增伤，失去原技能仍保留已宣告回合效果',
  async (kind) => {
    const game = cardGame({
      hands: { a: kind === 'physical' ? [card('duel', 'duel')] : [], b: [] },
      skills: standardGeneralSkills,
      effects: [luoyiAftereffect],
      draw: [card('draw', 'jink')],
    });
    await grant(game, 'standard:luoyi');
    const running = game.room.run('turn', (ctx) =>
      runTurn(ctx, game.book, 'a', {
        phases: ['draw', 'play'],
        async body(at, phase) {
          if (phase.kind === 'draw') return defaultPhaseBody(at, phase, game.book);
          await game.skills.revoke(at, 'a', 'standard:luoyi', source);
          await game.book.use(at, {
            actor: 'a',
            choice:
              kind === 'physical'
                ? { kind: 'physical', card: 'duel' }
                : {
                    kind: 'generated',
                    face: { name: 'standard:duel' },
                    materials: [],
                    reason: 'probe',
                  },
            targets: ['b'],
            timing: { kind: 'effect' },
          });
        },
      }),
    );
    await answer(game, true);
    await running;
    expect(game.room.world.player('b').hp).toBe(2);
    expect(game.room.history.facts(Damage.dealt)[0]?.data.detail).toMatchObject({
      input: { from: 'a', to: 'b', card: { actor: 'a' } },
      hpLoss: 2,
      edits: [{ before: 1, after: 2, reason: 'standard:luoyi' }],
    });
    expect(game.room.decisions.pending).toEqual([]);
    expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
    settled(game);
  },
);

it('嵌套回合暂停外层裸衣，重复摸牌不叠加；开窗后撤销状态必须在执行前重查', async () => {
  const game = cardGame({
    hands: { a: [card('nested', 'slash'), card('outer', 'slash'), card('cancelled', 'slash')] },
    skills: standardGeneralSkills,
    effects: [luoyiAftereffect],
    draw: [card('d1', 'jink'), card('d2', 'jink')],
  });
  await grant(game, 'standard:luoyi');
  let suppress = false;
  game.room.on(Damage.causing, {
    id: 'cancel-bonus',
    owner: null,
    eligible: () => suppress,
    async run(ctx) {
      for (const bonus of game.book.effects.instances(ctx.world, luoyiAftereffect))
        await game.book.effects.end(ctx, bonus.id, 'test:bonus-cancelled');
    },
  });
  const slash = (ctx: Context, id: string, target = 'b') =>
    game.book.use(ctx, {
      actor: 'a',
      choice: { kind: 'physical', card: id },
      targets: [target],
      timing: { kind: 'effect' },
    });
  const running = game.room.run('turn', (ctx) =>
    runTurn(ctx, game.book, 'a', {
      phases: ['draw', 'draw', 'play'],
      body: async (at, phase) => {
        if (phase.kind === 'draw') return defaultPhaseBody(at, phase, game.book);
        await runTurn(at, game.book, 'c', {
          phases: ['play'],
          body: async (child) => {
            await slash(child, 'nested');
          },
        });
        await slash(at, 'outer');
        suppress = true;
        await slash(at, 'cancelled', 'd');
      },
    }),
  );
  await answer(game, true);
  await answer(game, true);
  await running;
  const hits = game.room.history.facts(Damage.dealt).map((fact) => fact.data.detail.hpLoss);
  expect(hits).toEqual([1, 2, 1]);
  settled(game);
});

it('拒绝裸衣保留两张摸牌；零摸牌不询问，独立阶段不虚构回合效果', async () => {
  for (const branch of ['decline', 'zero', 'standalone'] as const) {
    const game = cardGame({
      hands: { a: [] },
      skills: standardGeneralSkills,
      effects: [luoyiAftereffect],
      draw: [card('one', 'jink'), card('two', 'jink')],
    });
    await grant(game, 'standard:luoyi');
    const running = game.room.run('turn', async (ctx) => {
      if (branch === 'standalone') await runPhase(ctx, game.book, 'a', 'draw');
      else
        await runTurn(ctx, game.book, 'a', {
          phases: ['draw'],
          body:
            branch === 'zero'
              ? async (at, phase) => {
                  await draw(at, { player: 'a', count: 0, reason: 'zero', phase });
                }
              : defaultPhaseBody,
        });
    });
    if (branch === 'decline') await answer(game, false);
    await running;
    expect(game.room.world.zone('a:hand').cards).toHaveLength(branch === 'zero' ? 0 : 2);
    expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  }
});

it('洛神连续黑牌归手、红牌弃置，不发摸牌窗口；一次宣告包含整个循环', async () => {
  const game = cardGame({
    hands: { a: [] },
    skills: [luoshen],
    draw: [card('black1', 'slash'), card('black2', 'jink', 'club'), card('red', 'peach', 'heart')],
  });
  const instance = (await grant(game, 'standard:luoshen')).id;
  let drawn = 0;
  game.room.on(Cards.drawn, {
    id: 'count',
    owner: 'a',
    eligible: () => true,
    run: () => {
      drawn++;
    },
  });
  const running = game.room.run('prepare', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
  await answer(game, true);
  const continuation = await nextRequest(game.room);
  expect(continuation.data).toMatchObject({
    skill: 'standard:luoshen',
    instance,
  });
  expect(game.room.decisions.submit(continuation.id, continuation.token, 'yes')).toMatchObject({
    kind: 'rejected',
    reason: 'invalid',
  });
  await answer(game, true);
  await answer(game, true);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['black1', 'black2']);
  expect(game.room.world.position('red')).toBe('discard');
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  expect(game.room.history.facts(Judgment.finished)).toHaveLength(3);
  expect(drawn).toBe(0);
  settled(game);
});

it('洛神可主动停止或完全拒绝，空牌堆也会正常结束', async () => {
  for (const branch of ['stop', 'decline', 'empty'] as const) {
    const game = cardGame({
      hands: { a: [] },
      skills: [luoshen],
      draw: branch === 'empty' ? [] : [card('first', 'slash'), card('second', 'jink')],
    });
    await grant(game, 'standard:luoshen');
    const running = game.room.run('prepare', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
    await answer(game, branch !== 'decline');
    if (branch === 'stop') await answer(game, false);
    await running;
    expect(game.room.world.zone('a:hand').cards).toHaveLength(branch === 'stop' ? 1 : 0);
    expect(game.room.history.facts(Judgment.finished)).toHaveLength(branch === 'decline' ? 0 : 1);
    expect(game.room.history.facts(Skill.invoked)).toHaveLength(branch === 'decline' ? 0 : 1);
  }
});

it.each([true, false])('洛神按最终改判颜色取牌，不沿用首次公开的颜色：黑色 %s', async (black) => {
  const game = cardGame({
    hands: { a: [], c: [card('replacement', 'jink', black ? 'club' : 'heart')] },
    skills: [luoshen],
    draw: [card('original', 'slash', black ? 'heart' : 'spade')],
  });
  await grant(game, 'standard:luoshen');
  game.room.on(Judgment.revealed, {
    id: 'retrial',
    owner: 'c',
    eligible: () => true,
    run: async (ctx, judgment) => {
      await judgment.replace(ctx, { card: 'replacement', from: 'c:hand', reason: 'test' });
    },
  });
  const running = game.room.run('prepare', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
  await answer(game, true);
  if (black) await answer(game, false);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(black ? ['replacement'] : []);
  expect(game.room.world.position('original')).toBe('discard');
  expect(game.room.world.position('replacement')).toBe(black ? 'a:hand' : 'discard');
  settled(game);
});

it('洛神判定后已被别人取走的黑牌不会抢回；失去技能也不截断已宣告的循环', async () => {
  const game = cardGame({
    hands: { a: [] },
    skills: [luoshen],
    draw: [card('first', 'slash'), card('second', 'jink'), card('red', 'peach', 'heart')],
  });
  await grant(game, 'standard:luoshen');
  game.room.on(Judgment.finished, {
    id: 'take-first-and-revoke',
    owner: 'c',
    eligible: (_ctx, result) => result.card?.id === 'first',
    run: async (ctx, result) => {
      await moveCards(
        ctx,
        [{ cards: ['first'], from: result.processing, to: 'c:hand', place: 'bottom' }],
        'take',
      );
      await game.skills.revoke(ctx, 'a', 'standard:luoshen', source);
    },
  });
  const running = game.room.run('prepare', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
  await answer(game, true);
  await answer(game, true);
  await answer(game, true);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['second']);
  expect(game.room.world.position('first')).toBe('c:hand');
  expect(game.room.history.facts(Judgment.finished)).toHaveLength(3);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  settled(game);
});

it('洛神回调只处理自己的判定，嵌套同原因判定不被错误取得', async () => {
  const game = cardGame({
    hands: { a: [] },
    skills: [luoshen],
    draw: [card('outer', 'slash'), card('nested', 'jink')],
  });
  await grant(game, 'standard:luoshen');
  let nested = false;
  game.room.on(Judgment.revealed, {
    id: 'nested',
    owner: 'a',
    eligible: () => !nested,
    run: async (ctx) => {
      nested = true;
      await judge(ctx, { player: 'a', reason: 'standard:luoshen', match: () => true });
    },
  });
  const running = game.room.run('prepare', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
  await answer(game, true);
  await answer(game, false);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['outer']);
  expect(game.room.world.position('nested')).toBe('discard');
  settled(game);
});

it('判定后目标死亡时，洛神不取得牌也不再询问', async () => {
  const game = cardGame({
    hands: { a: [] },
    skills: [luoshen],
    draw: [card('judge', 'slash')],
  });
  await grant(game, 'standard:luoshen');
  game.room.on(Judgment.finished, {
    id: 'die',
    owner: 'b',
    eligible: () => true,
    run: async (ctx) => {
      await kill(ctx, {
        player: 'a',
        killer: null,
        cause: { kind: 'rule', seq: null, data: 'test' },
        reason: 'rule',
      });
    },
  });
  const running = game.room.run('prepare', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
  await answer(game, true);
  await running;
  expect(game.room.world.player('a').alive).toBe(false);
  expect(game.room.world.position('judge')).toBe('discard');
});

it('倾国可用黑色手牌响应闪，拒绝红牌、装备和他人的牌，并沿用材料花色点数', async () => {
  const game = cardGame({
    hands: {
      a: [card('black', 'duel', 'club', 12), card('red', 'peach', 'heart')],
      b: [card('slash', 'slash'), card('foreign', 'duel')],
    },
    equipment: { a: [card('weapon', 'spear')] },
    skills: [qingguo],
  });
  const instance = (await grant(game, qingguo.id)).id;
  const running = use(game, {
    actor: 'b',
    choice: { kind: 'physical', card: 'slash' },
    targets: ['a'],
    timing: { kind: 'effect' },
  });
  const request = await nextRequest(game.room);
  for (const id of ['red', 'weapon', 'foreign'])
    expect(
      game.room.decisions.preview(request.id, {
        kind: 'viewAs',
        instance,
        recipe: 'black-jink',
        materials: [id],
      })!.valid,
    ).toBe(false);
  await answer(
    game,
    { kind: 'viewAs', instance, recipe: 'black-jink', materials: ['black'] },
    'card-response',
  );
  await running;
  expect(game.room.world.player('a').hp).toBe(4);
  expect(game.room.history.facts(CardEvent.used)[1]!.data.detail).toMatchObject({
    declaration: { card: { suit: 'club', rank: 12, name: 'standard:jink' } },
  });
  settled(game);
});

it('技能目录在装配期原子注册，挂接后禁止追加；工厂取得最终 CardBook', () => {
  const definition = defineSkill({ id: 'test:one', name: '甲', triggers: [] });
  const skills = new SkillBook([definition]);
  const other = defineSkill({ id: 'test:other', name: '乙', triggers: [] });
  expect(() => skills.register([other, definition])).toThrow(
    'Duplicate skill definition: test:one.',
  );
  expect(() => skills.definition(other.id)).toThrow(/Unknown/);
  expect(() => skills.register([other, { id: '', name: '缺少 ID' }])).toThrow(/requires an ID/);
  expect(() => skills.definition(other.id)).toThrow(/Unknown/);
  expect(skills.definition(definition.id)).toBe(definition);
  skills.register([other]);
  const detach = skills.attach(room());
  detach();
  expect(() => skills.register([])).toThrow(/sealed/);
  const game = cardGame({ skills: [ganglie] });
  expect(game.skills).toBeInstanceOf(SkillBook);
  expect(game.skills.definition('standard:ganglie').name).toBe('刚烈');
});

it.each(['wrong-owner', 'closed', 'foreign-world'] as const)(
  '显式阶段摸牌拒绝不属于当前结算的阶段句柄：%s',
  async (branch) => {
    const game = cardGame({ hands: { a: [] }, draw: [card('one', 'slash')] });
    let saved: PhaseView;
    if (branch === 'wrong-owner') {
      await expect(
        game.room.run('phase', (ctx) =>
          runPhase(ctx, game.book, 'a', 'draw', async (at, phase) => {
            await draw(at, { player: 'b', count: 1, reason: 'test', phase });
          }),
        ),
      ).rejects.toThrow(/does not belong/);
    } else if (branch === 'closed') {
      await game.room.run('phase', (ctx) =>
        runPhase(ctx, game.book, 'a', 'draw', (_at, phase) => {
          saved = phase;
        }),
      );
      await expect(
        game.room.run('stale', (ctx) =>
          draw(ctx, { player: 'a', count: 1, reason: 'test', phase: saved }),
        ),
      ).rejects.toThrow(/closed/);
    } else {
      const other = cardGame();
      await game.room.run('phase', (ctx) =>
        runPhase(ctx, game.book, 'a', 'draw', async (_at, phase) => {
          await expect(
            other.room.run('foreign', (at) =>
              draw(at, { player: 'a', count: 1, reason: 'test', phase }),
            ),
          ).rejects.toThrow(/outside/);
        }),
      );
    }
    expect(game.room.world.position('one')).toBe('draw');
    expect(game.room.history.facts(Draw.completed)).toEqual([]);
  },
);

it('含三名新魏将的八人局，由基础 AI 经公开决策走到真实身份胜负', async () => {
  const lineup = [...standardGenerals.slice(6, 9), ...standardGenerals.slice(0, 5)].map(
    (general) => general.id,
  );
  const match = createOfflineMatch({ seed: 42, preset: 'standard:identity', lineup });
  await playMatch(match, { steps: 4000 });
}, 60_000);
