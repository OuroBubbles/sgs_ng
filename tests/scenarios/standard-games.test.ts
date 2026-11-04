import { afterAll, expect, it } from 'vitest';
import { playMatch } from '../fixtures/match';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRoleMatch, defaultContent } from '../../src/host/content';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { generalOf, genderOf, kingdomOf, roleOf } from '../../src/sdk';
import type { GameResult } from '../../src/sdk';
import { CardEvent } from '../../src/sdk';
import { Hp } from '../../src/sdk';
import { Skill } from '../../src/sdk';

interface GameEvidence {
  readonly general: string;
  readonly seed: number;
  readonly lineup: readonly string[];
  readonly decisions: number;
  readonly turns: number;
  readonly result: GameResult;
  readonly facts: number;
  readonly invokedSkills: readonly string[];
  readonly usedCards: readonly string[];
}
const evidence: GameEvidence[] = [];
const generals = defaultContent.generals;

afterAll(async () => {
  await mkdir('.artifacts/validation', { recursive: true });
  await writeFile(
    '.artifacts/validation/standard-games.json',
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        generals: defaultContent.generals.map((general) => general.id),
        complete: evidence.length === 25,
        expected: 25,
        cases: evidence,
      },
      null,
      2,
    ) + '\n',
  );
});

it('标准二十五将统一初始化：目录字段、主公技能与体力奖励及事实重建', async () => {
  expect(generals).toHaveLength(25);
  // 保留迁入场景的种子；其余目录项使用 42。六席同将同时检查主公和非主公。
  const seeds: Readonly<Record<string, number>> = {
    'standard:liubei': 14,
    'standard:huatuo': 14,
    'standard:sunquan': 14,
    'standard:lvmeng': 14,
    'standard:luxun': 14,
    'standard:huangyueying': 12,
    'standard:lvbu': 12,
    'standard:daqiao': 12,
    'standard:machao': 9,
    'standard:zhouyu': 9,
    'standard:diaochan': 9,
  };
  const lordSkills = new Set(['standard:hujia', 'standard:jijiang', 'standard:jiuyuan']);

  for (const general of generals) {
    // 保留旧场景独立于目录的明确值；通用检查同时核对其实际初始化结果。
    if (['standard:simayi', 'standard:guojia'].includes(general.id))
      expect(general).toMatchObject({ gender: 'male', maxHp: 3 });
    if (['standard:sunquan', 'standard:lvmeng', 'standard:luxun'].includes(general.id))
      expect(general.kingdom).toBe('吴');

    const match = createRoleMatch({
      seed: seeds[general.id] ?? 42,
      preset: 'standard:identity',
      lineup: Array<string>(6).fill(general.id),
    });
    try {
      await match.prepare();
      for (const player of match.room.world.snapshot.players) {
        const lord = roleOf(match.room.world, player.id) === 'lord';
        expect(
          {
            general: generalOf(match.room.world, player.id),
            gender: genderOf(match.room.world, player.id),
            kingdom: kingdomOf(match.room.world, player.id),
            maxHp: player.maxHp,
            skills: match.room.world.snapshot.skills
              .filter((skill) => skill.owner === player.id)
              .map((skill) => skill.skill),
          },
          `${general.name}/${player.id}`,
        ).toEqual({
          general: general.id,
          gender: general.gender,
          kingdom: general.kingdom,
          maxHp: general.maxHp + Number(lord),
          skills: general.skills.filter((id) => !lordSkills.has(id) || lord),
        });
      }
      expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
        match.room.world.snapshot,
      );
    } finally {
      match.room.abort('test cleanup');
    }
  }
});

for (const [index, general] of generals.entries()) {
  it(`${general.name}进入四人标准身份局，真实决策至胜负并清理临时结算`, async () => {
    // 每名武将轮流位于甲席，并通过不同偏移与其他武将组合；不重排起手或注入状态。
    const lineup = [0, 7, 13, 19].map((offset) => generals[(index + offset) % generals.length]!.id);
    const seed = 42 + index * 17;
    const match = createRoleMatch({ seed, preset: 'standard:identity', lineup });
    const decisions = await playMatch(match, { steps: 12_000, decisions: 2400 });

    expect(generalOf(match.room.world, '甲席')).toBe(general.id);
    expect(match.initial.cards).toHaveLength(108);
    const facts = match.room.history.facts();
    // 苦肉的 AI 接入归入统一整局矩阵，避免在主动技能场景中重复开局。
    if (general.id === 'standard:huanggai') {
      expect(
        match.room.history
          .facts(Skill.invoked)
          .some((fact) => (fact.data.detail as { skill: string }).skill === 'standard:kurou'),
      ).toBe(true);
      expect(match.room.history.facts(Hp.lost).length).toBeGreaterThan(0);
    }
    evidence.push({
      general: general.id,
      seed,
      lineup,
      decisions,
      turns: match.progress!.turns,
      result: match.result!,
      facts: facts.length,
      invokedSkills: [
        ...new Set(
          match.room.history
            .facts(Skill.invoked)
            .map((fact) => (fact.data.detail as { skill: string }).skill),
        ),
      ].sort(),
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
    });
  }, 60_000);
}
