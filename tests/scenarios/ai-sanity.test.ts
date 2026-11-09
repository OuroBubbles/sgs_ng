import { afterAll, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { playMatch } from '../fixtures/match';
import { createRoleMatch, practiceContent } from '../../src/host/content';

// 托管 AI 的健全性：两包全部武将轮流入座，2–8 人、两种牌组，AI 对 AI 打到分出胜负——
// 不出错、不提交非法决策（playMatch 逐条断言被接受）、不卡死，且在回合上限内结束。
const TURN_CAP = 400;
const generals = practiceContent.generals.map((general) => general.id);
const games = 16;
const evidence: unknown[] = [];
afterAll(async () => {
  await mkdir('.artifacts/validation', { recursive: true });
  await writeFile('.artifacts/validation/ai-sanity.json', JSON.stringify(evidence, null, 2));
});

for (let game = 0; game < games; game++) {
  const count = 2 + (game % 7);
  const lineup = Array.from(
    { length: count },
    (_, seat) => generals[(game * 5 + seat * 3) % generals.length]!,
  );
  const preset = game % 4 === 3 ? 'standard:mechanics' : 'standard:identity';
  const seed = 900 + game * 37;
  it(`${count} 人 ${preset} 种子 ${seed}：${lineup.join('、')}`, async () => {
    const match = createRoleMatch({ seed, preset, lineup, content: practiceContent });
    const decisions = await playMatch(match, { steps: Infinity, decisions: 8000 });
    evidence.push({
      seed,
      preset,
      lineup,
      decisions,
      turns: match.progress!.turns,
      result: match.result,
    });
    expect(match.progress!.turns).toBeLessThanOrEqual(TURN_CAP);
  }, 120_000);
}

it('健全性矩阵覆盖两包全部武将', () => {
  const seated = new Set<string>();
  for (let game = 0; game < games; game++)
    for (let seat = 0; seat < 2 + (game % 7); seat++)
      seated.add(generals[(game * 5 + seat * 3) % generals.length]!);
  expect([...seated].sort()).toEqual([...generals].sort());
});
