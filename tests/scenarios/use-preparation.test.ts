import { expect, it } from 'vitest';
import { kill, moveCards } from '../../src/sdk';
import type { CardDefinition } from '../../src/sdk';
import { card, cardGame, use } from '../fixtures/cards';

it('准备返回的参数仍经过牌定义的最终验证，未通过不支付', async () => {
  const definition: CardDefinition = {
    type: 'trick',
    id: 'probe:prepared',
    label: '准备探针',
    use: {
      count: { min: 1, max: 1 },
      target: () => true,
      canUse: (_ctx, request) =>
        request.parameters === undefined || request.parameters === 'valid'
          ? null
          : 'Invalid prepared value.',
      prepare: () => ({ ok: true, value: 'invalid' }),
      resolve: () => {},
    },
  };
  const game = cardGame({
    hands: { a: [{ ...card('p', 'slash'), name: definition.id }] },
    definitions: [definition],
  });
  expect(
    await use(game, {
      actor: 'a',
      choice: { kind: 'physical', card: 'p' },
      targets: ['b'],
      timing: { kind: 'effect' },
    }),
  ).toMatchObject({ value: { kind: 'unavailable', reason: 'Invalid prepared value.' } });
  expect(game.room.world.position('p')).toBe('a:hand');
  expect(game.room.history.facts('card.used')).toHaveLength(0);
});

it('准备期间生成牌材料被移动，不能重取新位置作为原始支付位置', async () => {
  const definition: CardDefinition = {
    type: 'trick',
    id: 'probe:prepared',
    label: '准备探针',
    use: {
      count: { min: 1, max: 1 },
      target: () => true,
      resolve: () => {},
      async prepare(ctx) {
        await moveCards(
          ctx,
          [{ cards: ['material'], from: 'a:hand', to: 'd:hand', place: 'bottom' }],
          'probe:moved',
        );
        return { ok: true, value: { chosen: 'b' } };
      },
    },
  };
  const game = cardGame({ hands: { a: [card('material', 'peach')] }, definitions: [definition] });
  const result = await use(game, {
    actor: 'a',
    choice: {
      kind: 'generated',
      face: { name: definition.id },
      materials: ['material'],
      reason: 'probe',
    },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  expect(result).toMatchObject({ value: { kind: 'unavailable' } });
  expect(game.room.world.position('material')).toBe('d:hand');
  expect(game.room.history.facts('card.used')).toHaveLength(0);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
});

it('准备期间自动目标集合变化时拒绝宣告，不悄悄用另一组目标付费', async () => {
  const definition: CardDefinition = {
    type: 'trick',
    id: 'probe:prepared',
    label: '准备探针',
    use: {
      count: { min: 0, max: 0 },
      target: () => true,
      resolve: () => {},
      fixedTargets: (ctx) => ctx.world.snapshot.players.filter((p) => p.alive).map((p) => p.id),
      async prepare(ctx) {
        await kill(ctx, {
          player: 'b',
          killer: null,
          reason: 'rule',
          cause: { kind: 'rule', seq: null, data: null },
        });
        return { ok: true, value: null };
      },
    },
  };
  const game = cardGame({
    hands: { a: [{ ...card('p', 'slash'), name: definition.id }] },
    definitions: [definition],
  });
  expect(
    await use(game, {
      actor: 'a',
      choice: { kind: 'physical', card: 'p' },
      targets: [],
      timing: { kind: 'effect' },
    }),
  ).toMatchObject({
    value: { kind: 'unavailable', reason: 'Card or targets changed during preparation.' },
  });
  expect(game.room.world.position('p')).toBe('a:hand');
  expect(game.room.history.facts('card.used')).toHaveLength(0);
});
