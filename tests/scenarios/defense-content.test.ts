import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { availablePackages, createOfflineMatch } from '../../src/app/offline/practice';
import { resolvePackages, shieldOf } from '../../src/sdk';
import type { DamageResult } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { decideBasic } from '../../src/app/offline/basic-agent';
import { projectMatch } from '../../src/app/offline/projection';
import { nextRequest } from '../fixtures/room';

const content = () => resolvePackages(availablePackages, ['workshop']);

it('种子 4 自然起手凝障/缚阵/引焰，真实用牌后护盾吸收传播，公开投影一致', async () => {
  const match = createOfflineMatch(
    2,
    4,
    'workshop:defense',
    ['standard:guanyu', 'standard:guanyu'],
    content(),
  );
  await match.prepare();
  expect(match.progress?.next).toBe('甲席');
  await match.room.run('defense-content', async (ctx) => {
    for (const [id, targets] of [
      ['defense-card-7', ['甲席']],
      ['defense-card-11', ['甲席', '乙席']],
      ['defense-card-19', ['乙席']],
    ] as const) {
      expect(ctx.world.position(id)).toBe('甲席:hand');
      expect(
        ctx.unwrap(
          await match.book.use(ctx, {
            actor: '甲席',
            choice: { kind: 'physical', card: id },
            targets,
            timing: { kind: 'effect' },
          }),
        ).kind,
      ).toBe('used');
    }
  });
  expect(match.room.world.player('甲席').hp).toBe(4);
  expect(match.room.world.player('乙席').hp).toBe(3);
  expect(shieldOf(match.room.world, '甲席')).toBe(1);
  expect(match.room.history.facts('damage.dealt').map((fact) => fact.data.detail)).toMatchObject([
    { amount: 1, shieldLost: 0, hpLoss: 1 },
    { amount: 1, shieldLost: 1, hpLoss: 0 },
  ]);
  expect(observeAgent(match, '乙席').players.find((player) => player.id === '甲席')!.shield).toBe(
    1,
  );
  const view = projectMatch(match, '甲席', null);
  expect(view.players.find((player) => player.id === '甲席')).toMatchObject({
    shield: 1,
    chained: false,
  });
  expect(view.log.map((entry) => entry.text).join('\n')).toContain('护盾吸收 1 点');
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('test complete');
});

it.each([false, true])('演武代受真实选择、支付、材料关联与善后：accept=%s', async (accept) => {
  const match = createOfflineMatch(
    2,
    4,
    'workshop:defense',
    ['standard:guanyu', 'workshop:guardian'],
    content(),
  );
  await match.prepare();
  const running = match.room.run('relay', (ctx) =>
    match.book.use(ctx, {
      actor: '甲席',
      choice: { kind: 'physical', card: 'defense-card-19' },
      targets: ['乙席'],
      timing: { kind: 'effect' },
    }),
  );
  const request = await nextRequest(match.room);
  expect(request).toMatchObject({
    player: '乙席',
    kind: 'cards-targets',
    optional: true,
    data: { reason: 'workshop:relay' },
  });
  expect(
    accept
      ? match.room.decisions.submit(request.id, request.token, {
          cards: ['defense-card-39'],
          targets: ['甲席'],
        })
      : match.room.decisions.cancel(request.id, request.token),
  ).toEqual({ kind: 'accepted' });
  expect(await running).toMatchObject({
    kind: 'resolved',
    value: { kind: 'resolved', value: { kind: 'used' } },
  });
  expect(match.room.world.player('甲席').hp).toBe(accept ? 3 : 4);
  expect(match.room.world.player('乙席').hp).toBe(accept ? 4 : 3);
  expect(match.room.world.position('defense-card-39')).toBe(accept ? 'discard' : '乙席:hand');
  expect(match.room.world.position('defense-card-19')).toBe('discard');
  const dealt = match.room.history.facts('damage.dealt')[0]!.data.detail as DamageResult;
  expect(dealt.input.card).toMatchObject({
    actor: '甲席',
    target: '乙席',
    card: { materials: ['defense-card-19'] },
  });
  expect(match.room.history.facts('damage.transferred')).toHaveLength(Number(accept));
  expect(match.room.history.facts('skill.invoked')).toHaveLength(Number(accept));
  expect(match.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('test complete');
});

it.each([4, 17])(
  '护盾/转移演练四人局由基础 AI 真实决策至胜负，seed=%s',
  async (seed) => {
    const match = createOfflineMatch(
      4,
      seed,
      'workshop:defense',
      ['workshop:guardian', 'workshop:guardian', 'standard:guojia', 'standard:caocao'],
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
        if (++decisions > 3000) throw new Error('Defense match decision budget exhausted.');
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
      expect(match.room.history.facts('shield.changed').length).toBeGreaterThan(0);
      expect(match.room.history.facts('damage.transferred').length).toBeGreaterThan(0);
      const cards = match.room.world.snapshot.zones.flatMap((zone) => zone.cards);
      expect(cards).toHaveLength(48);
      expect(new Set(cards).size).toBe(48);
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
