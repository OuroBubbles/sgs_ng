import { playMatch } from '../fixtures/match';
import { expect, it } from 'vitest';
import { damage } from '../../src/sdk';
import { insight, echo } from '../../src/content/workshop/learning';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { practiceContent } from '../../src/app/offline/practice';
import { card, cardGame } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';

const source = { kind: 'general', id: 'probe' } as const;
const content = practiceContent;

it.each([true, false])(
  '拾慧首次伤害即获得余响并正式询问，接受=%s，不需等待下一次伤害',
  async (accept) => {
    const game = cardGame({
      skills: [insight, echo],
      hands: { b: [] },
      draw: [card('reward', 'jink'), card('next', 'slash')],
    });
    await game.room.run('grant', (ctx) =>
      game.skills.grant(ctx, { owner: 'b', skill: 'workshop:insight', source }),
    );
    const running = game.room.run('hit', (ctx) =>
      damage(ctx, { from: 'a', to: 'b', amount: 2, nature: 'normal' }),
    );
    const request = await nextRequest(game.room);
    expect(request.kind).toBe('invoke');
    expect(request.data).toMatchObject({ skill: echo.id });
    expect(game.room.world.player('b').hp).toBe(2);
    expect(
      game.room.world.snapshot.skills.some(
        (skill) => skill.owner === 'b' && skill.skill === echo.id,
      ),
    ).toBe(true);
    expect(game.room.decisions.submit(request.id, request.token, accept).kind).toBe('accepted');
    await running;
    expect(game.room.world.zone('b:hand').cards).toEqual(accept ? ['reward'] : []);
    const added = game.room.history.entries.filter((entry) => entry.type === 'window.included');
    expect(added).toHaveLength(1);
    const invoked = game.room.history.facts('skill.invoked');
    expect(invoked).toHaveLength(accept ? 2 : 1);
    const window = game.room.history.entries.find(
      (entry) =>
        entry.type === 'window.order' &&
        (entry.data as { window: string }).window === 'damage.received',
    )!;
    expect(invoked.every((fact) => fact.scopePath.includes(window.scopeId))).toBe(true);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  },
);

it('后续伤害自然收集已有余响，不重复学习、重新加入或复制同一时点次数', async () => {
  const game = cardGame({
    skills: [insight, echo],
    hands: { b: [] },
    draw: [card('reward', 'jink'), card('next', 'slash')],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'b', skill: 'workshop:insight', source }),
  );
  for (let index = 0; index < 2; index++) {
    const running = game.room.run('hit', (ctx) =>
      damage(ctx, { from: 'a', to: 'b', amount: 1, nature: 'normal' }),
    );
    const request = await nextRequest(game.room);
    expect(request.data).toMatchObject({ skill: echo.id });
    expect(game.room.decisions.submit(request.id, request.token, true).kind).toBe('accepted');
    await running;
  }
  expect(game.room.world.zone('b:hand').cards).toEqual(['reward', 'next']);
  expect(
    game.room.history.entries.filter((entry) => entry.type === 'window.included'),
  ).toHaveLength(1);
  expect(
    game.room.history
      .facts('skill.invoked')
      .map((fact) => (fact.data.detail as { skill: string }).skill),
  ).toEqual(['workshop:insight', echo.id, echo.id]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it.each([4, 17])(
  '问道客与标准技能组成四人真实身份局，基础 AI 至胜负，seed=%s',
  async (seed) => {
    const match = createOfflineMatch({
      seed,
      preset: 'workshop:defense',
      lineup: ['workshop:inquirer', 'standard:guojia', 'standard:simayi', 'standard:guanyu'],
      content,
    });
    await playMatch(match, { steps: 20000, decisions: 2400 });
    expect(match.room.history.entries.some((entry) => entry.type === 'window.included')).toBe(true);
    expect(
      match.room.history
        .facts('skill.invoked')
        .some((fact) => (fact.data.detail as { skill: string }).skill === echo.id),
    ).toBe(true);
    expect(match.initial.cards).toHaveLength(48);
  },
  30_000,
);
