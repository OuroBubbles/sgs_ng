import { expect, it } from 'vitest';
import { damage, draw, Cards, Damage, buildCard, respond } from '../../src/sdk';
import { card, cardGame } from '../fixtures/cards';
import { choose, nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { Draw } from '../../src/rules/cards/draw';

it('伤害开窗后调用方修改输入，不改变本次目标、数量和来源快照', async () => {
  const game = cardGame();
  game.room.on(Damage.causing, {
    id: 'ask',
    owner: 'a',
    eligible: () => true,
    run: async (ctx) => {
      await ctx.ask(choose());
    },
  });
  const input = { from: 'a', to: 'b', amount: 2, nature: 'normal' as const };
  const running = game.room.run('damage', (ctx) => damage(ctx, input));
  const request = await nextRequest(game.room);
  input.to = 'c';
  input.from = 'd';
  input.amount = 99;
  game.room.decisions.submit(request.id, request.token, 'yes');
  await running;
  expect(game.room.world.player('b').hp).toBe(2);
  expect(game.room.world.player('c').hp).toBe(4);
  expect(game.room.history.facts(Damage.dealt)[0]?.data.detail).toMatchObject({
    input: { from: 'a', to: 'b', amount: 2 },
    sourceSnapshot: { amount: 2 },
  });
});

it('摸牌开窗后外部修改输入，不改变已开始流程的接收者与请求', async () => {
  const game = cardGame({ hands: { a: [] }, draw: [card('top', 'slash')] });
  game.room.on(Cards.drawing, {
    id: 'ask',
    owner: 'a',
    eligible: () => true,
    run: async (ctx) => {
      await ctx.ask(choose());
    },
  });
  const input = { player: 'a', count: 1, reason: 'original draw' };
  const running = game.room.run('draw', (ctx) => draw(ctx, input));
  const request = await nextRequest(game.room);
  input.player = 'b';
  input.count = 0;
  input.reason = 'changed';
  game.room.decisions.submit(request.id, request.token, 'yes');
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['top']);
  expect(game.room.world.zone('b:hand').cards).toEqual([]);
  expect(game.room.history.facts(Draw.completed)[0]?.data.detail).toMatchObject({
    input: { player: 'a', count: 1, reason: 'original draw' },
  });
});

it('响应请求冻结匹配牌名和关联 ID，不追踪调用方后续修改', async () => {
  const game = cardGame({ hands: { b: [card('jink', 'jink')] } });
  const names = ['standard:jink'];
  const built = await game.room.run('build', (ctx) =>
    buildCard(ctx, 'a', { kind: 'physical', card: 'slash1' }, 'use'),
  );
  if (built.kind !== 'resolved' || !built.value.ok) throw new Error('Missing card.');
  const ref = {
    useId: 'use-original',
    effectId: 'effect-original',
    actor: 'a',
    target: 'b',
    card: built.value.value,
    processing: 'custom-processing',
  };
  const running = game.room.run('respond', (ctx) => respond(ctx, 'b', names, ref));
  const request = await nextRequest(game.room);
  names.splice(0);
  ref.useId = 'changed';
  ref.effectId = 'changed';
  expect(
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'jink' }).kind,
  ).toBe('accepted');
  await running;
  expect(game.room.history.facts(CardEvent.responded)[0]?.data.detail).toMatchObject({
    declaration: { to: { useId: 'use-original', effectId: 'effect-original' } },
  });
});
