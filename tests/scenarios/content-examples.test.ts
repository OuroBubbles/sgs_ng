import { expect, it } from 'vitest';
import definition from '../../examples/content/study';
import harbor, { Provision, tideDrawBonus } from '../../examples/content/harbor';
import gallery from '../../examples/content/gallery';
import standard from '../../src/content/standard';
import { createContent, damage, Cards, Cost } from '../../src/sdk';
import { createRoleMatch } from '../../src/host/content';
import { card, cardGame } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { Skill } from '../../src/sdk';

it('普通源码示例并使用宿主摸牌与宣告，拒绝不发动，已宣告后失去技能仍完成', async () => {
  expect(definition.generals[0]!.abilities).toHaveLength(1);
  createContent(standard, definition).createBooks();
  for (const accepted of [false, true]) {
    const game = cardGame({
      hands: { a: [card('trick', 'ex_nihilo')] },
      draw: [card('one', 'jink'), card('two', 'slash'), card('three', 'peach')],
      skills: definition.generals[0]!.abilities,
    });
    const source = { kind: 'general', id: 'guide' } as const;
    await game.room.run('grant', (ctx) =>
      game.skills.grant(ctx, { owner: 'a', skill: 'study', source }),
    );
    const draws: string[] = [];
    game.room.on(Cards.drawn, {
      id: 'observe-guide-draw',
      owner: null,
      eligible: () => true,
      run: (_ctx, result) => {
        draws.push(result.input.reason);
      },
    });
    game.room.on(Cost.paid, {
      id: 'revoke-after-declaration',
      owner: null,
      eligible: (_ctx, receipt) => receipt.skill === 'study',
      run: (ctx) => game.skills.revoke(ctx, 'a', 'study', source),
    });
    const running = game.room.run('guide-trick', (ctx) =>
      game.book.use(ctx, {
        actor: 'a',
        choice: { kind: 'physical', card: 'trick' },
        targets: ['a'],
        timing: { kind: 'effect' },
      }),
    );
    const request = await nextRequest(game.room);
    expect(request).toMatchObject({ kind: 'invoke', data: { skill: 'study' } });
    expect(draws).toEqual([]);
    expect(game.room.decisions.submit(request.id, request.token, accepted)).toEqual({
      kind: 'accepted',
    });
    expect(await running).toMatchObject({ kind: 'resolved', value: { kind: 'used' } });
    expect(draws).toEqual(accepted ? ['study', 'standard:ex_nihilo'] : ['standard:ex_nihilo']);
    expect(game.room.world.zone('a:hand').cards).toHaveLength(accepted ? 3 : 2);
    expect(game.room.history.facts(Skill.invoked)).toHaveLength(accepted ? 1 : 0);
    expect(game.room.world.snapshot.skills).toHaveLength(accepted ? 0 : 1);
    expect(game.room.decisions.pending).toEqual([]);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
    game.room.abort('done');
  }
});

it('真实备航和潮声经跨模块查询多摸一张，完成窗口触发墨韵回复，状态可由事实重建', async () => {
  expect(gallery.skills[0]!.triggers[0]!.window).toBe(Provision.finished);
  expect(gallery.skills[0]!.modifiers[0]!.query).toBe(tideDrawBonus);
  const content = createContent(standard, harbor, gallery);
  const match = createRoleMatch({
    seed: 2,
    preset: 'harbor:crossing',
    lineup: ['gallery:guest', 'standard:guanyu'],
    content,
  });
  await match.prepare();
  await match.room.run('wound', (ctx) =>
    damage(ctx, { from: null, to: '甲席', amount: 1, nature: 'normal' }),
  );
  expect(match.room.world.player('甲席').hp).toBe(3);
  const before = match.room.world.zone('甲席:hand').cards.length;
  const card = match.room.world
    .zone('甲席:hand')
    .cards.find((id) => match.room.world.card(id).name === 'harbor:provision')!;
  expect(card).toBeTruthy();
  const running = match.room.run('provision', (ctx) =>
    match.book.use(ctx, {
      actor: '甲席',
      choice: { kind: 'physical', card },
      targets: ['甲席'],
      timing: { kind: 'effect' },
    }),
  );
  for (const skill of ['harbor:tide', 'gallery:ink']) {
    const request = await nextRequest(match.room);
    expect(request).toMatchObject({ kind: 'invoke', data: { skill } });
    expect(match.room.decisions.submit(request.id, request.token, true)).toEqual({
      kind: 'accepted',
    });
  }
  await running;
  expect(match.room.world.zone('甲席:hand').cards).toHaveLength(before + 3);
  expect(match.room.world.player('甲席').hp).toBe(4);
  expect(match.room.world.position(card)).toBe('discard');
  expect(match.room.decisions.pending).toEqual([]);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('done');
});
