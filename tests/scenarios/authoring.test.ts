import { expect, it } from 'vitest';
import { relief } from '../../src/content/examples/relief';
import { SkillBook, damage, cardsMoved } from '../../src/sdk';
import { Room } from '../../src/core/runtime/room';
import { worldSeed, nextRequest } from '../fixtures/room';

function createGame() {
  const seed = worldSeed();
  const game = new Room({
    id: 'author',
    seed: 12345,
    world: {
      ...seed,
      cards: [...seed.cards, { id: 'd2', name: 'peach', suit: 'heart', rank: 3 }],
      zones: seed.zones.map((zone) =>
        zone.id === 'draw' ? { ...zone, cards: ['d1', 'd2'] } : zone,
      ),
    },
  });
  const book = new SkillBook([relief]);
  book.attach(game);
  return { game, book };
}

it('外部示例只依赖 SDK：受伤、询问、摸牌、联合选择、赠牌，全部结算后伤害才返回', async () => {
  const { game, book } = createGame();
  await game.run('setup', (ctx) =>
    book.grant(ctx, { owner: 'b', skill: relief.id, source: { kind: 'general', id: 'b' } }),
  );
  const running = game.run('hit', (ctx) =>
    damage(ctx, { from: 'a', to: 'b', amount: 1, nature: 'normal' }),
  );
  const invoke = await nextRequest(game);
  expect(invoke.kind).toBe('invoke');
  game.decisions.submit(invoke.id, invoke.token, true);
  const choice = await nextRequest(game);
  expect(choice.kind).toBe('cards-targets');
  expect(game.world.zone('b:hand').cards).toEqual(['b1', 'd1', 'd2']);
  expect(game.decisions.preview(choice.id, { cards: ['d1', 'd2'], targets: [] })).toMatchObject({
    valid: false,
    feedback: { valid: true },
  });
  game.decisions.submit(choice.id, choice.token, { cards: ['d1', 'd2'], targets: ['a'] });
  await running;
  expect(game.world.zone('b:hand').cards).toEqual(['b1']);
  expect(game.world.zone('a:hand').cards).toEqual(['a1', 'a2', 'd1', 'd2']);
  expect(game.world.player('b').hp).toBe(3);
  expect(game.decisions.pending).toEqual([]);
});

it('技能询问取消后不摸牌，取消联合选择则保留已经摸到的牌', async () => {
  const { game, book } = createGame();
  await game.run('setup', (ctx) =>
    book.grant(ctx, { owner: 'b', skill: relief.id, source: { kind: 'general', id: 'b' } }),
  );
  const first = game.run('hit', (ctx) =>
    damage(ctx, { from: 'a', to: 'b', amount: 1, nature: 'normal' }),
  );
  const invoke = await nextRequest(game);
  game.decisions.cancel(invoke.id, invoke.token);
  await first;
  expect(game.world.zone('draw').cards).toEqual(['d1', 'd2']);
  const second = game.run('hit', (ctx) =>
    damage(ctx, { from: 'a', to: 'b', amount: 1, nature: 'normal' }),
  );
  const next = await nextRequest(game);
  game.decisions.submit(next.id, next.token, true);
  const choice = await nextRequest(game);
  game.decisions.cancel(choice.id, choice.token);
  await second;
  expect(game.world.zone('b:hand').cards).toEqual(['b1', 'd1', 'd2']);
});

it('摸牌后效令技能失去后，不再弹出已经失效的赠牌选择', async () => {
  const { game, book } = createGame();
  const source = { kind: 'general', id: 'b' } as const;
  await game.run('setup', (ctx) => book.grant(ctx, { owner: 'b', skill: relief.id, source }));
  game.on(cardsMoved, {
    id: 'remove-after-draw',
    owner: 'a',
    eligible: (_ctx, event) => event.moves.some((move) => move.from === 'draw'),
    run: async (ctx) => {
      await book.revoke(ctx, 'b', relief.id, source);
    },
  });
  const running = game.run('hit', (ctx) =>
    damage(ctx, { from: 'a', to: 'b', amount: 1, nature: 'normal' }),
  );
  const invoke = await nextRequest(game);
  game.decisions.submit(invoke.id, invoke.token, true);
  await running;
  expect(game.world.snapshot.skills).toEqual([]);
  expect(game.decisions.pending).toEqual([]);
  expect(game.world.zone('b:hand').cards).toEqual(['b1', 'd1', 'd2']);
});
