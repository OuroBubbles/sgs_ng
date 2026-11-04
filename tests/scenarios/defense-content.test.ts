import { playMatch } from '../fixtures/match';
import { expect, it } from 'vitest';
import { createRoleMatch } from '../../src/host/content';
import { practiceContent } from '../../src/host/content';
import { shieldOf } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { observeAgent } from '../../src/host/agent-observation';
import { projectMatch } from '../../src/host/projection';
import { nextRequest } from '../fixtures/room';
import { Damage } from '../../src/sdk';
import { Shield } from '../../src/sdk';
import { Skill } from '../../src/sdk';

const content = practiceContent;

it('种子 4 自然起手凝障/缚阵/引焰，真实用牌后护盾吸收传播，公开投影一致', async () => {
  const match = createRoleMatch({
    seed: 4,
    preset: 'workshop:defense',
    lineup: ['standard:guanyu', 'standard:guanyu'],
    content,
  });
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
        (
          await match.book.use(ctx, {
            actor: '甲席',
            choice: { kind: 'physical', card: id },
            targets,
            timing: { kind: 'effect' },
          })
        ).kind,
      ).toBe('used');
    }
  });
  expect(match.room.world.player('甲席').hp).toBe(4);
  expect(match.room.world.player('乙席').hp).toBe(3);
  expect(shieldOf(match.room.world, '甲席')).toBe(1);
  expect(match.room.history.facts(Damage.dealt).map((fact) => fact.data.detail)).toMatchObject([
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
  const match = createRoleMatch({
    seed: 4,
    preset: 'workshop:defense',
    lineup: ['standard:guanyu', 'workshop:guardian'],
    content,
  });
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
    value: { kind: 'used' },
  });
  expect(match.room.world.player('甲席').hp).toBe(accept ? 3 : 4);
  expect(match.room.world.player('乙席').hp).toBe(accept ? 4 : 3);
  expect(match.room.world.position('defense-card-39')).toBe(accept ? 'discard' : '乙席:hand');
  expect(match.room.world.position('defense-card-19')).toBe('discard');
  const dealt = match.room.history.facts(Damage.dealt)[0]!.data.detail;
  expect(dealt.input.card).toMatchObject({
    actor: '甲席',
    target: '乙席',
    card: { materials: ['defense-card-19'] },
  });
  expect(match.room.history.facts(Damage.transferred)).toHaveLength(Number(accept));
  expect(match.room.history.facts(Skill.invoked)).toHaveLength(Number(accept));
  expect(match.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('test complete');
});

it.each([4, 17])(
  '护盾/转移演练四人局由基础 AI 真实决策至胜负，seed=%s',
  async (seed) => {
    const match = createRoleMatch({
      seed,
      preset: 'workshop:defense',
      lineup: ['workshop:guardian', 'workshop:guardian', 'standard:guojia', 'standard:caocao'],
      content,
    });
    await playMatch(match, { steps: 20000, decisions: 3000 });
    expect(match.room.history.facts(Shield.changed).length).toBeGreaterThan(0);
    expect(match.room.history.facts(Damage.transferred).length).toBeGreaterThan(0);
    expect(match.initial.cards).toHaveLength(48);
  },
  30_000,
);
