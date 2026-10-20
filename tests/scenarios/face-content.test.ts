import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { availablePackages, createOfflineMatch } from '../../src/app/offline/practice';
import { resolvePackages, judge } from '../../src/sdk';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { decideBasic } from '../../src/app/offline/basic-agent';
import { projectMatch } from '../../src/app/offline/projection';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { nextRequest } from '../fixtures/room';

const content = () => resolvePackages(availablePackages, ['workshop']);

it('自然种子 2 的牌面演练：本人牌面红桃、他人印刷黑桃，真实黑桃材料以武圣使用', async () => {
  const match = createOfflineMatch(
    2,
    2,
    'workshop:faces',
    ['workshop:vermilion_guest', 'standard:guanyu'],
    content(),
  );
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
        versions: content().versions,
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
      ctx.unwrap(
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
        }),
      ).kind,
    ).toBe('used');
  });
  const response = await nextRequest(match.room);
  expect(response.kind).toBe('card-response');
  expect(match.room.decisions.cancel(response.id, response.token)).toEqual({ kind: 'accepted' });
  await running;
  expect(match.room.world.position(material!)).toBe('discard');
  expect(match.room.history.facts('card.used')[0]?.data.detail).toMatchObject({
    declaration: { card: { suit: 'heart', color: 'red' } },
  });
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('test complete');
});

it('映绯真实判定：黑桃在绯衣客判定为红桃，另一角色判定仍是黑桃', async () => {
  const match = createOfflineMatch(
    2,
    2,
    'workshop:faces',
    ['workshop:vermilion_guest', 'standard:guanyu'],
    content(),
  );
  await match.prepare();
  await match.room.run('judgments', async (ctx) => {
    for (const [player, matched] of [
      ['甲席', true],
      ['乙席', false],
    ] as const) {
      const result = ctx.unwrap(
        await judge(ctx, match.book, {
          player,
          reason: 'workshop:vermilion',
          match: (_at, card) => card.color === 'red',
        }),
      );
      expect(result.matched).toBe(matched);
      expect(ctx.world.card(result.card!.id).suit).toBe('spade');
    }
  });
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('test complete');
});

it.each([2, 17])(
  '四人牌面演练通过基础 AI 正式决策至胜负，seed=%s',
  async (seed) => {
    const match = createOfflineMatch(
      4,
      seed,
      'workshop:faces',
      ['workshop:vermilion_guest', 'standard:guanyu', 'standard:simayi', 'standard:guojia'],
      content(),
    );
    const running = match.start();
    let decisions = 0;
    try {
      for (let step = 0; step < 20_000 && !match.result; step++) {
        await setImmediate();
        expect(match.room.status).not.toBe('faulted');
        const request = match.room.decisions.pending[0];
        if (!request) continue;
        if (++decisions > 2400) throw new Error('Face match decision budget exhausted.');
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
      const cards = match.room.world.snapshot.zones.flatMap((zone) => zone.cards);
      expect(cards).toHaveLength(40);
      expect(new Set(cards).size).toBe(40);
      expect(match.room.decisions.pending).toEqual([]);
      expect(match.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(
        false,
      );
      expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
        match.room.world.snapshot,
      );
    } finally {
      if (match.room.status !== 'ended') match.room.abort('test stopped');
    }
  },
  30_000,
);
