import { expect, it } from 'vitest';
import { playMatch } from '../fixtures/match';
import {
  ArrangementSelection,
  runPhase,
  moveCards,
  draw,
  kill,
  finishGame,
  privateCardPools,
  withPrivateTopCards,
  useDeclarations,
  roleOf,
  Target,
  Cards,
  Phase,
} from '../../src/sdk';
import type { WorldSeed } from '../../src/core/model/state';
import type { ArrangementGroup, ArrangementSpec } from '../../src/core/decisions/arrangement';
import type { ChoiceItem, Context } from '../../src/sdk';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest, room } from '../fixtures/room';
import { standardGenerals, standardGeneralSkills } from '../../src/content/standard/generals';
import { standardCards } from '../../src/content/standard/cards';
import { RoleMatch } from '../../src/app/offline/role-match';
import { LocalSession } from '../../src/app/offline/session';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { projectMatch } from '../../src/app/offline/projection';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { decideBasic } from '../../src/app/offline/basic-agent';
import { rebuildWorld } from '../../src/core/history/rebuild';

type Game = ReturnType<typeof cardGame>;

it('分组模型拒绝异步候选或去向，查询故障先于续体写入冻结本局', async () => {
  for (const field of ['items', 'groups', 'canPlace'] as const) {
    const game = room();
    let at: Context;
    let lateError = '';
    const invalid = async () => {
      await Promise.resolve();
      try {
        at.commit('invalid.arrangement.late', [], null);
      } catch (error) {
        lateError = (error as Error).message;
      }
      return false;
    };
    const spec = {
      items: () => [{ id: 'one', label: '一' }],
      groups: [{ id: 'top', label: '牌顶', count: { min: 0, max: 'all' } }],
      canPlace: () => true,
      [field]: invalid,
    } as unknown as ArrangementSpec;
    const model = new ArrangementSelection(spec);
    const before = game.world.snapshot;
    await expect(
      game.run('arrange', (ctx) => {
        at = ctx;
        return ctx.ask(model.decision('a', '异步分组'));
      }),
    ).rejects.toThrow(`Queries cannot await (arrangement.${field})`);
    await Promise.resolve();
    expect(lateError).toContain('Queries cannot await');
    expect(game.status).toBe('faulted');
    expect(game.decisions.pending).toEqual([]);
    expect(game.world.snapshot).toBe(before);
    expect(game.history.facts()).toEqual([]);
  }
});
const source = { kind: 'general', id: 'test' } as const;
const cause = { kind: 'rule', seq: null, data: null } as const;
const groups: readonly ArrangementGroup[] = [
  { id: 'top', label: '牌顶', count: { min: 0, max: 'all' } },
  { id: 'bottom', label: '牌底', count: { min: 0, max: 'all' } },
];
const arranged = (top: readonly string[], bottom: readonly string[]) => ({
  groups: [
    { id: 'top', items: top },
    { id: 'bottom', items: bottom },
  ],
});
const topCards = () =>
  Array.from({ length: 6 }, (_, i) =>
    card(`x${i}`, i % 2 ? 'jink' : 'slash', i % 2 ? 'heart' : 'spade'),
  );
function model(ids = ['a', 'b', 'c']) {
  class Spec {
    #ids = ids;
    #groups = groups;
    #allow = true;

    items() {
      return this.#ids.map((id) => ({ id, label: id }));
    }

    groups() {
      return this.#groups;
    }

    canPlace() {
      return this.#allow;
    }
  }
  const spec = new Spec();
  const selection = new ArrangementSelection(spec);
  spec.items = () => [];
  spec.groups = () => [];
  spec.canPlace = () => false;
  return selection;
}
function scenario(options: Parameters<typeof cardGame>[0] = {}) {
  return cardGame({
    ...options,
    hands: { a: [], ...options.hands },
    draw: options.draw ?? topCards(),
    skills: standardGeneralSkills,
  });
}
async function grant(
  game: Pick<Game, 'room' | 'skills'>,
  skill = 'standard:guanxing',
  owner = 'a',
) {
  await game.room.run('grant', (ctx) => game.skills.grant(ctx, { owner, skill, source }));
}
const prepare = (game: Pick<Game, 'room' | 'book'>, actor = 'a') =>
  game.room.run('prepare', (ctx) => runPhase(ctx, game.book, actor, 'prepare'));
async function answer(game: Pick<Game, 'room'>, value: unknown, kind = 'invoke') {
  const request = await nextRequest(game.room);
  expect(request.kind).toBe(kind);
  expect(game.room.decisions.submit(request.id, request.token, value)).toEqual({
    kind: 'accepted',
  });
}
function replay(game: Pick<Game, 'room'> & { readonly initial: WorldSeed }) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.world.snapshot.zones.filter((z) => z.kind === 'processing')).toEqual([]);
  expect(game.room.world.snapshot.states.filter((s) => s.key === 'core:private-pool')).toEqual([]);
  expect(useDeclarations(game.room.world)).toEqual([]);
  expect(game.room.decisions.pending).toEqual([]);
}

it('排序模型按组 ID 验证，组内先后保留，输入/输出均不共享可变数组', () => {
  class Item {
    constructor(readonly id: string) {}

    get label() {
      return `选项 ${this.id}`;
    }
  }
  const items = ['a', 'b', 'c'].map((id) => new Item(id));
  const selection = new ArrangementSelection({ items: () => items, groups });
  const input = {
    groups: [
      { id: 'bottom', items: ['c'] },
      { id: 'top', items: ['b', 'a'] },
    ],
  };
  const result = selection.validate(input);
  expect(result).toEqual({ ok: true, value: arranged(['b', 'a'], ['c']) });
  input.groups[0]!.items.push('a');
  expect(result).toEqual({ ok: true, value: arranged(['b', 'a'], ['c']) });
  if (result.ok) expect(Object.isFrozen(result.value.groups[0]!.items)).toBe(true);
});
it.each([
  null,
  [],
  { groups: 'top' },
  { groups: [{ id: 1, items: [] }] },
  arranged(['a', 'a'], ['c']),
  arranged(['a'], ['b']),
  arranged(['a', 'b'], ['foreign']),
  {
    groups: [
      { id: 'top', items: ['a'] },
      { id: 'top', items: ['b', 'c'] },
    ],
  },
  {
    groups: [
      { id: 'unknown', items: ['a'] },
      { id: 'bottom', items: ['b', 'c'] },
    ],
  },
])('排序模型拒绝畸形、重复、遗漏和未知项：%j', (input) => {
  expect(model().validate(input).ok).toBe(false);
});
it('排序模型不是观星特例：三个分组、上下限与空候选均可验证', () => {
  const selection = new ArrangementSelection({
    items: () => ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id })),
    groups: [
      { id: 'one', label: '一', count: { min: 1, max: 1 } },
      { id: 'two', label: '二', count: { min: 2, max: 2 } },
      { id: 'rest', label: '余', count: { min: 0, max: 'all' } },
    ],
  });
  expect(selection.validate(selection.initial()).ok).toBe(true);
  expect(selection.initial().groups.map((g) => g.items.length)).toEqual([1, 2, 1]);
  expect(
    selection.validate({
      groups: [
        { id: 'one', items: [] },
        { id: 'two', items: ['a', 'b'] },
        { id: 'rest', items: ['c', 'd'] },
      ],
    }).ok,
  ).toBe(false);
  expect(model([]).validate(arranged([], [])).ok).toBe(true);
});
it('排序配置拒绝空槽、空分组与重复身份', () => {
  expect(() => new ArrangementSelection({ items: () => [], groups: [] })).toThrow();
  expect(
    () => new ArrangementSelection({ items: () => [], groups: [groups[0]!, groups[0]!] }),
  ).toThrow();
  expect(() => model(['a', 'a']).initial()).toThrow('distinct stable IDs');
  expect(() =>
    new ArrangementSelection({
      items: () => new Array<ChoiceItem>(1),
      groups: [{ id: 'none', label: '空组', count: { min: 0, max: 0 } }],
    }).decision('a', '配置检查').available!(),
  ).toThrow();
});
it('没有足够分组容量时返回 unavailable，不开放必选等待', async () => {
  const target = room();
  const selection = new ArrangementSelection({
    items: () => ['a', 'b'].map((id) => ({ id, label: id })),
    groups: [{ id: 'one', label: '一', count: { min: 0, max: 1 } }],
  });
  expect(
    await target.run('choose', (ctx) => ctx.ask(selection.decision('a', 'arrange'))),
  ).toMatchObject({ value: { kind: 'unavailable' } });
  expect(target.decisions.pending).toEqual([]);
});
it('实时候选刷新使旧 token 和旧集合失效，必选不可取消，一次回复只接纳一次', async () => {
  const target = room();
  const items = ['a', 'b', 'c'];
  const selection = model(items);
  const running = target.run('choose', (ctx) => ctx.ask(selection.decision('a', 'arrange')));
  const old = await nextRequest(target);
  expect(target.decisions.cancel(old.id, old.token)).toMatchObject({
    kind: 'rejected',
    reason: 'required',
  });
  items.pop();
  target.decisions.invalidate(old.id);
  const fresh = target.decisions.pending[0]!;
  expect(target.decisions.submit(old.id, old.token, arranged(items, []))).toMatchObject({
    reason: 'stale',
  });
  expect(
    target.decisions.submit(fresh.id, fresh.token, arranged(['a', 'b', 'c'], [])),
  ).toMatchObject({ reason: 'invalid' });
  expect(target.decisions.preview(fresh.id, arranged(['b'], ['a']))?.valid).toBe(true);
  expect(target.decisions.submit(fresh.id, fresh.token, arranged(['b'], ['a']))).toEqual({
    kind: 'accepted',
  });
  expect(target.decisions.submit(fresh.id, fresh.token, arranged(['b'], ['a']))).toMatchObject({
    reason: 'closed',
  });
  expect(await running).toMatchObject({ value: { kind: 'chosen', value: arranged(['b'], ['a']) } });
});

it.each([2, 4, 8])('诸葛亮初始化与观星数量按 %s 人局存活人数计算，上限五张', async (count) => {
  expect(standardGenerals).toHaveLength(25);
  const match = createOfflineMatch({
    seed: 19,
    preset: 'standard:identity',
    lineup: Array<string>(count).fill('standard:zhugeliang'),
  });
  await match.prepare();
  expect(match.room.world.player('甲席').maxHp).toBe(
    3 + Number(count > 4 && roleOf(match.room.world, '甲席') === 'lord'),
  );
  const running = prepare(match, '甲席');
  await answer(match, true);
  const request = await nextRequest(match.room);
  expect(request.kind).toBe('arrange');
  expect(privateCardPools(match.room.world, '甲席')[0]!.cards).toHaveLength(Math.min(5, count));
  const initial = (request.data as { initial: unknown }).initial;
  await answer(match, initial, 'arrange');
  await running;
  replay(match);
});
it('观星两组顺序真实移入同一牌堆，既不是摸牌也不产生手牌得失', async () => {
  const game = scenario();
  await grant(game);
  const before = game.room.world.zone('draw').cards;
  const running = prepare(game);
  await answer(game, true);
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('arrange');
  expect(game.room.world.zone('a:hand').cards).toEqual([]);
  expect(game.room.history.facts('cards.drawn')).toEqual([]);
  await answer(game, arranged(['x2', 'x0'], ['x3', 'x1']), 'arrange');
  await running;
  expect(before).toEqual(['x0', 'x1', 'x2', 'x3', 'x4', 'x5']);
  expect(game.room.world.zone('draw').cards).toEqual(['x2', 'x0', 'x4', 'x5', 'x3', 'x1']);
  expect(game.room.history.facts('cards.arranged')).toHaveLength(1);
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  await game.room.run('draw', (ctx) => draw(ctx, { player: 'a', count: 2, reason: 'test' }));
  expect(game.room.world.zone('a:hand').cards).toEqual(['x2', 'x0']);
  replay(game);
});
it('观星计数排除阵亡席位，必选排序的非法重复回复不改变牌堆或支付次数', async () => {
  const game = scenario();
  await grant(game);
  await game.room.run('death', (ctx) =>
    kill(ctx, { player: 'd', killer: null, reason: 'rule', cause }),
  );
  const running = prepare(game);
  await answer(game, true);
  const request = await nextRequest(game.room);
  expect(privateCardPools(game.room.world, 'a')[0]!.cards).toEqual(['x0', 'x1', 'x2']);
  const before = game.room.world.snapshot;
  expect(
    game.room.decisions.submit(request.id, request.token, arranged(['x0', 'x1'], ['x1'])),
  ).toMatchObject({ kind: 'rejected', reason: 'invalid' });
  expect(game.room.world.snapshot).toEqual(before);
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  await answer(game, arranged(['x2'], ['x0', 'x1']), 'arrange');
  await running;
  expect(game.room.world.zone('draw').cards).toEqual(['x2', 'x3', 'x4', 'x5', 'x0', 'x1']);
  replay(game);
});
it.each(['top', 'bottom'] as const)('观星允许全部置于 %s，空组不吞牌不倒序', async (side) => {
  const game = scenario();
  await grant(game);
  const running = prepare(game);
  await answer(game, true);
  const cards = ['x3', 'x2', 'x1', 'x0'];
  await answer(
    game,
    arranged(side === 'top' ? cards : [], side === 'bottom' ? cards : []),
    'arrange',
  );
  await running;
  expect(game.room.world.zone('draw').cards).toEqual(
    side === 'top' ? [...cards, 'x4', 'x5'] : ['x4', 'x5', ...cards],
  );
  replay(game);
});
it('拒绝发动不取牌；跳过准备阶段与他人准备阶段均不询问', async () => {
  const game = scenario();
  await grant(game);
  const running = prepare(game);
  await answer(game, false);
  await running;
  expect(game.room.history.facts('cards.peeked')).toEqual([]);
  await prepare(game, 'b');
  game.room.on(Phase.before, {
    id: 'skip',
    owner: null,
    eligible: () => true,
    run: (ctx, phase) => phase.skip(ctx, 'test'),
  });
  await prepare(game);
  expect(game.room.history.facts('skill.invoked')).toEqual([]);
  expect(game.room.world.zone('draw').cards).toEqual(topCards().map((c) => c.id));
  replay(game);
});
it('观星可洗入弃牌，仍不足则使用实有牌；空牌堆无必选排序等待', async () => {
  for (const count of [0, 1, 3]) {
    const game = scenario({ draw: [], discard: topCards().slice(0, count) });
    await grant(game);
    const running = prepare(game);
    await answer(game, true);
    if (count) {
      const request = await nextRequest(game.room);
      expect(privateCardPools(game.room.world, 'a')[0]!.cards).toHaveLength(count);
      await answer(game, (request.data as { initial: unknown }).initial, 'arrange');
    }
    await running;
    expect(game.room.world.zone('draw').cards).toHaveLength(count);
    expect(game.room.world.zone('discard').cards).toEqual([]);
    replay(game);
  }
});
it.each(['lost', 'dead', 'finished', 'taken'] as const)(
  '观星已宣告后 %s，私有余牌按领域规则回顶而非弃置',
  async (mode) => {
    const game = scenario();
    await grant(game);
    let peeked = false;
    game.room.on(Cards.moved, {
      id: 'change',
      owner: null,
      eligible: (_ctx, moved) =>
        !peeked && moved.moves.some((m) => m.from === 'draw' && m.to.startsWith('processing:')),
      async run(ctx, moved) {
        peeked = true;
        if (mode === 'lost') await game.skills.revoke(ctx, 'a', 'standard:guanxing', source);
        else if (mode === 'dead')
          await kill(ctx, { player: 'a', killer: null, reason: 'rule', cause });
        else if (mode === 'finished') await finishGame(ctx, { winners: ['b'], reason: 'test' });
        else
          await moveCards(
            ctx,
            [{ cards: ['x1'], from: moved.moves[0]!.to, to: 'b:hand', place: 'bottom' }],
            'test',
          );
      },
    });
    const running = prepare(game);
    await answer(game, true);
    if (mode === 'lost' || mode === 'taken') {
      const request = await nextRequest(game.room);
      const count = mode === 'taken' ? 3 : 4;
      expect(privateCardPools(game.room.world, 'a')[0]!.cards).toHaveLength(count);
      await answer(game, (request.data as { initial: unknown }).initial, 'arrange');
    }
    await running;
    expect(game.room.world.zone('discard').cards).toEqual([]);
    expect(game.room.world.zone('draw').cards).toEqual(
      topCards()
        .map((c) => c.id)
        .filter((id) => mode !== 'taken' || id !== 'x1'),
    );
    replay(game);
  },
);
it('私有取牌的自定义善后在局部中止后归还实时余牌，已经转交的牌不重复移动', async () => {
  const game = scenario();
  const result = await game.room.run('peek', (ctx) =>
    withPrivateTopCards(
      ctx,
      { player: 'a', count: 3, reason: 'test' },
      async (at, pool) => {
        await moveCards(
          at,
          [{ cards: ['x1'], from: pool.zone, to: 'b:hand', place: 'bottom' }],
          'test',
        );
        return at.abort('local');
      },
      async (at, pool) => {
        expect(pool.lifetime.active).toBe(true);
        expect(privateCardPools(at.world, 'a')[0]!.cards).toEqual(['x0', 'x2']);
        await moveCards(
          at,
          [{ cards: pool.remaining(), from: pool.zone, to: 'draw', place: 'top' }],
          'return',
        );
      },
    ),
  );
  expect(result).toMatchObject({ kind: 'aborted', reason: 'local' });
  expect(game.room.world.zone('draw').cards).toEqual(['x0', 'x2', 'x3', 'x4', 'x5']);
  expect(game.room.world.position('x1')).toBe('b:hand');
  replay(game);
});
function privateMatch() {
  return new RoleMatch({
    id: 'private-stars',
    seed: 17,
    players: [{ id: 'a' }, { id: 'b' }],
    content: {
      cards: standardCards,
      skills: standardGeneralSkills,
    },
    deck: [
      card('secret0', 'ex_nihilo', 'heart'),
      card('secret1', 'collateral'),
      card('next', 'slash'),
    ],
  });
}
it('排序请求和牌面只给本人，其他投影/AI 不知牌序；公开日志仅给上下数量', async () => {
  const match = privateMatch();
  await grant(match);
  const running = prepare(match);
  await answer(match, true);
  const request = await nextRequest(match.room);
  expect(projectMatch(match, 'a', request).decision?.kind).toBe('arrange');
  expect(observeAgent(match, 'a').pools).toHaveLength(2);
  for (const viewer of ['b', null]) {
    const view = projectMatch(match, viewer, request);
    expect(JSON.stringify(view)).not.toMatch(/secret0|secret1|无中生有|借刀杀人/);
    expect(view.pools).toEqual([]);
  }
  expect(observeAgent(match, 'b').pools).toEqual([]);
  await answer(match, arranged(['secret1'], ['secret0']), 'arrange');
  await running;
  const publicView = projectMatch(match, 'b', null);
  expect(publicView.log.at(-1)?.text).toContain('1 张置顶，1 张置底');
  expect(JSON.stringify(publicView)).not.toMatch(/secret0|secret1|无中生有|借刀杀人/);
  replay(match);
});
it('主持侧专用预览经过授权；暂停藏牌和请求，恢复同一排序且拒绝暂停时回复', async () => {
  const match = privateMatch();
  await grant(match);
  await match.prepare();
  await match.room.run('restore', (ctx) =>
    moveCards(
      ctx,
      match.initial.cards.map((card) => ({
        cards: [card.id],
        from: ctx.world.position(card.id),
        to: 'draw',
        place: 'bottom',
      })),
      'test:restore',
    ),
  );
  const session = new LocalSession(match, { human: 'a' });
  const running = prepare(match);
  await answer(match, true);
  const request = await nextRequest(match.room);
  const choice = arranged(['secret1'], ['secret0']);
  expect(session.view.decision?.kind).toBe('arrange');
  expect(session.inspectAnswer(request.id, request.token, choice).valid).toBe(true);
  session.hide();
  expect(session.view.decision).toBeNull();
  expect(session.view.pools).toEqual([]);
  expect(session.inspectAnswer(request.id, request.token, choice).valid).toBe(false);
  expect(session.answer(request.id, request.token, choice).kind).toBe('rejected');
  session.resume();
  expect(session.view.decision?.id).toBe(request.id);
  expect(session.answer(request.id, request.token, choice)).toEqual({ kind: 'accepted' });
  await running;
  session.dispose();
  replay(match);
});
it('基础 AI 仅按可见私有牌排序，保留全部牌在顶，未知排序模型回退合法初始分组', async () => {
  const match = privateMatch();
  await grant(match);
  const running = prepare(match);
  await answer(match, true);
  const request = await nextRequest(match.room);
  const custom = arranged(['secret1'], ['secret0']);
  expect(
    decideBasic(
      observeAgent(match, 'a'),
      {
        ...request,
        data: {
          ...(request.data as Record<string, unknown>),
          initial: custom,
          reason: 'author:groups',
        },
      },
      (input) => match.room.decisions.preview(request.id, input),
    ),
  ).toEqual({ kind: 'submit', value: custom });
  const response = decideBasic(observeAgent(match, 'a'), request, (input) =>
    match.room.decisions.preview(request.id, input),
  );
  expect(response.kind).toBe('submit');
  if (response.kind !== 'submit') throw new Error('Expected arrangement.');
  expect(match.room.decisions.preview(request.id, response.value)?.valid).toBe(true);
  expect(match.room.decisions.submit(request.id, request.token, response.value)).toEqual({
    kind: 'accepted',
  });
  await running;
  replay(match);
});

it('空城只禁止空手角色成为杀/决斗目标，装备、私有池和响应资格分别处理', async () => {
  const game = scenario({
    hands: { a: [card('s', 'slash'), card('duel', 'duel'), card('mass', 'archery_attack')] },
    equipment: { b: [card('armor', 'eight_diagram')] },
  });
  await grant(game, 'standard:kongcheng', 'b');
  for (const id of ['s', 'duel'])
    expect(
      await use(game, {
        actor: 'a',
        choice: { kind: 'physical', card: id },
        targets: ['b'],
        timing: { kind: 'effect' },
      }),
    ).toMatchObject({ value: { kind: 'unavailable' } });
  await game.room.run('private', (ctx) =>
    withPrivateTopCards(ctx, { player: 'b', count: 1, reason: 'test' }, (at) => {
      expect(game.book.isTargetProhibited(at, 'a', 'b', game.book.physicalCard(at, 's'))).toBe(
        true,
      );
      return undefined;
    }),
  );
  const mass = use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 'mass' },
    targets: [],
    timing: { kind: 'effect' },
  });
  await answer(game, true);
  await mass;
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.history.facts('card.responded')).toHaveLength(1);
  await game.room.run('lose-skill', (ctx) =>
    game.skills.revoke(ctx, 'b', 'standard:kongcheng', source),
  );
  await game.room.run('check', (ctx) => {
    expect(game.book.isTargetProhibited(ctx, 'a', 'b', game.book.physicalCard(ctx, 's'))).toBe(
      false,
    );
  });
  replay(game);
});
it('空城目标确认后失去最后手牌，实际效果重查跳过；决斗已经开始则正常继续', async () => {
  const game = scenario({ hands: { a: [card('duel', 'duel')], b: [card('s', 'slash')] } });
  await grant(game, 'standard:kongcheng', 'b');
  const running = use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 'duel' },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  await answer(game, { kind: 'physical', card: 's' }, 'card-response');
  await running;
  expect(game.room.world.player('a').hp).toBe(3);
  expect(game.room.world.player('b').hp).toBe(4);
  expect(game.room.world.zone('b:hand').cards).toEqual([]);
  replay(game);
  const skipped = scenario({ hands: { a: [card('s', 'slash')], b: [card('last', 'peach')] } });
  await grant(skipped, 'standard:kongcheng', 'b');
  skipped.room.on(Target.confirmed, {
    id: 'remove-last',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await moveCards(
        ctx,
        [{ cards: ['last'], from: 'b:hand', to: 'discard', place: 'bottom' }],
        'test',
      );
    },
  });
  expect(
    await use(skipped, {
      actor: 'a',
      choice: { kind: 'physical', card: 's' },
      targets: ['b'],
      timing: { kind: 'effect' },
    }),
  ).toMatchObject({ value: { use: { effects: [{ state: 'skipped' }] } } });
  expect(skipped.room.world.player('b').hp).toBe(4);
  replay(skipped);
});
it('混合八人标准对局的观星由基础 AI 经正式选择完成，最终产生真实胜负', async () => {
  const roster = [
    'zhugeliang',
    'caocao',
    'zhouyu',
    'daqiao',
    'zhugeliang',
    'liubei',
    'diaochan',
    'lvbu',
  ].map((id) => `standard:${id}`);
  const match = createOfflineMatch({ seed: 27, preset: 'standard:identity', lineup: roster });
  await playMatch(match, { steps: 24000 });

  expect(match.room.history.facts('cards.arranged').length).toBeGreaterThan(0);
}, 60000);
