import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleContent } from '../../scripts/build-content.mjs';
import {
  contentFromModule,
  stageContentModules,
  dependentPackages,
} from '../../src/app/offline/content-modules';
import { availablePackages, createOfflineMatch } from '../../src/app/offline/practice';
import { definePackage, resolvePackages, useDeclared, damage, runPhase } from '../../src/sdk';
import { Room } from '../../src/core/runtime/room';
import { cardGame } from '../fixtures/cards';
import type { ContentPackage } from '../../src/sdk';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { decideBasic } from '../../src/app/offline/basic-agent';

// 使用真正的生成模块，不在测试中复制牌/技能定义。
const moduleFile = resolve('.artifacts/content-test/harbor.sgs.mjs');
const code = await bundleContent('examples/content/harbor/index.ts');
await mkdir(dirname(moduleFile), { recursive: true });
await writeFile(moduleFile, code);
const module: unknown = await import(pathToFileURL(moduleFile).href);
const harbor = contentFromModule(module);
const content = resolvePackages(stageContentModules(availablePackages, [harbor]), ['harbor']);

it('现有源码包可直接构建模块，相对 SDK 导入也保持宿主身份', async () => {
  const source = await bundleContent('src/content/workshop/index.ts');
  const target = resolve('.artifacts/content-test/workshop.sgs.mjs');
  await writeFile(target, source);
  const loaded: unknown = await import(pathToFileURL(target).href);
  const pack = contentFromModule(loaded);
  const books = resolvePackages(
    [availablePackages.find((entry) => entry.manifest.id === 'standard')!, pack],
    ['workshop'],
  ).createBooks();
  expect(books.skills.definition('workshop:hearing').effects[0]!.window).toBe(useDeclared);
  expect(source).not.toContain('class CardBook');
});

it('真实外部演武模块使用宿主分配模型与动态回调，私有牌最终一次移入手牌', async () => {
  const source = await bundleContent('src/content/workshop/index.ts');
  expect(source).not.toContain('function assignGroups');
  expect(source).not.toContain('class ArrangementSelection');
  const target = resolve('.artifacts/content-test/workshop-allocation.sgs.mjs');
  await writeFile(target, source);
  const loaded: unknown = await import(pathToFileURL(target).href);
  const pack = contentFromModule(loaded);
  const content = resolvePackages(
    stageContentModules(
      availablePackages.filter((entry) => entry.manifest.id !== 'workshop'),
      [pack],
    ),
    ['workshop'],
  );
  const match = createOfflineMatch(
    2,
    2,
    'standard:identity',
    ['workshop:quartermaster', 'standard:guanyu'],
    content,
  );
  await match.prepare();
  const before = match.room.world.zone('甲席:hand').cards.length;
  const running = match.room.run('prepare', (ctx) => runPhase(ctx, match.book, '甲席', 'prepare'));
  const invoke = await nextRequest(match.room);
  expect(match.room.decisions.submit(invoke.id, invoke.token, true)).toEqual({ kind: 'accepted' });
  const assignment = await nextRequest(match.room);
  expect(assignment.data).toMatchObject({ presentation: 'distribution' });
  expect(
    match.room.decisions.submit(
      assignment.id,
      assignment.token,
      (assignment.data as { initial: unknown }).initial,
    ),
  ).toEqual({ kind: 'accepted' });
  await running;
  expect(match.room.world.zone('甲席:hand').cards).toHaveLength(before + 4);
  expect(match.room.history.facts('cards.distributed')).toHaveLength(1);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
});

it('外部效果模块复用宿主查询与伤害 Window，真实改上限和减伤，不打包第二套效果库', async () => {
  const entry = resolve('.artifacts/content-test/effect-entry.ts');
  await writeFile(
    entry,
    `import { definePackage } from '@sgs/sdk';
import { covenant } from '../../examples/effects/covenant';
export default definePackage({manifest:{id:'covenant',name:'守约模块',version:'1',requires:[{id:'standard'}]},effects:[covenant]});`,
  );
  const source = await bundleContent(entry);
  expect(source).not.toContain('class EffectBook');
  const target = resolve('.artifacts/content-test/effects.sgs.mjs');
  await writeFile(target, source);
  const loaded: unknown = await import(pathToFileURL(target).href);
  const entryPackage = contentFromModule(loaded);
  const books = resolvePackages(stageContentModules(availablePackages, [entryPackage]), [
    'covenant',
  ]).createBooks();
  const initial = cardGame({ hands: { a: [] } }).initial;
  const room = new Room({ id: 'effect-module', seed: 42, world: initial });
  books.skills.attach(room);
  await room.run('add', (ctx) =>
    books.book.effects.add(ctx, entryPackage.effects![0]!, {
      owner: 'b',
      data: { target: 'b', remaining: 1 },
    }),
  );
  expect(room.inspect((ctx) => books.book.handLimit(ctx, 'b'))).toBe(5);
  await room.run('damage', async (ctx) => {
    expect(
      ctx.unwrap(await damage(ctx, { from: 'c', to: 'b', amount: 2, nature: 'normal' })).hpLoss,
    ).toBe(1);
  });
  expect(rebuildWorld(initial, room.history.facts())).toEqual(room.world.snapshot);
  expect(room.decisions.pending).toEqual([]);
});

it('直接导入宿主内部实现会在构建时诊断，不能意外打包第二套内核', async () => {
  const entry = resolve('.artifacts/content-test/private-entry.ts');
  await writeFile(
    entry,
    'import { Room } from "../../src/core/runtime/room"; export default Room;',
  );
  await expect(bundleContent(entry)).rejects.toThrow('through @sgs/sdk');
});

it('普通 TS 模块只打包自身代码及原始图片，SDK Window 与运行期类身份来自宿主', async () => {
  expect(code).not.toContain('class Room');
  expect(code).not.toContain('function defineWindow');
  expect(harbor.manifest).toMatchObject({ id: 'harbor', version: '0.1.1' });
  const effects = content.createBooks().skills.definition('harbor:tide').effects;
  expect(effects[0]!.window).toBe(useDeclared);
  expect(content.versions.map((version) => version.id)).toEqual(['standard', 'harbor']);
  expect(content.cards).toHaveLength(33);
  expect(content.generals).toHaveLength(26);
  const portrait = content.generalViews['harbor:guest']!.portrait;
  expect(portrait).toMatch(/^data:image\/jpeg;base64,/);
  expect(Buffer.from(portrait.slice(portrait.indexOf(',') + 1), 'base64')).toEqual(
    await readFile('examples/content/harbor/guest.jpg'),
  );
  expect(code).not.toContain('/assets/guest');
});

it.each([
  null,
  {},
  { format: 'other', default: () => harbor },
  { format: 'sgs-content/1', default: 2 },
  { format: 'sgs-content/1', default: () => null },
  { format: 'sgs-content/1', default: () => Promise.resolve(harbor) },
])('错误模块同步失败，不加入目录：%j', (input) => {
  expect(() => contentFromModule(input)).toThrow();
});

it('重复包、依赖版本和未知牌失败时原目录完整，批内依赖顺序可任意', () => {
  const original = [...availablePackages];
  expect(() => stageContentModules(original, [harbor, harbor])).toThrow('Duplicate package');
  const wrong = definePackage({
    manifest: {
      id: 'wrong',
      name: 'Wrong',
      version: '1',
      requires: [{ id: 'standard', version: 'missing' }],
    },
  });
  expect(() => stageContentModules(original, [wrong])).toThrow('requires missing');
  const invalid = definePackage({
    manifest: { id: 'invalid', name: 'Invalid', version: '1', requires: [{ id: 'standard' }] },
    decks: [
      {
        id: 'invalid:deck',
        label: 'Invalid',
        create: () => [{ id: 'bad-card', name: 'standard:unknown', suit: 'heart', rank: 1 }],
      },
    ],
  });
  expect(() => stageContentModules(original, [invalid])).toThrow('Unknown card');
  const dependent = definePackage({
    manifest: { id: 'dependent', name: 'Dependent', version: '1', requires: [{ id: 'harbor' }] },
  });
  expect(() => stageContentModules(original, [dependent])).toThrow('Missing package');
  const staged = stageContentModules(original, [dependent, harbor]);
  expect(dependentPackages(staged, 'harbor')).toEqual(['dependent', 'harbor']);
  expect(original).toEqual(availablePackages);
});

it('工厂中的未知技能、越界命名空间也在导入阶段报错', () => {
  const broken: ContentPackage = {
    manifest: { id: 'broken', name: 'Broken', version: '1' },
    generals: [
      {
        id: 'broken:guest',
        name: 'Broken',
        kingdom: '群',
        gender: 'male',
        maxHp: 4,
        skills: ['broken:missing'],
      },
    ],
  };
  expect(() => stageContentModules(availablePackages, [broken])).toThrow('Unknown skill');
  expect(() =>
    stageContentModules(availablePackages, [
      { ...harbor, manifest: { ...harbor.manifest, id: 'wrong' } },
    ]),
  ).toThrow('namespace');
});

it('导入包每局创建独立目录，卸下开局目录不改变已经创建的对局', async () => {
  const first = content.createBooks();
  const second = content.createBooks();
  expect(first.book).not.toBe(second.book);
  expect(first.skills).not.toBe(second.skills);
  const match = createOfflineMatch(
    2,
    4,
    'harbor:crossing',
    ['harbor:guest', 'standard:guanyu'],
    content,
  );
  await match.prepare();
  expect(match.room.history.facts('match.content')[0]!.data.detail).toMatchObject({
    packages: content.versions,
  });
  const base = resolvePackages(availablePackages, ['standard']);
  expect(() => base.createDeck('harbor:crossing')).toThrow();
  expect(match.book.definition('harbor:provision').label).toBe('备航');
  match.room.abort('done');
});

it('自然起手的外部牌使用宿主 useDeclared，真实潮声询问、效果和材料善后', async () => {
  let match: ReturnType<typeof createOfflineMatch> | undefined;
  let selected = '';
  let selectedSeed = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const candidate = createOfflineMatch(
      2,
      seed,
      'harbor:crossing',
      ['harbor:guest', 'standard:guanyu'],
      content,
    );
    await candidate.prepare();
    const id = candidate.room.world
      .zone('甲席:hand')
      .cards.find((id) => candidate.room.world.card(id).name === 'harbor:provision');
    if (candidate.progress?.next === '甲席' && id) {
      match = candidate;
      selected = id;
      selectedSeed = seed;
      break;
    }
    candidate.room.abort('seed scan');
  }
  expect(match).toBeDefined();
  if (!match) throw new Error('Natural external-card seed not found.');
  const game = match;
  await writeFile(
    '.artifacts/validation/external-content-seed.json',
    JSON.stringify({ seed: selectedSeed, card: selected }, null, 2),
  );
  const before = game.room.world.zone('甲席:hand').cards.length;
  const running = game.room.run('external-card', (ctx) =>
    game.book.use(ctx, {
      actor: '甲席',
      choice: { kind: 'physical', card: selected },
      targets: ['甲席'],
      timing: { kind: 'effect' },
    }),
  );
  const request = await nextRequest(game.room);
  expect(request).toMatchObject({ kind: 'invoke', data: { skill: 'harbor:tide' } });
  expect(game.room.decisions.submit(request.id, request.token, true)).toEqual({ kind: 'accepted' });
  await running;
  expect(game.room.world.zone('甲席:hand').cards).toHaveLength(before + 2);
  expect(game.room.world.position(selected)).toBe('discard');
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  game.room.abort('done');
});

it('外部模块四人基础 AI 对局使用真实规则至胜负，无宿主窗口身份分裂', async () => {
  const match = createOfflineMatch(
    4,
    4,
    'harbor:crossing',
    ['harbor:guest', 'standard:guanyu', 'harbor:guest', 'standard:guojia'],
    content,
  );
  const running = match.start();
  let decisions = 0;
  try {
    for (let step = 0; step < 15_000 && !match.result; step++) {
      await setImmediate();
      expect(match.room.status).not.toBe('faulted');
      const request = match.room.decisions.pending[0];
      if (!request) continue;
      if (++decisions > 2400) {
        const counts: Record<string, number> = {};
        for (const fact of match.room.history.facts('card.used')) {
          const detail = fact.data.detail as { declaration?: { card?: { name?: string } } };
          const name = detail.declaration?.card?.name ?? 'unknown';
          counts[name] = (counts[name] ?? 0) + 1;
        }
        await writeFile(
          '.artifacts/validation/content-game-stall.json',
          JSON.stringify(
            {
              decisions,
              progress: match.progress,
              players: observeAgent(match, '甲席').players,
              uses: counts,
              lastFacts: match.room.history.facts().slice(-12),
              request,
            },
            null,
            2,
          ),
        );
        throw new Error('External match decision budget exhausted.');
      }
      const answer = decideBasic(observeAgent(match, request.player), request, (input) =>
        match.room.decisions.preview(request.id, input),
      );
      if (answer.kind === 'unsupported') throw new Error(answer.reason);
      expect(
        answer.kind === 'cancel'
          ? match.room.decisions.cancel(request.id, request.token)
          : match.room.decisions.submit(request.id, request.token, answer.value),
      ).toEqual({ kind: 'accepted' });
    }
    expect(match.result).not.toBeNull();
    await running;
    expect(
      match.room.history
        .facts('skill.invoked')
        .some((fact) => (fact.data.detail as { skill?: string }).skill === 'harbor:tide'),
    ).toBe(true);
    expect(match.room.world.snapshot.zones.flatMap((zone) => zone.cards)).toHaveLength(40);
    expect(match.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
  } finally {
    if (match.room.status !== 'ended') match.room.abort('test stopped');
  }
}, 30_000);
