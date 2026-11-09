import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { createContent } from '../../src/content/catalog';
import { directoryTree } from '../../src/host/content-tree';
import { loadContent } from '../../src/host/load-content';
import { contentHash, createRoleMatch, packs } from '../../src/host/content';

// 临时包放在仓库内（.artifacts 已忽略），内容文件按作者写法用相对路径导入 sdk。
const temporary: string[] = [];
afterEach(async () => {
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});

async function packTree(files: Record<string, string>) {
  await mkdir('.artifacts', { recursive: true });
  const root = await mkdtemp(resolve('.artifacts/content-'));
  temporary.push(root);
  const content = join(root, 'content');
  const write = async (file: string, text: string) => {
    const path = join(content, file);
    await mkdir(dirname(path), { recursive: true });
    const sdk = relative(dirname(path), resolve('src/sdk')).replaceAll('\\', '/');
    await writeFile(path, text.replaceAll('SDK', sdk));
  };
  for (const [file, text] of Object.entries(files)) await write(file, text);
  await mkdir(join(root, 'public'), { recursive: true });
  return { root, write, tree: () => directoryTree(content, join(root, 'public')) };
}

const pack = `export default { order: ['beta'] };\n`;
const general = (stem: string, skills = '[]') =>
  `import { general } from 'SDK';\nexport default general('sample:${stem}', '${stem}', '群', 4, ${skills});\n`;

it('标准包按 package.ts 的 order 排列，与历史登记顺序一致，内容哈希来自源码', () => {
  expect(packs.map((entry) => [entry.id, entry.practice])).toEqual([
    ['standard', false],
    ['workshop', true],
  ]);
  const ids = packs[0]!.definition.generals!.map((entry) => entry.id);
  expect(ids.slice(0, 5)).toEqual([
    'standard:guanyu',
    'standard:huanggai',
    'standard:sunshangxiang',
    'standard:zhaoyun',
    'standard:zhangfei',
  ]);
  expect(ids).toHaveLength(26);
  expect(ids.at(-1)).toBe('standard:liushan');
  expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
});

it('往包里放一个武将文件即被发现：order 之外的文件按文件名追加，技能与媒体按约定并入', async () => {
  const sample = await packTree({
    'sample/package.ts': pack,
    'sample/generals/beta.ts': general('beta'),
    'sample/generals/alpha.ts': general('alpha'),
    'sample/generals/notes.test.ts': 'throw new Error("tests are not content");\n',
    'sample/skills/calm.ts': `import { skill } from 'SDK';\nexport default skill('sample:calm', '静', '无效果。');\n`,
  });
  await mkdir(join(sample.root, 'public/sample/portraits'), { recursive: true });
  await writeFile(join(sample.root, 'public/sample/portraits/alpha.png'), '');
  const before = await loadContent(await sample.tree());
  expect(before.packs.map((entry) => entry.id)).toEqual(['sample']);
  const definition = before.packs[0]!.definition;
  expect(definition.generals!.map((entry) => entry.id)).toEqual(['sample:beta', 'sample:alpha']);
  expect(definition.skills!.map((entry) => entry.id)).toEqual(['sample:calm']);
  expect(definition.generalViews).toEqual([
    { id: 'sample:alpha', portrait: '/sample/portraits/alpha.png', voices: {} },
  ]);

  // 只新增一个文件，不改任何登记：重新扫描（即重启主持端）就出现在目录末尾并可开局。
  await sample.write('sample/generals/gamma.ts', general('gamma'));
  const after = await loadContent(await sample.tree());
  const loaded = after.packs[0]!.definition;
  expect(loaded.generals!.map((entry) => entry.id)).toEqual([
    'sample:beta',
    'sample:alpha',
    'sample:gamma',
  ]);
  expect(after.hash).not.toBe(before.hash);
  expect((await loadContent(await sample.tree())).hash).toBe(after.hash);
  const content = createContent(packs[0]!.definition, loaded);
  const match = createRoleMatch({
    seed: 3,
    preset: 'standard:identity',
    lineup: ['sample:gamma', 'standard:guanyu'],
    content,
  });
  await match.prepare();
  expect(match.generals.definition('sample:gamma').name).toBe('gamma');
});

const cardFile = (stem: string, extra = '') =>
  `import { card } from 'SDK';\nexport default card({ id: 'sample:${stem}', type: 'trick', label: '${stem}', description: '无效果。',${extra} use: { count: { min: 0, max: 0 }, target: () => false, execute: () => null } });\n`;

it('往包里放一个牌文件即被发现：按文件名排列，说明随定义，卡图与语音按约定并入', async () => {
  const sample = await packTree({
    'sample/package.ts': `export default {};\n`,
    'sample/cards/omen.ts': cardFile('omen', " kind: 'draw',"),
    'sample/cards/charm.ts': `import { equipment } from 'SDK';\nexport default equipment('sample:charm', '护符', 'armor', '防具。无效果。');\n`,
  });
  for (const file of [
    'cards/omen.png',
    'audio/card/female/omen.mp3',
    'icons/armor.png',
    'audio/card/common/armor.mp3',
  ]) {
    await mkdir(dirname(join(sample.root, 'public/sample', file)), { recursive: true });
    await writeFile(join(sample.root, 'public/sample', file), '');
  }
  const loaded = (await loadContent(await sample.tree())).packs[0]!.definition;
  expect(loaded.cards!.map((entry) => [entry.id, entry.description])).toEqual([
    ['sample:charm', '防具。无效果。'],
    ['sample:omen', '无效果。'],
  ]);
  expect(loaded.cardViews).toEqual([
    {
      id: 'sample:charm',
      icon: '/sample/icons/armor.png',
      voices: {
        male: '/sample/audio/card/common/armor.mp3',
        female: '/sample/audio/card/common/armor.mp3',
      },
    },
    {
      id: 'sample:omen',
      kind: 'draw',
      image: '/sample/cards/omen.png',
      voices: { female: '/sample/audio/card/female/omen.mp3' },
    },
  ]);
  // 新牌只加文件即可进入本局目录。
  expect(createContent(loaded).cards.map((entry) => entry.id)).toEqual([
    'sample:charm',
    'sample:omen',
  ]);
});

it('目录名带 .disabled 的包不加载，也不计入内容哈希', async () => {
  const sample = await packTree({
    'sample/package.ts': `export default {};\n`,
    'off.disabled/package.ts': 'throw new Error("disabled");\n',
  });
  const loaded = await loadContent(await sample.tree());
  expect(loaded.packs.map((entry) => entry.id)).toEqual(['sample']);
});

it.each([
  [
    '在 package.ts 里登记武将',
    {
      'sample/package.ts': `import beta from './generals/beta';\nexport default { generals: [beta] };\n`,
      'sample/generals/beta.ts': general('beta'),
    },
    /sample\/package\.ts: generals are not listed here: each lives in its own generals\/<name>\.ts/,
  ],
  [
    'ID 与文件名不符',
    {
      'sample/package.ts': `export default {};\n`,
      'sample/generals/beta.ts': general('alpha'),
    },
    /sample\/generals\/beta\.ts: ID must be "sample:beta"/,
  ],
  [
    '默认导出不是武将',
    {
      'sample/package.ts': `export default {};\n`,
      'sample/generals/beta.ts': `export const beta = 1;\n`,
    },
    /sample\/generals\/beta\.ts: missing default export/,
  ],
  [
    '默认导出形状错误',
    {
      'sample/package.ts': `export default {};\n`,
      'sample/generals/beta.ts': `export default { id: 'sample:beta' };\n`,
    },
    /sample\/generals\/beta\.ts: default export must be general/,
  ],
  [
    'order 指向不存在的文件',
    { 'sample/package.ts': pack },
    /sample\/package\.ts: order lists "beta" but generals\/beta\.ts does not exist/,
  ],
  [
    '模块加载失败',
    {
      'sample/package.ts': `export default {};\n`,
      'sample/generals/beta.ts': `throw new Error('boom');\n`,
    },
    /sample\/generals\/beta\.ts: failed to load \(boom\)/,
  ],
  [
    '牌 ID 与文件名不符',
    { 'sample/package.ts': `export default {};\n`, 'sample/cards/omen.ts': cardFile('sign') },
    /sample\/cards\/omen\.ts: ID must be "sample:omen"/,
  ],
  [
    '牌缺少说明',
    {
      'sample/package.ts': `export default {};\n`,
      'sample/cards/omen.ts': `export default { id: 'sample:omen', type: 'trick', label: '兆' };\n`,
    },
    /sample\/cards\/omen\.ts: default export must be card/,
  ],
  [
    '在 package.ts 里登记牌',
    {
      'sample/package.ts': `import omen from './cards/omen';\nexport default { cards: [omen] };\n`,
      'sample/cards/omen.ts': cardFile('omen'),
    },
    /sample\/package\.ts: cards are not listed here: each lives in its own cards\/<name>\.ts/,
  ],
  [
    '同 ID 的不同技能',
    {
      'sample/package.ts': `export default {};\n`,
      'sample/generals/beta.ts': general(
        'beta',
        `[(await import('SDK')).skill('sample:calm', '静', '甲')]`,
      ),
      'sample/skills/calm.ts': `import { skill } from 'SDK';\nexport default skill('sample:calm', '静', '乙');\n`,
    },
    /skill sample:calm is also defined in/,
  ],
])('启动时拒绝%s并指出文件', async (_name, files, error) => {
  const sample = await packTree(files);
  await expect(loadContent(await sample.tree())).rejects.toThrow(error);
});

it('约定卡图目录里找不到对应牌的文件在启动时报出', async () => {
  const sample = await packTree({ 'sample/package.ts': `export default {};\n` });
  await mkdir(join(sample.root, 'public/sample/cards'), { recursive: true });
  await writeFile(join(sample.root, 'public/sample/cards/omen.png'), '');
  await expect(loadContent(await sample.tree())).rejects.toThrow(
    /sample\/cards\/omen\.png: no card "sample:omen"/,
  );
});

it('约定媒体目录里找不到对应武将的文件（多半是拼错）在启动时报出', async () => {
  const sample = await packTree({
    'sample/package.ts': `export default {};\n`,
    'sample/generals/beta.ts': general('beta'),
  });
  await mkdir(join(sample.root, 'public/sample/audio/death'), { recursive: true });
  await writeFile(join(sample.root, 'public/sample/audio/death/betta.mp3'), '');
  await expect(loadContent(await sample.tree())).rejects.toThrow(
    /sample\/audio\/death\/betta\.mp3: no general "sample:betta"/,
  );
});
