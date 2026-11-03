import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { practiceContent } from '../../src/app/offline/practice';
import { judge } from '../../src/sdk';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { projectMatch } from '../../src/app/offline/projection';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { nextRequest } from '../fixtures/room';
import { playMatch } from '../fixtures/match';
import { CardEvent } from '../../src/sdk';

const content = practiceContent;

it('自然种子 2 的牌面演练：本人牌面红桃、他人印刷黑桃，真实黑桃材料以武圣使用', async () => {
  const match = createOfflineMatch({
    seed: 2,
    preset: 'workshop:faces',
    lineup: ['workshop:vermilion_guest', 'standard:guanyu'],
    content,
  });
  await match.prepare();
  const hand = match.room.world.zone('甲席:hand').cards;
  const material = hand.find((id) => match.room.world.card(id).name !== 'standard:slash');
  expect(material).toBeDefined();
  expect(
    projectMatch(match, '甲席', null).hand.every(
      (card) => card.suit === '♥' && card.color === 'red',
    ),
  ).toBe(true);
  expect(
    observeAgent(match, '乙席').hand.every(
      (card) => card.suit === 'spade' && card.color === 'black',
    ),
  ).toBe(true);
  await mkdir('.artifacts/validation', { recursive: true });
  await writeFile(
    '.artifacts/validation/face-content-seed.json',
    JSON.stringify(
      {
        seed: 2,
        hand: hand.map((id) => match.room.world.card(id)),
        material,
      },
      null,
      2,
    ),
  );
  const running = match.room.run('use-filtered-material', async (ctx) => {
    const self = match.skills
      .bindings(ctx.world)
      .find(
        (entry) => entry.self.owner === '甲席' && entry.self.skill === 'standard:wusheng',
      )!.self;
    expect(
      (
        await match.book.use(ctx, {
          actor: '甲席',
          choice: {
            kind: 'viewAs',
            instance: self.id,
            recipe: 'red-slash',
            materials: [material!],
          },
          targets: ['乙席'],
          timing: { kind: 'effect' },
        })
      ).kind,
    ).toBe('used');
  });
  const response = await nextRequest(match.room);
  expect(response.kind).toBe('card-response');
  expect(match.room.decisions.cancel(response.id, response.token)).toEqual({ kind: 'accepted' });
  await running;
  expect(match.room.world.position(material!)).toBe('discard');
  expect(match.room.history.facts(CardEvent.used)[0]?.data.detail).toMatchObject({
    declaration: { card: { suit: 'heart', color: 'red' } },
  });
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('test complete');
});

it('映绯真实判定：黑桃在绯衣客判定为红桃，另一角色判定仍是黑桃', async () => {
  const match = createOfflineMatch({
    seed: 2,
    preset: 'workshop:faces',
    lineup: ['workshop:vermilion_guest', 'standard:guanyu'],
    content,
  });
  await match.prepare();
  await match.room.run('judgments', async (ctx) => {
    for (const [player, matched] of [
      ['甲席', true],
      ['乙席', false],
    ] as const) {
      const result = await judge(ctx, {
        player,
        reason: 'workshop:vermilion',
        match: (_at, card) => card.color === 'red',
      });
      expect(result.matched).toBe(matched);
      expect(ctx.world.card(result.card!.id).suit).toBe('spade');
    }
  });
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('test complete');
});

it('四人牌面演练通过基础 AI 正式决策至胜负，seed=2', async () => {
  const seed = 2;
  const match = createOfflineMatch({
    seed,
    preset: 'workshop:faces',
    lineup: ['workshop:vermilion_guest', 'standard:guanyu', 'standard:simayi', 'standard:guojia'],
    content,
  });
  await playMatch(match, { steps: 20_000, decisions: 2400 });

  expect(match.initial.cards).toHaveLength(40);
}, 30_000);
