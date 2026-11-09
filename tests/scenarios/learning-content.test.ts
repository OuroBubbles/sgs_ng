import { playMatch } from '../fixtures/match';
import { expect, it } from 'vitest';
import { damage } from '../../src/sdk';
import insight from '../../src/content/workshop/skills/insight';
import echo from '../../src/content/workshop/skills/echo';
import { createRoleMatch } from '../../src/host/content';
import { practiceContent } from '../../src/host/content';
import { card, cardGame } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { Skill } from '../../src/sdk';

const source = { kind: 'general', id: 'probe' } as const;
const content = practiceContent;

it.each([true, false])(
  '拾慧首次伤害获得余响，余响自下一次伤害起才参与收集，接受=%s',
  async (accept) => {
    const game = cardGame({
      skills: [insight, echo],
      hands: { b: [] },
      draw: [card('reward', 'jink'), card('next', 'slash')],
    });
    await game.room.run('grant', (ctx) =>
      game.skills.grant(ctx, { owner: 'b', skill: 'workshop:insight', source }),
    );
    await game.room.run('hit', (ctx) =>
      damage(ctx, { from: 'a', to: 'b', amount: 2, nature: 'normal' }),
    );
    expect(game.room.decisions.pending).toEqual([]);
    expect(game.room.world.player('b').hp).toBe(2);
    expect(
      game.room.world.snapshot.skills.some(
        (skill) => skill.owner === 'b' && skill.skill === echo.id,
      ),
    ).toBe(true);
    expect(game.room.world.zone('b:hand').cards).toEqual([]);
    const running = game.room.run('hit', (ctx) =>
      damage(ctx, { from: 'a', to: 'b', amount: 1, nature: 'normal' }),
    );
    const request = await nextRequest(game.room);
    expect(request.kind).toBe('invoke');
    expect(request.data).toMatchObject({ skill: echo.id });
    expect(game.room.decisions.submit(request.id, request.token, accept).kind).toBe('accepted');
    await running;
    expect(game.room.world.zone('b:hand').cards).toEqual(accept ? ['reward'] : []);
    expect(game.room.history.facts(Skill.invoked)).toHaveLength(accept ? 2 : 1);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  },
);

it('后续伤害自然收集已有余响，不重复学习或复制同一时点次数', async () => {
  const game = cardGame({
    skills: [insight, echo],
    hands: { b: [] },
    draw: [card('reward', 'jink'), card('next', 'slash')],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'b', skill: 'workshop:insight', source }),
  );
  await game.room.run('learn', (ctx) =>
    damage(ctx, { from: 'a', to: 'b', amount: 1, nature: 'normal' }),
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
    game.room.history
      .facts(Skill.invoked)
      .map((fact) => (fact.data.detail as { skill: string }).skill),
  ).toEqual(['workshop:insight', echo.id, echo.id]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it.each([4, 17])(
  '问道客与标准技能组成四人真实身份局，托管 AI 至胜负，seed=%s',
  async (seed) => {
    const match = createRoleMatch({
      seed,
      preset: 'workshop:defense',
      lineup: ['workshop:inquirer', 'standard:guojia', 'standard:simayi', 'standard:guanyu'],
      content,
    });
    await playMatch(match, { steps: 20000, decisions: 2400 });
    expect(
      match.room.history
        .facts(Skill.invoked)
        .some((fact) => (fact.data.detail as { skill: string }).skill === echo.id),
    ).toBe(true);
    expect(match.initial.cards).toHaveLength(48);
  },
  30_000,
);
