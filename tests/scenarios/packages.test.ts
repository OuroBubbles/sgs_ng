import { expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import {
  definePackage,
  resolvePackages,
  defineSkill,
  defineWindow,
  on,
  moveCards,
  loseHp,
} from '../../src/sdk';
import type { CardBook, ContentPackage } from '../../src/sdk';
import standard from '../../src/content/standard';
import {
  availablePackages,
  createOfflineMatch,
  defaultContent,
} from '../../src/app/offline/practice';
import { cardView } from '../../src/app/offline/projection';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { decideBasic } from '../../src/app/offline/basic-agent';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { nextRequest } from '../fixtures/room';

function pack(
  id: string,
  extra: Omit<ContentPackage, 'manifest'> = {},
  requires: readonly string[] = [],
): ContentPackage {
  return definePackage({
    manifest: { id, name: id, version: '1', requires: requires.map((id) => ({ id })) },
    ...extra,
  });
}
const content = () => resolvePackages(availablePackages, ['workshop']);

it('源码发现与显式选择：默认 32 牌 / 25 将 / 108 实体；演武扩展 37 牌 / 30 将 / 五种演武牌堆', () => {
  const discovered = availablePackages.map((entry) => entry.manifest.id);
  expect(discovered).toEqual(expect.arrayContaining(['standard', 'workshop']));
  expect(new Set(discovered).size).toBe(discovered.length);
  expect(defaultContent.cards).toHaveLength(32);
  expect(defaultContent.generals).toHaveLength(25);
  expect(defaultContent.createDeck('standard:identity')).toHaveLength(108);
  expect(defaultContent.createDeck('standard:mechanics')).toHaveLength(288);
  expect(() => defaultContent.createDeck('workshop:showcase')).toThrow(/Unknown deck/);
  const selected = content();
  expect(selected.cards).toHaveLength(37);
  expect(selected.generals).toHaveLength(30);
  expect(selected.createDeck('workshop:faces')).toHaveLength(40);
  expect(selected.createDeck('workshop:showcase')).toHaveLength(44);
  expect(selected.createDeck('workshop:relics')).toHaveLength(40);
  expect(selected.createDeck('workshop:chains')).toHaveLength(48);
  expect(selected.createDeck('workshop:defense')).toHaveLength(48);
  expect(selected.versions.map((entry) => entry.id)).toEqual(['standard', 'workshop']);
});

it('依赖闭包去重且确定：每次装配依赖优先，工厂恰好执行一次并拿到实际目录', () => {
  const seen: CardBook[] = [];
  const calls: string[] = [];
  const factory = (id: string) =>
    pack(
      id,
      {
        skills: (book) => {
          calls.push(id);
          seen.push(book);
          return [];
        },
      },
      id === 'base' ? [] : ['base'],
    );
  const entries = ['z', 'base', 'a'].map(factory);
  const selected = resolvePackages(entries, ['z', 'a', 'z']);
  expect(calls).toEqual([]);
  expect(selected.versions.map((entry) => entry.id)).toEqual(['base', 'a', 'z']);
  const one = selected.createBooks();
  expect(calls).toEqual(['base', 'a', 'z']);
  expect(seen.every((book) => book === one.book && book.skills === one.skills)).toBe(true);
  const two = selected.createBooks();
  expect(two.book).not.toBe(one.book);
  expect(two.skills).not.toBe(one.skills);
  expect(seen.slice(3).every((book) => book === two.book)).toBe(true);
});

it('缺失包报告依赖方；循环与重复包均在装配前拒绝', () => {
  expect(() => resolvePackages([], ['unknown'])).toThrow(/Missing package: unknown/);
  expect(() => resolvePackages([pack('a', {}, ['missing'])], ['a'])).toThrow(/missing.*a/);
  expect(() => resolvePackages([pack('a', {}, ['b']), pack('b', {}, ['a'])], ['a'])).toThrow(
    /a -> b -> a/,
  );
  expect(() => resolvePackages([pack('a'), pack('a')], ['a'])).toThrow(/Duplicate package: a/);
});

it('根选择与依赖使用同一码点序，不受平台语言排序影响', () => {
  const entries = [pack('a_b'), pack('a-b'), pack('root', {}, ['a_b', 'a-b'])];
  const root = resolvePackages(entries, ['root']);
  const direct = resolvePackages(entries, ['a_b', 'a-b']);
  expect(root.versions.map((entry) => entry.id)).toEqual(['a-b', 'a_b', 'root']);
  expect(direct.versions.map((entry) => entry.id)).toEqual(['a-b', 'a_b']);
});

it('精确版本校验覆盖已访问的共享依赖，不默选另一个版本', () => {
  const extension = definePackage({
    manifest: { id: 'extra', name: '额外', version: '1', requires: [{ id: 'base', version: '2' }] },
  });
  expect(() => resolvePackages([pack('base'), extension], ['base', 'extra'])).toThrow(
    /base requires 2, found 1/,
  );
});

for (const [name, extra] of [
  ['牌', { cards: [{ id: 'foreign:card', type: 'basic', label: '牌' }] }],
  [
    '武将',
    {
      generals: [
        { id: 'foreign:guest', name: '客', kingdom: '群', gender: 'none', maxHp: 4, skills: [] },
      ],
    },
  ],
  ['牌组', { decks: [{ id: 'foreign:deck', label: '牌堆', create: () => [] }] }],
  ['展示', { cardViews: [{ id: 'foreign:card', kind: 'other', description: '牌' }] }],
] satisfies readonly [string, Omit<ContentPackage, 'manifest'>][]) {
  it(`${name}定义必须归属包自己的命名空间`, () => {
    expect(() => pack('own', extra)).toThrow(/own.*namespace.*foreign/);
  });
}

it('同包重复内容拒绝，不覆盖已有定义', () => {
  const card = { id: 'own:card', type: 'basic' as const, label: '牌' };
  expect(() => pack('own', { cards: [card, card] })).toThrow(/Duplicate card/);
  const deck = { id: 'own:deck', label: '牌堆', create: () => [] };
  expect(() => pack('own', { decks: [deck, deck] })).toThrow(/Duplicate deck/);
});

it('工厂返回的技能也校验归属和重复；独立装配失败不污染已建目录', () => {
  const skill = defineSkill({ id: 'own:skill', name: '技', effects: [] });
  const existing = resolvePackages([pack('own', { skills: [skill] })], ['own']).createBooks();
  expect(() =>
    resolvePackages([pack('other', { skills: () => [skill] })], ['other']).createBooks(),
  ).toThrow(/other.*namespace/);
  expect(() =>
    resolvePackages([pack('own', { skills: () => [skill, skill] })], ['own']).createBooks(),
  ).toThrow(/Duplicate/);
  expect(existing.skills.definition(skill.id).id).toBe(skill.id);
});

it('武将技能引用必须存在，并属于自己或传递依赖，不能偷用同时选中的兄弟包', () => {
  const base = pack('base', {
    skills: [defineSkill({ id: 'base:skill', name: '技', effects: [] })],
  });
  const guest = {
    id: 'guest:general',
    name: '客',
    kingdom: '群',
    gender: 'none' as const,
    maxHp: 4,
    skills: ['base:skill'],
  };
  expect(() =>
    resolvePackages([base, pack('guest', { generals: [guest] })], ['base', 'guest']).createBooks(),
  ).toThrow(/declared dependency/);
  expect(() =>
    resolvePackages(
      [pack('guest', { generals: [{ ...guest, skills: ['guest:missing'] }] })],
      ['guest'],
    ).createBooks(),
  ).toThrow(/Unknown skill/);
  const selected = resolvePackages(
    [base, pack('middle', {}, ['base']), pack('guest', { generals: [guest] }, ['middle'])],
    ['guest'],
  );
  expect(selected.createBooks().generals.definition(guest.id).skills).toEqual(['base:skill']);
});

it('展示不能引用未定义的牌；实体牌名必须存在且声明跨包依赖', () => {
  expect(() =>
    resolvePackages(
      [pack('own', { cardViews: [{ id: 'own:missing', kind: 'other', description: '' }] })],
      ['own'],
    ),
  ).toThrow(/unknown card/);
  const deck = (name: string) => ({
    id: 'own:deck',
    label: '牌堆',
    create: () => [{ id: 'one', name, suit: 'heart' as const, rank: 1 }],
  });
  expect(() =>
    resolvePackages([pack('own', { decks: [deck('own:missing')] })], ['own']).createDeck(
      'own:deck',
    ),
  ).toThrow(/Unknown card/);
  expect(() =>
    resolvePackages(
      [standard, pack('own', { decks: [deck('standard:slash')] })],
      ['standard', 'own'],
    ).createDeck('own:deck'),
  ).toThrow(/declared dependency/);
});

it('实体 ID 不可重复，未知牌堆不能退回默认牌堆', () => {
  const physical = { id: 'same', name: 'own:card', suit: 'none' as const, rank: 0 };
  const selected = resolvePackages(
    [
      pack('own', {
        cards: [{ id: 'own:card', type: 'basic', label: '牌' }],
        decks: [{ id: 'own:deck', label: '牌堆', create: () => [physical, physical] }],
      }),
    ],
    ['own'],
  );
  expect(() => selected.createDeck('own:deck')).toThrow(/Duplicate physical card/);
  expect(() => selected.createDeck('unknown')).toThrow(/Unknown deck/);
});

it('版本声明与列表冻结，但 Window token 身份保留，普通闭包继续工作', () => {
  const manifest = { id: 'own', name: '本包', version: '1' };
  const window = defineWindow<null>('own.test');
  const run = vi.fn();
  const skill = defineSkill({
    id: 'own:skill',
    name: '技',
    effects: [on(window, { id: 'effect', run })],
  });
  const entry = definePackage({ manifest, skills: [skill] });
  manifest.version = 'changed';
  const selected = resolvePackages([entry], ['own']);
  const { skills } = selected.createBooks();
  expect(selected.versions).toEqual([{ id: 'own', version: '1' }]);
  expect(Object.isFrozen(selected.versions[0])).toBe(true);
  expect(skills.definition(skill.id).effects[0]!.window).toBe(window);
});

it('包清单在发牌前成为可重建事实；扩展说明投影保留实体 ID，跨包武圣正常授予', async () => {
  const match = createOfflineMatch(
    2,
    1,
    'workshop:showcase',
    ['workshop:guest', 'standard:guanyu'],
    content(),
  );
  await match.prepare();
  expect(match.room.history.facts()[0]!.data.kind).toBe('match.content');
  expect(match.room.history.facts('match.content')[0]!.data.detail).toEqual({
    packages: content().versions,
  });
  expect(
    match.room.world.snapshot.states.find((state) => state.key === 'content:selection')?.value,
  ).toEqual(content().versions);
  const view = cardView(match, 'workshop-card-41');
  expect(view).toMatchObject({ id: 'workshop-card-41', name: '整备', kind: 'trick' });
  expect(view.description).toContain('回复 1 点体力');
  expect(
    match.room.world.snapshot.skills
      .filter((skill) => skill.owner === '甲席')
      .map((skill) => skill.skill)
      .sort(),
  ).toEqual(['standard:wusheng', 'workshop:hearing']);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
});

for (const branch of ['draw', 'recover'] as const) {
  it(`演武包经实际目录完成闻策与整备 ${branch} 分支，使用普通选择并清理材料`, async () => {
    const match = createOfflineMatch(
      2,
      1,
      'workshop:showcase',
      ['workshop:guest', 'standard:guanyu'],
      content(),
    );
    await match.prepare();
    const id = 'workshop-card-41';
    await match.room.run('fixture', async (ctx) => {
      await moveCards(
        ctx,
        [{ cards: [id], from: ctx.world.position(id), to: '甲席:hand', place: 'bottom' }],
        'fixture',
      );
      if (branch === 'recover') await loseHp(ctx, { player: '甲席', amount: 1, reason: 'fixture' });
    });
    const before = match.room.world.zone('甲席:hand').cards.length;
    const hp = match.room.world.player('甲席').hp;
    const running = match.room.run('test-use', (ctx) =>
      match.book.use(ctx, {
        actor: '甲席',
        choice: { kind: 'physical', card: id },
        targets: ['甲席'],
        timing: { kind: 'effect' },
      }),
    );
    const trigger = await nextRequest(match.room);
    expect(trigger.prompt).toContain('闻策');
    expect(match.room.decisions.submit(trigger.id, trigger.token, true)).toEqual({
      kind: 'accepted',
    });
    const option = await nextRequest(match.room);
    expect(option.kind).toBe('choose-option');
    expect(
      decideBasic(observeAgent(match, '甲席'), option, (input) =>
        match.room.decisions.preview(option.id, input),
      ),
    ).toEqual({ kind: 'submit', value: 'draw' });
    if (branch === 'draw')
      expect(match.room.decisions.preview(option.id, 'recover')?.valid).toBe(false);
    expect(match.room.decisions.submit(option.id, option.token, branch)).toEqual({
      kind: 'accepted',
    });
    expect(await running).toMatchObject({
      kind: 'resolved',
      value: { kind: 'resolved', value: { kind: 'used' } },
    });
    expect(match.room.world.zone('甲席:hand').cards).toHaveLength(
      before + (branch === 'draw' ? 2 : 0),
    );
    expect(match.room.world.player('甲席').hp).toBe(hp + (branch === 'recover' ? 1 : 0));
    expect(match.room.world.position(id)).toBe('discard');
    expect(match.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  });
}

it('跨包闻策也能响应标准锦囊，工厂未捕获另一套规则目录', async () => {
  const match = createOfflineMatch(
    2,
    1,
    'workshop:showcase',
    ['workshop:guest', 'standard:guanyu'],
    content(),
  );
  await match.prepare();
  const id = 'workshop-card-37';
  await match.room.run('fixture', (ctx) =>
    moveCards(
      ctx,
      [{ cards: [id], from: ctx.world.position(id), to: '甲席:hand', place: 'bottom' }],
      'fixture',
    ),
  );
  const running = match.room.run('use', (ctx) =>
    match.book.use(ctx, {
      actor: '甲席',
      choice: { kind: 'physical', card: id },
      targets: ['甲席'],
      timing: { kind: 'effect' },
    }),
  );
  const trigger = await nextRequest(match.room);
  expect(trigger.prompt).toContain('闻策');
  match.room.decisions.submit(trigger.id, trigger.token, false);
  expect(await running).toMatchObject({ kind: 'resolved' });
});

it('作者包与基础 AI 共用标准动作/具名选项，真实完成整局，无必选卡死', async () => {
  const match = createOfflineMatch(
    4,
    42,
    'workshop:showcase',
    ['workshop:guest', 'standard:guanyu', 'workshop:guest', 'standard:zhaoyun'],
    content(),
  );
  const running = match.start();
  let decisions = 0;
  try {
    while (!match.result && decisions < 1800) {
      await setImmediate();
      const request = match.room.decisions.pending[0];
      if (!request) {
        expect(match.room.status).not.toBe('faulted');
        continue;
      }
      const answer = decideBasic(observeAgent(match, request.player), request, (input) =>
        match.room.decisions.preview(request.id, input),
      );
      expect(answer.kind, request.prompt).not.toBe('unsupported');
      if (answer.kind === 'unsupported') break;
      const reply =
        answer.kind === 'cancel'
          ? match.room.decisions.cancel(request.id, request.token)
          : match.room.decisions.submit(request.id, request.token, answer.value);
      expect(reply, request.prompt).toEqual({ kind: 'accepted' });
      decisions++;
    }
    expect(match.result, `${decisions} decisions`).not.toBeNull();
    expect(await running).toMatchObject({ kind: 'resolved' });
  } finally {
    match.room.abort('test finished');
    await running;
  }
}, 60_000);
