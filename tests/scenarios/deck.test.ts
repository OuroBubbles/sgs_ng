import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createStandardDeck } from '../../src/content/standard/deck';
import { standardCards } from '../../src/content/standard/cards';
import { createRoleMatch } from '../../src/host/content';
import { genderOf } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';

it('标准 + EX 108 张包含全部 32 种牌，实体身份独立，牌面可选核对本地参考快照', () => {
  const deck = createStandardDeck();
  expect(deck).toHaveLength(108);
  expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  expect([...new Set(deck.map((c) => c.name))].sort()).toEqual(
    standardCards.map((c) => c.id).sort(),
  );
  expect(Object.isFrozen(deck)).toBe(true);
  expect(deck.every(Object.isFrozen)).toBe(true);
  if (process.env.SGS_REFERENCE_AUDIT === '1') {
    const reference = '../freekill/packages/standard_cards/pkg/init.lua';
    const bytes = readFileSync(reference);
    const rows = [
      ...bytes
        .toString('utf8')
        .matchAll(/extension:addCardSpec\("([a-z_]+)", Card\.(Spade|Heart|Club|Diamond), (\d+)\)/g),
    ];
    const referenceFaces = rows
      .map((m) => `standard:${m[1]!}|${m[2]!.toLowerCase()}|${m[3]!}`)
      .sort();
    const currentFaces = deck.map((c) => `${c.name}|${c.suit}|${c.rank}`).sort();
    expect(currentFaces).toEqual(referenceFaces);
    mkdirSync('.artifacts/validation', { recursive: true });
    writeFileSync(
      '.artifacts/validation/deck-audit.json',
      JSON.stringify(
        {
          auditedAt: new Date().toISOString(),
          reference,
          referenceSha256: createHash('sha256').update(bytes).digest('hex'),
          count: rows.length,
          exactMultiset: true,
        },
        null,
        2,
      ),
    );
  }
});

it('标准 + EX 数量配比固定，各花色 27 张，EX 的四张额外牌面明确', () => {
  const deck = createStandardDeck();
  const counts: Record<string, number> = {};
  for (const card of deck)
    counts[card.name.replace('standard:', '')] =
      (counts[card.name.replace('standard:', '')] ?? 0) + 1;
  expect(counts).toEqual({
    slash: 30,
    jink: 15,
    peach: 8,
    dismantlement: 6,
    snatch: 5,
    duel: 3,
    collateral: 2,
    ex_nihilo: 4,
    nullification: 4,
    savage_assault: 3,
    archery_attack: 1,
    god_salvation: 1,
    amazing_grace: 2,
    lightning: 2,
    indulgence: 3,
    crossbow: 2,
    qinggang_sword: 1,
    ice_sword: 1,
    double_swords: 1,
    blade: 1,
    spear: 1,
    axe: 1,
    halberd: 1,
    kylin_bow: 1,
    eight_diagram: 2,
    nioh_shield: 1,
    dilu: 1,
    jueying: 1,
    zhuahuangfeidian: 1,
    chitu: 1,
    dayuan: 1,
    zixing: 1,
  });
  for (const [suit, extraRank] of [
    ['spade', 2],
    ['club', 2],
    ['heart', 12],
    ['diamond', 12],
  ] as const) {
    const cards = deck.filter((c) => c.suit === suit);
    expect(cards).toHaveLength(27);
    for (let rank = 1; rank <= 13; rank++)
      expect(cards.filter((c) => c.rank === rank)).toHaveLength(rank === extraRank ? 3 : 2);
  }
});

it('默认开局使用标准牌表，机制牌组明确独立，性别预设随初始事实提交', async () => {
  const normal = createRoleMatch();
  const mechanics = createRoleMatch({ count: 4, seed: 42, preset: 'standard:mechanics' });
  expect(normal.initial.cards).toHaveLength(108);
  expect(normal.deckName).toBe('标准＋EX（108 张）');
  expect(mechanics.initial.cards).toHaveLength(288);
  await normal.prepare();
  expect(genderOf(normal.room.world, '甲席')).toBe('male');
  expect(genderOf(normal.room.world, '乙席')).toBe('female');
  expect(rebuildWorld(normal.initial, normal.room.history.facts())).toEqual(
    normal.room.world.snapshot,
  );
});

it('标准牌表初始化可复现，洗牌/发牌后实体位置守恒', async () => {
  const a = createRoleMatch({ count: 8, seed: 2026 });
  const b = createRoleMatch({ count: 8, seed: 2026 });
  await a.prepare();
  await b.prepare();
  expect(a.room.world.snapshot).toEqual(b.room.world.snapshot);
  const positions = a.room.world.snapshot.zones.flatMap((z) => z.cards);
  expect(positions).toHaveLength(108);
  expect(new Set(positions).size).toBe(108);
  expect(a.room.world.zone('draw').cards).toHaveLength(76);
  expect(a.room.world.snapshot.players.filter((p) => p.maxHp === 5)).toHaveLength(1);
});
