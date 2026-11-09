import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { createContent } from '../../src/content/catalog';
import { directoryTree } from '../../src/host/content-tree';
import { loadContent } from '../../src/host/load-content';
import { packs } from '../../src/host/content';
import { RoleMatch } from '../../src/host/role-match';
import { playMatch } from '../fixtures/match';

// 零 AI 代码的证明：临时包里新写一名武将和两个技能文件，AI 从未见过它们，也没有任何提示字段；
// 托管 AI 只靠推演内核语义就会用“咒”打敌人、用“惠”帮自己人。
const temporary: string[] = [];
afterEach(async () => {
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});

const files: Record<string, string> = {
  'novel/package.ts': `export default { order: ['witch'] };\n`,
  'novel/skills/hex.ts': `import { action, loseHp, skill } from 'SDK';

export default skill(
  'novel:hex',
  '咒',
  '出牌阶段限一次，你可以弃置一张手牌，令一名其他角色失去 1 点体力。',
  action({
    id: 'hex',
    limit: { per: 'phase', times: 1 },
    cards: { count: 1 },
    targets: { count: 1, filter: (_ctx, player, { self }) => player !== self.owner },
    pay: 'discard',
    effect: (ctx, { self, targets: [target] }) =>
      loseHp(ctx, { player: target!, amount: 1, reason: self.skill }),
  }),
);
`,
  'novel/skills/boon.ts': `import { action, draw, skill } from 'SDK';

export default skill(
  'novel:boon',
  '惠',
  '出牌阶段限一次，你可以令一名角色摸两张牌。',
  action({
    id: 'boon',
    limit: { per: 'phase', times: 1 },
    targets: { count: 1 },
    effect: (ctx, { self, targets: [target] }) =>
      draw(ctx, { player: target!, count: 2, reason: self.skill }),
  }),
);
`,
  'novel/generals/witch.ts': `import { general } from 'SDK';
import hex from '../skills/hex';
import boon from '../skills/boon';

export default general('novel:witch', '巫', '群', 4, [hex, boon]);
`,
};

async function novelPack() {
  await mkdir('.artifacts', { recursive: true });
  const root = await mkdtemp(resolve('.artifacts/ai-drop-in-'));
  temporary.push(root);
  for (const [file, text] of Object.entries(files)) {
    const path = join(root, 'content', file);
    await mkdir(dirname(path), { recursive: true });
    const sdk = relative(dirname(path), resolve('src/sdk')).replaceAll('\\', '/');
    await writeFile(path, text.replaceAll('SDK', sdk));
  }
  await mkdir(join(root, 'public'), { recursive: true });
  const loaded = await loadContent(
    await directoryTree(join(root, 'content'), join(root, 'public')),
  );
  return loaded.packs[0]!.definition;
}

type Detail = Record<string, unknown> & { readonly input?: Record<string, unknown> };

it('新放入的武将文件无需任何 AI 代码：托管 AI 用“咒”只打敌方、“惠”只给自己人', async () => {
  const content = createContent(packs[0]!.definition, await novelPack());
  const uses: { actor: string; skill: string; target: string }[] = [];
  for (const seed of [1, 2, 3]) {
    // 主公 a 身份公开；忠臣 b 与反贼 c 都是新武将，各自只知道自己与主公。
    const match = new RoleMatch({
      id: 'drop-in',
      seed,
      deck: 'standard:identity',
      content,
      roles: ['lord', 'loyalist', 'rebel', 'rebel'],
      players: [
        { id: 'a', general: 'standard:caocao' },
        { id: 'b', general: 'novel:witch' },
        { id: 'c', general: 'novel:witch' },
        { id: 'd', general: 'standard:zhangfei' },
      ],
    });
    await playMatch(match, { steps: 50_000, decisions: 2400 });
    let actor = '';
    for (const fact of match.room.history.facts()) {
      const detail = (fact.data.detail ?? {}) as Detail;
      if (fact.data.kind === 'skill.invoked' && String(detail.skill).startsWith('novel:'))
        actor = String(detail.actor);
      const reason = detail.input?.reason;
      if (reason === 'novel:hex' || reason === 'novel:boon')
        uses.push({ actor, skill: reason, target: String(detail.input!.player) });
    }
  }
  const targets = (actor: string, skill: string) =>
    new Set(
      uses.filter((use) => use.actor === actor && use.skill === skill).map((use) => use.target),
    );
  expect(targets('b', 'novel:hex').size).toBeGreaterThan(0);
  expect(targets('b', 'novel:hex')).not.toContain('a');
  expect([...targets('b', 'novel:boon')].every((target) => ['a', 'b'].includes(target))).toBe(true);
  expect(targets('c', 'novel:hex')).toContain('a');
  expect(targets('c', 'novel:boon').size).toBeGreaterThan(0);
  expect(targets('c', 'novel:boon')).not.toContain('a');
}, 60_000);
