import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createRoleMatch, defaultContent } from '../../src/host/content';
import { CardEvent } from '../../src/sdk';
import { playMatch } from '../fixtures/match';

/**
 * 用牌行为护栏：固定种子与阵容的 AI 整局，逐条比对整份日志（流程、窗口、决策与回答、随机数、事实）。
 * 重构后必须逐字一致；有意改变时以 `REPLAY_UPDATE=1 pnpm vitest run tests/scenarios/replay-baseline.test.ts`
 * 重写金标准，并在阶段说明里逐条解释差异。完整日志写到 `.artifacts/replays/<id>.jsonl` 便于 diff。
 */
const golden = new URL('../replays/baseline.json', import.meta.url);
const dumps = '.artifacts/replays';
const update = process.env.REPLAY_UPDATE === '1';

interface Replay {
  readonly id: string;
  readonly seed: number;
  readonly lineup: readonly string[];
  readonly entries: number;
  readonly facts: number;
  readonly decisions: number;
  readonly result: unknown;
  readonly usedCards: readonly string[];
  /** 整份日志（含 trace）、仅事实、仅决策三层摘要：定位差异落在哪一层。 */
  readonly digest: { readonly journal: string; readonly facts: string; readonly decisions: string };
}

const generals = defaultContent.generals.map((general) => general.id);
const cases = [
  // 与 standard-games 同一组四人局：每将轮流坐甲席。
  ...generals.map((_, index) => ({
    id: `4p-${String(index).padStart(2, '0')}`,
    seed: 42 + index * 17,
    lineup: [0, 7, 13, 19].map((offset) => generals[(index + offset) % generals.length]!),
  })),
  // 八人局：更多同场武将与锦囊（含借刀杀人）互动。
  ...[0, 1, 2, 3, 4, 5].map((index) => ({
    id: `8p-${index}`,
    seed: 1000 + index * 31,
    lineup: [0, 3, 6, 9, 12, 15, 18, 21].map(
      (offset) => generals[(index * 4 + offset) % generals.length]!,
    ),
  })),
];

const digest = (lines: readonly string[]) =>
  createHash('sha256').update(lines.join('\n')).digest('hex');

const recorded: Replay[] = [];
const expected: readonly Replay[] = existsSync(golden)
  ? (JSON.parse(readFileSync(golden, 'utf8')) as { cases: Replay[] }).cases
  : [];

for (const entry of cases) {
  it(`回放 ${entry.id}（种子 ${entry.seed}）与金标准逐条一致`, async () => {
    const match = createRoleMatch({
      seed: entry.seed,
      preset: 'standard:identity',
      lineup: entry.lineup,
    });
    const decisions = await playMatch(match, { steps: 20_000, decisions: 4000 });
    const journal = match.room.history.entries.map((item) => JSON.stringify(item));
    mkdirSync(dumps, { recursive: true });
    writeFileSync(`${dumps}/${entry.id}.jsonl`, journal.join('\n') + '\n');
    const facts = match.room.history.facts();
    const replay: Replay = {
      ...entry,
      entries: journal.length,
      facts: facts.length,
      decisions,
      result: match.result,
      usedCards: [
        ...new Set(
          match.room.history
            .facts(CardEvent.used)
            .map(
              (fact) =>
                (fact.data.detail as { declaration: { card: { name: string } } }).declaration.card
                  .name,
            ),
        ),
      ].sort(),
      digest: {
        journal: digest(journal),
        facts: digest(facts.map((item) => JSON.stringify(item))),
        decisions: digest(
          match.room.history.entries
            .filter((item) => item.type === 'decision.open' || item.type === 'decision.close')
            .map((item) => JSON.stringify(item)),
        ),
      },
    };
    recorded.push(replay);
    if (update) return;
    expect(replay).toEqual(expected.find((item) => item.id === entry.id));
  }, 120_000);
}

it('金标准覆盖：全部标准武将与借刀杀人等多种牌', () => {
  const used = new Set(recorded.flatMap((item) => item.usedCards));
  expect(recorded).toHaveLength(cases.length);
  expect(used.has('standard:collateral')).toBe(true);
  expect(used.size).toBeGreaterThanOrEqual(25);
  expect(new Set(cases.flatMap((item) => item.lineup)).size).toBe(generals.length);
  if (update) {
    const sorted = [...recorded].sort((a, b) => a.id.localeCompare(b.id));
    writeFileSync(golden, JSON.stringify({ cases: sorted }, null, 2) + '\n');
  }
});
