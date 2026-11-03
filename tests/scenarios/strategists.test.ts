import { expect, it } from 'vitest';
import { playMatch } from '../fixtures/match';
import { card, cardGame } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { standardGeneralSkills } from '../../src/content/standard/generals';
import { tiandu, yiji } from '../../src/content/standard/generals/guojia';
import {
  judge,
  damage,
  moveCards,
  kill,
  defineSkill,
  modify,
  cardQueries,
  privateCardPools,
  withPrivateTopCards,
  runPhase,
  Cards,
  Judgment,
  Response,
  Damage,
  Cost,
} from '../../src/sdk';
import type { Context } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { RoleMatch } from '../../src/app/offline/role-match';
import { standardCards } from '../../src/content/standard/cards';
import { projectMatch } from '../../src/app/offline/projection';
import { observeAgent } from '../../src/app/offline/agent-observation';
import { decideBasic } from '../../src/app/offline/basic-agent';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { legacyGenerals } from '../fixtures/generals';
import { CardEvent } from '../../src/sdk';
import { Lifetime } from '../../src/sdk';
import { Skill } from '../../src/sdk';

type Game = ReturnType<typeof cardGame>;
function scenario(options: Parameters<typeof cardGame>[0] = {}) {
  return cardGame({
    ...options,
    hands: { a: [], ...options.hands },
    skills: options.skills ?? standardGeneralSkills,
  });
}
const source = { kind: 'general', id: 'test' } as const;
async function grant(game: Pick<Game, 'room' | 'skills'>, skill: string, owner = 'a') {
  await game.room.run('grant', (ctx) => game.skills.grant(ctx, { owner, skill, source }));
  return game.skills
    .bindings(game.room.world)
    .find((binding) => binding.self.owner === owner && binding.self.skill === skill)!.self;
}
async function answer(game: Pick<Game, 'room'>, value: unknown, kind = 'invoke') {
  const request = await nextRequest(game.room);
  expect(request.kind).toBe(kind);
  expect(game.room.decisions.submit(request.id, request.token, value)).toEqual({
    kind: 'accepted',
  });
}
async function cancel(game: Pick<Game, 'room'>) {
  const request = await nextRequest(game.room);
  expect(game.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
}
function replay(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  expect(game.room.world.snapshot.zones.filter((zone) => zone.kind === 'processing')).toEqual([]);
}
const healthCause = { kind: 'rule', seq: null, data: 'test' } as const;

it('鬼才可打出没有普通响应定义的桃；材料、旧牌、牌面与宣告同次提交', async () => {
  const game = scenario({
    hands: { a: [card('new', 'peach', 'heart')] },
    draw: [card('old', 'slash')],
  });
  const skill = await grant(game, 'standard:guicai');
  let judgment: Judgment;
  game.room.on(Judgment.revealed, {
    id: 'hold',
    owner: null,
    eligible: () => true,
    run: (_ctx, value) => {
      judgment = value;
    },
  });
  let paid = 0;
  let played = 0;
  game.room.on(Response.finished, {
    id: 'played',
    owner: null,
    eligible: () => true,
    run(_ctx, response) {
      played++;
      expect(response).toMatchObject({
        actor: 'a',
        card: { name: 'standard:peach', materials: ['new'] },
        subject: { kind: 'judgment', player: 'b', id: judgment.id },
      });
    },
  });
  game.room.on(Cards.moved, {
    id: 'observe',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.cards.includes('new')),
    run(ctx) {
      expect(judgment.card?.id).toBe('new');
      expect(ctx.world.position('old')).toBe('discard');
      expect(game.room.history.facts(Judgment.replaced)[0]!.data.detail).toMatchObject({
        declaration: { invocation: { actor: 'a', instance: skill.id, cards: ['new'] } },
      });
    },
  });
  game.room.on(Cost.paid, {
    id: 'cost',
    owner: null,
    eligible: (_ctx, receipt) => receipt.skill === skill.skill,
    run(ctx) {
      paid++;
      expect(ctx.world.position('new')).toBe(judgment.processing);
    },
  });
  await game.room.run('ordinary-response', (ctx) => {
    expect(game.book.build(ctx, 'a', { kind: 'physical', card: 'new' }, 'response').ok).toBe(false);
    expect(game.book.isResponseProhibited(ctx, 'a', game.book.physicalCard(ctx, 'new'))).toBe(
      false,
    );
  });
  const running = game.room.run('judge', (ctx) =>
    judge(ctx, {
      player: 'b',
      reason: 'probe',
      match: (_at, card) => card.suit === 'heart',
    }),
  );
  await answer(game, { cards: ['new'], targets: [] }, 'cards-targets');
  expect(await running).toMatchObject({ value: { matched: true, card: { id: 'new' } } });
  expect(paid).toBe(1);
  expect(played).toBe(1);
  expect(game.room.history.facts(CardEvent.responded)).toEqual([]);
  expect(game.room.history.facts(CardEvent.used)).toEqual([]);
  replay(game);
});

it.each(['response', 'use', 'discard'] as const)(
  '鬼才只受打出禁令影响，不混用使用或弃置权限：%s',
  async (kind) => {
    const locked = defineSkill({
      id: 'test:lock',
      name: '禁止',
      triggers: [],
      modifiers: [
        kind === 'response'
          ? modify(cardQueries.prohibitResponse, () => true)
          : kind === 'use'
            ? modify(cardQueries.prohibitUse, () => true)
            : modify(cardQueries.prohibitDiscard, () => true),
      ],
    });
    const game = scenario({
      hands: { a: [card('new', 'peach', 'heart')] },
      draw: [card('old', 'slash')],
      skills: [...standardGeneralSkills, locked],
    });
    await grant(game, 'standard:guicai');
    await grant(game, locked.id);
    const running = game.room.run('judge', (ctx) =>
      judge(ctx, {
        player: 'b',
        reason: 'probe',
        match: (_at, card) => card.suit === 'heart',
      }),
    );
    if (kind !== 'response') await answer(game, { cards: ['new'], targets: [] }, 'cards-targets');
    expect(await running).toMatchObject({ value: { matched: kind !== 'response' } });
    expect(game.room.world.position('new')).toBe(kind === 'response' ? 'a:hand' : 'discard');
  },
);

it('鬼才取消不宣告；候选仅限本人手牌，拒绝装备、他人牌与多张材料', async () => {
  const game = scenario({
    hands: { a: [card('mine', 'peach')], b: [card('foreign', 'slash')] },
    equipment: { a: [card('weapon', 'spear')] },
    draw: [card('old', 'slash')],
  });
  await grant(game, 'standard:guicai');
  const running = game.room.run('judge', (ctx) =>
    judge(ctx, { player: 'b', reason: 'probe', match: () => true }),
  );
  const request = await nextRequest(game.room);
  for (const cards of [['weapon'], ['foreign'], ['mine', 'foreign']])
    expect(game.room.decisions.preview(request.id, { cards, targets: [] })!.valid).toBe(false);
  await cancel(game);
  await running;
  expect(game.room.history.facts(Judgment.replaced)).toEqual([]);
  expect(game.room.world.position('mine')).toBe('a:hand');
});

it('多个鬼才按判定角色锚点依次改判，后者看到实时新牌，每人只获得本次窗口的一次候选', async () => {
  const game = scenario({
    hands: { a: [card('last', 'jink', 'club')], b: [card('first', 'peach', 'heart')] },
    draw: [card('old', 'slash')],
  });
  await grant(game, 'standard:guicai', 'a');
  await grant(game, 'standard:guicai', 'b');
  const running = game.room.run('judge', (ctx) =>
    judge(ctx, {
      player: 'b',
      reason: 'probe',
      match: (_at, card) => card.color === 'red',
    }),
  );
  expect((await nextRequest(game.room)).player).toBe('b');
  await answer(game, { cards: ['first'], targets: [] }, 'cards-targets');
  const next = await nextRequest(game.room);
  expect(next.player).toBe('a');
  expect(next.data).toMatchObject({ judgment: { card: { id: 'first' } } });
  await answer(game, { cards: ['last'], targets: [] }, 'cards-targets');
  expect(await running).toMatchObject({
    value: { matched: false, card: { id: 'last' } },
  });
  expect(game.room.history.facts(Judgment.replaced)).toHaveLength(2);
  replay(game);
});

it('鬼才宣告后改判者死亡或失去技能不回滚新牌面', async () => {
  for (const branch of ['dead', 'revoke'] as const) {
    const game = scenario({
      hands: { a: [card('new', 'peach', 'heart')] },
      draw: [card('old', 'slash')],
    });
    await grant(game, 'standard:guicai');
    game.room.on(Cost.paid, {
      id: 'lose-source',
      owner: null,
      eligible: (_ctx, receipt) => receipt.skill === 'standard:guicai',
      async run(ctx) {
        if (branch === 'dead')
          await kill(ctx, { player: 'a', killer: null, reason: 'rule', cause: healthCause });
        else await game.skills.revoke(ctx, 'a', 'standard:guicai', source);
      },
    });
    const running = game.room.run('judge', (ctx) =>
      judge(ctx, {
        player: 'b',
        reason: 'probe',
        match: (_at, card) => card.suit === 'heart',
      }),
    );
    await answer(game, { cards: ['new'], targets: [] }, 'cards-targets');
    expect(await running).toMatchObject({ value: { matched: true } });
    expect(game.room.history.facts(Judgment.replaced)).toHaveLength(1);
    replay(game);
  }
});

it.each(['lost-skill', 'wrong-owner', 'legal'] as const)(
  '带宣告的底层改判在提交前拒绝失效费用，不留下半改判：%s',
  async (branch) => {
    const probe = defineSkill({ id: 'test:retrial', name: '改判探针', triggers: [] });
    const game = scenario({
      hands: { a: [card('new', 'peach', 'heart')], c: [card('other', 'jink')] },
      draw: [card('old', 'slash')],
      skills: [...standardGeneralSkills, probe],
    });
    const self = await grant(game, probe.id);
    game.room.on(Judgment.retrial, {
      id: 'guard-probe',
      owner: null,
      eligible: () => true,
      async run(ctx, judgment) {
        if (branch === 'lost-skill') await game.skills.revoke(ctx, 'a', self.skill, source);
        const result = await judgment.replace(ctx, {
          card: branch === 'wrong-owner' ? 'other' : 'new',
          from: branch === 'wrong-owner' ? 'c:hand' : 'a:hand',
          reason: self.skill,
          skill: self,
          legal: () => branch !== 'legal',
        });
        expect(result).toEqual('unavailable');
      },
    });
    await game.room.run('judge', (ctx) =>
      judge(ctx, { player: 'b', reason: 'probe', match: () => true }),
    );
    expect(game.room.history.facts(Judgment.replaced)).toEqual([]);
    expect(game.room.world.position('new')).toBe('a:hand');
    expect(game.room.world.position('other')).toBe('c:hand');
  },
);

it('反馈按一次伤害发动一次，暗选不暴露手牌实体或牌名', async () => {
  const game = scenario({ hands: { b: [card('secret', 'ex_nihilo')] } });
  await grant(game, 'standard:fankui');
  const running = game.room.run('hit', (ctx) =>
    damage(ctx, { from: 'b', to: 'a', amount: 2, nature: 'normal' }),
  );
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('cards-targets');
  expect(request.optional).toBe(true);
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  expect(JSON.stringify(request.data)).not.toContain('secret');
  expect(JSON.stringify(request.data)).not.toContain('无中生有');
  const option = (request.data as { preview: { cards: { id: string }[] } }).preview.cards[0]!.id;
  for (const cards of [['secret'], ['unknown'], [option, option]])
    expect(
      game.room.decisions.submit(request.id, request.token, { cards, targets: [] }),
    ).toMatchObject({
      kind: 'rejected',
      reason: 'invalid',
    });
  expect(game.room.history.facts(Skill.invoked)).toEqual([]);
  await answer(game, { cards: [option], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['secret']);
  expect(game.room.history.facts(CardEvent.taken)).toHaveLength(1);
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  expect(game.room.decisions.pending).toEqual([]);
  expect(game.room.history.facts(CardEvent.taken)[0]!.data.detail).toMatchObject({
    declaration: { open: false },
  });
  replay(game);
});

it('反馈自伤时只能收回装备，不能选择原有手牌；装备也不受弃置禁令阻挡', async () => {
  const locked = defineSkill({
    id: 'test:no-discard',
    name: '禁止弃置',
    triggers: [],
    modifiers: [modify(cardQueries.prohibitDiscard, () => true)],
  });
  const game = scenario({
    hands: { a: [card('hand', 'peach')] },
    equipment: { a: [card('weapon', 'spear')] },
    skills: [...standardGeneralSkills, locked],
  });
  await grant(game, 'standard:fankui');
  await grant(game, locked.id);
  const running = game.room.run('hit', (ctx) =>
    damage(ctx, { from: 'a', to: 'a', amount: 1, nature: 'normal' }),
  );
  const request = await nextRequest(game.room);
  const choices = (request.data as { preview: { cards: { id: string; label: string }[] } }).preview
    .cards;
  expect(choices).toHaveLength(1);
  expect(choices[0]!.label).toContain('丈八蛇矛');
  await answer(game, { cards: [choices[0]!.id], targets: [] }, 'cards-targets');
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['hand', 'weapon']);
  expect(game.room.history.facts(CardEvent.taken)[0]!.data.detail).toMatchObject({
    declaration: { open: true },
  });
});

it('反馈无来源、来源先死亡或仅有自伤手牌时不制造选择；可正常拒绝', async () => {
  for (const branch of ['null', 'dead', 'self-hand', 'decline'] as const) {
    const game = scenario({ hands: { a: [card('mine', 'peach')], b: [card('theirs', 'peach')] } });
    await grant(game, 'standard:fankui');
    if (branch === 'dead')
      game.room.on(Damage.dealt, {
        id: 'die',
        owner: null,
        eligible: () => true,
        run: async (ctx) => {
          await kill(ctx, { player: 'b', killer: null, reason: 'rule', cause: healthCause });
        },
      });
    const running = game.room.run('hit', (ctx) =>
      damage(ctx, {
        from: branch === 'null' ? null : branch === 'self-hand' ? 'a' : 'b',
        to: 'a',
        amount: 1,
        nature: 'normal',
      }),
    );
    if (branch === 'decline') await cancel(game);
    await running;
    expect(game.room.history.facts(CardEvent.taken)).toEqual([]);
    expect(game.room.history.facts(Skill.invoked)).toEqual([]);
    expect(game.room.history.facts(CardEvent.chosen)).toEqual([]);
  }
});

it('反馈宣告后失去技能仍取牌，选牌离区或来源死亡不追取', async () => {
  for (const branch of ['declared-card', 'declared-skill', 'dead'] as const) {
    const game = scenario({ hands: { b: [card('chosen', 'peach')] } });
    await grant(game, 'standard:fankui');
    const change = async (ctx: Context) => {
      if (branch.endsWith('skill')) await game.skills.revoke(ctx, 'a', 'standard:fankui', source);
      else if (branch === 'dead')
        await kill(ctx, { player: 'b', killer: null, reason: 'rule', cause: healthCause });
      else
        await moveCards(
          ctx,
          [{ cards: ['chosen'], from: 'b:hand', to: 'c:hand', place: 'bottom' }],
          'probe',
        );
    };
    game.room.on(Cost.paid, {
      id: 'after-declaration',
      owner: null,
      eligible: (_ctx, receipt) => receipt.skill === 'standard:fankui',
      run: change,
    });
    const running = game.room.run('hit', (ctx) =>
      damage(ctx, { from: 'b', to: 'a', amount: 1, nature: 'normal' }),
    );
    const request = await nextRequest(game.room);
    const option = (request.data as { preview: { cards: { id: string }[] } }).preview.cards[0]!.id;
    await answer(game, { cards: [option], targets: [] }, 'cards-targets');
    await running;
    expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
    expect(game.room.history.facts(CardEvent.chosen)).toHaveLength(1);
    expect(game.room.history.facts(CardEvent.taken)).toHaveLength(
      branch === 'declared-skill' ? 1 : 0,
    );
    expect(game.room.world.zone('a:hand').cards).toEqual(
      branch === 'declared-skill' ? ['chosen'] : [],
    );
    expect(game.room.decisions.pending).toEqual([]);
    replay(game);
  }
});

it('天妒取得最终改判牌，不受判定是否成功影响，旧判定牌仍弃置', async () => {
  const game = scenario({
    hands: { a: [card('new', 'peach', 'heart')] },
    draw: [card('old', 'slash')],
  });
  await grant(game, 'standard:guicai');
  await grant(game, tiandu.id, 'b');
  const running = game.room.run('judge', (ctx) =>
    judge(ctx, { player: 'b', reason: 'probe', match: () => false }),
  );
  await answer(game, { cards: ['new'], targets: [] }, 'cards-targets');
  await answer(game, true);
  expect(await running).toMatchObject({ value: { matched: false } });
  expect(game.room.world.position('new')).toBe('b:hand');
  expect(game.room.world.position('old')).toBe('discard');
  replay(game);
});

it('天妒宣告后技能失去仍可取得，牌被先取走或本人死亡则不强取', async () => {
  for (const branch of ['revoke', 'taken', 'dead'] as const) {
    const game = scenario({ draw: [card('top', 'slash')] });
    await grant(game, tiandu.id);
    game.room.on(Cost.paid, {
      id: 'change',
      owner: null,
      eligible: (_ctx, paid) => paid.skill === tiandu.id,
      async run(ctx) {
        if (branch === 'revoke') await game.skills.revoke(ctx, 'a', tiandu.id, source);
        else if (branch === 'taken')
          await moveCards(
            ctx,
            [{ cards: ['top'], from: ctx.world.position('top'), to: 'c:hand', place: 'bottom' }],
            'take',
          );
        else await kill(ctx, { player: 'a', killer: null, reason: 'rule', cause: healthCause });
      },
    });
    const running = game.room.run('judge', (ctx) =>
      judge(ctx, { player: 'a', reason: 'probe', match: () => true }),
    );
    await answer(game, true);
    await running;
    expect(game.room.world.position('top')).toBe(
      branch === 'revoke' ? 'a:hand' : branch === 'taken' ? 'c:hand' : 'discard',
    );
    replay(game);
  }
});

it('天妒与洛神共享一次判定，不重复取得同一张牌，结果仍可继续判定', async () => {
  const game = scenario({ draw: [card('top', 'slash'), card('next', 'jink')] });
  await grant(game, tiandu.id);
  await grant(game, 'standard:luoshen');
  const running = game.room.run('prepare', (ctx) => runPhase(ctx, game.book, 'a', 'prepare'));
  await answer(game, true);
  await answer(game, true);
  await answer(game, false);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['top']);
  expect(game.room.history.facts(Judgment.cardObtained)).toHaveLength(1);
  expect(game.room.world.position('next')).toBe('draw');
});

function privateMatch() {
  return new RoleMatch({
    id: 'privacy',
    seed: 42,
    players: [{ id: 'a' }, { id: 'b' }],
    content: {
      cards: standardCards,
      skills: standardGeneralSkills,
    },
    deck: [card('secret-one', 'ex_nihilo', 'heart'), card('secret-two', 'collateral')],
  });
}

it('遗计私有牌池不算手牌、不触发摸牌，只有本人投影和 AI 观察可见；分批交牌与保留余牌', async () => {
  const match = privateMatch();
  await grant(match, yiji.id);
  let draws = 0;
  match.room.on(Cards.drawn, {
    id: 'count',
    owner: null,
    eligible: () => true,
    run: () => {
      draws++;
    },
  });
  const running = match.room.run('hit', (ctx) =>
    damage(ctx, { from: 'b', to: 'a', amount: 1, nature: 'normal' }),
  );
  await answer(match, true);
  let request = await nextRequest(match.room);
  const own = projectMatch(match, 'a', request);
  expect(own.hand).toEqual([]);
  expect(own.pools[0]).toMatchObject({
    visibility: 'private',
    cards: [{ id: 'secret-one' }, { id: 'secret-two' }],
  });
  for (const viewer of ['b', null]) {
    const other = projectMatch(match, viewer, null);
    expect(other.pools).toEqual([]);
    expect(JSON.stringify(other)).not.toMatch(/secret-one|secret-two|无中生有|借刀杀人/);
  }
  expect(observeAgent(match, 'a').pools.map((card) => card.id)).toEqual([
    'secret-one',
    'secret-two',
  ]);
  expect(observeAgent(match, 'b').pools).toEqual([]);
  await answer(match, { cards: ['secret-one'], targets: ['b'] }, 'cards-targets');
  request = await nextRequest(match.room);
  expect(projectMatch(match, 'a', request).pools[0]!.cards.map((card) => card.id)).toEqual([
    'secret-two',
  ]);
  expect(projectMatch(match, 'b', null).hand.map((card) => card.id)).toEqual(['secret-one']);
  await cancel(match);
  await running;
  expect(match.room.world.zone('a:hand').cards).toEqual(['secret-two']);
  expect(match.room.world.zone('b:hand').cards).toEqual(['secret-one']);
  expect(projectMatch(match, null, null).pools).toEqual([]);
  expect(draws).toBe(0);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  expect(match.room.world.snapshot.states).toEqual([]);
});

it('遗计每点伤害独立征询，拒绝第一点不取消第二点，可一次分配全部两张牌', async () => {
  const game = scenario({
    draw: [card('one', 'slash'), card('two', 'jink'), card('unused', 'peach')],
  });
  await grant(game, yiji.id);
  const running = game.room.run('hit', (ctx) =>
    damage(ctx, { from: 'b', to: 'a', amount: 2, nature: 'normal' }),
  );
  await answer(game, false);
  await answer(game, true);
  await answer(game, { cards: ['one', 'two'], targets: ['c'] }, 'cards-targets');
  await running;
  expect(game.room.world.zone('c:hand').cards).toEqual(['one', 'two']);
  expect(game.room.world.position('unused')).toBe('draw');
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
  replay(game);
});

it('遗计已宣告部分不因失去技能中断，后一个伤害 occurrence 不再发动', async () => {
  const game = scenario({
    draw: [card('one', 'slash'), card('two', 'jink'), card('unused', 'peach')],
  });
  await grant(game, yiji.id);
  game.room.on(Cost.paid, {
    id: 'revoke',
    owner: null,
    eligible: (_ctx, receipt) => receipt.skill === yiji.id,
    run: async (ctx) => {
      await game.skills.revoke(ctx, 'a', yiji.id, source);
    },
  });
  const running = game.room.run('hit', (ctx) =>
    damage(ctx, { from: 'b', to: 'a', amount: 2, nature: 'normal' }),
  );
  await answer(game, true);
  await cancel(game);
  await running;
  expect(game.room.world.zone('a:hand').cards).toEqual(['one', 'two']);
  expect(game.room.world.position('unused')).toBe('draw');
  replay(game);
});

it('遗计交出部分牌后本人死亡，已交出的牌保留，池中余牌弃置且元数据关闭', async () => {
  const game = scenario({ draw: [card('one', 'slash'), card('two', 'jink')] });
  await grant(game, yiji.id);
  game.room.on(Cards.moved, {
    id: 'die-after-give',
    owner: null,
    eligible: (_ctx, moved) => moved.moves.some((move) => move.to === 'b:hand'),
    run: async (ctx) => {
      await kill(ctx, { player: 'a', killer: null, reason: 'rule', cause: healthCause });
    },
  });
  const running = game.room.run('hit', (ctx) =>
    damage(ctx, { from: 'b', to: 'a', amount: 1, nature: 'normal' }),
  );
  await answer(game, true);
  await answer(game, { cards: ['one'], targets: ['b'] }, 'cards-targets');
  await running;
  expect(game.room.world.position('one')).toBe('b:hand');
  expect(game.room.world.position('two')).toBe('discard');
  expect(privateCardPools(game.room.world, 'a')).toEqual([]);
  replay(game);
});

it('私有牌池只洗弃牌补足，不借用外层处理区；牌被先取走后按实时余牌选择', async () => {
  const game = scenario({ draw: [card('first', 'slash')], discard: [card('second', 'jink')] });
  await grant(game, yiji.id);
  game.room.on(Cards.moved, {
    id: 'take-first',
    owner: null,
    eligible: (_ctx, moved) =>
      moved.moves.some((move) => move.from === 'draw' && move.cards.includes('first')),
    run: async (ctx) => {
      await moveCards(
        ctx,
        [{ cards: ['first'], from: ctx.world.position('first'), to: 'c:hand', place: 'bottom' }],
        'take',
      );
    },
  });
  const running = game.room.run('hit', (ctx) =>
    damage(ctx, { from: 'b', to: 'a', amount: 1, nature: 'normal' }),
  );
  await answer(game, true);
  const request = await nextRequest(game.room);
  expect(
    (request.data as { preview: { cards: { id: string }[] } }).preview.cards.map((card) => card.id),
  ).toEqual(['second']);
  await cancel(game);
  await running;
  expect(game.room.world.position('first')).toBe('c:hand');
  expect(game.room.world.position('second')).toBe('a:hand');
  replay(game);
});

it('私有牌池嵌套互不混合，子流程中止也清理余牌与可见者状态', async () => {
  const game = scenario({ draw: [card('outer', 'slash'), card('inner', 'jink')] });
  const result = await game.room.run('pools', (ctx) =>
    withPrivateTopCards(ctx, { player: 'a', count: 1, reason: 'outer' }, async (at, outer) => {
      expect(privateCardPools(at.world, 'a')[0]!.cards).toEqual(['outer']);
      expect(at.world.snapshot.states.find((state) => state.source === outer.zone)).toMatchObject({
        scopeId: outer.lifetime.id,
      });
      const inner = await at.attempt('inner pool', (inside) =>
        withPrivateTopCards(inside, { player: 'b', count: 2, reason: 'inner' }, (child, pool) => {
          expect(pool.remaining()).toEqual(['inner']);
          expect(privateCardPools(child.world, 'a')[0]!.zone).toBe(outer.zone);
          expect(privateCardPools(child.world, 'b')[0]!.cards).toEqual(['inner']);
          expect(
            child.world.snapshot.states.find((state) => state.source === pool.zone),
          ).toMatchObject({
            scopeId: pool.lifetime.id,
          });
          child.abort('inner cancelled');
        }),
      );
      expect(inner.kind).toBe('aborted');
      expect(outer.remaining()).toEqual(['outer']);
      expect(privateCardPools(at.world, 'b')).toEqual([]);
      return 'outer-result';
    }),
  );
  expect(result).toMatchObject({ kind: 'resolved', value: 'outer-result' });
  expect(game.room.world.zone('discard').cards).toEqual(['inner', 'outer']);
  expect(game.room.world.snapshot.states).toEqual([]);
  expect(game.room.history.facts(Lifetime.ended).map((fact) => fact.data.detail)).toMatchObject([
    {
      kind: 'processing',
      exit: 'aborted',
      statesBefore: [{ key: 'core:private-pool', owner: 'b' }],
    },
    {
      kind: 'processing',
      exit: 'resolved',
      statesBefore: [{ key: 'core:private-pool', owner: 'a' }],
    },
  ]);
  replay(game);
});

it('遗计空牌堆或不足两张时正常结束，不制造必选死锁', async () => {
  for (const count of [0, 1]) {
    const game = scenario({ draw: count ? [card('only', 'slash')] : [] });
    await grant(game, yiji.id);
    const running = game.room.run('hit', (ctx) =>
      damage(ctx, { from: null, to: 'a', amount: 1, nature: 'normal' }),
    );
    await answer(game, true);
    if (count) await cancel(game);
    await running;
    expect(game.room.world.zone('a:hand').cards).toHaveLength(count);
    replay(game);
  }
});

it('基础 AI 鬼才只用本人手牌和公开判定改良结果，未知判定或无需改善时放弃', async () => {
  for (const reason of ['standard:indulgence', 'unknown', 'already-good']) {
    const match = privateMatch();
    await match.room.run('hand', (ctx) =>
      moveCards(
        ctx,
        [{ cards: ['secret-two'], from: 'draw', to: 'a:hand', place: 'bottom' }],
        'setup',
      ),
    );
    const observation = observeAgent(match, 'a');
    const request = {
      id: 'test',
      token: 1,
      revision: 0,
      player: 'a',
      optional: true,
      kind: 'cards-targets',
      prompt: '',
      data: {
        reason: 'standard:guicai',
        judgment: {
          player: 'a',
          reason: reason === 'already-good' ? 'standard:indulgence' : reason,
          card: { suit: reason === 'already-good' ? 'heart' : 'spade', rank: 7 },
        },
      },
    };
    const choice = decideBasic(observation, request, () => ({ valid: true, feedback: null }));
    // 黑色本人手牌不能把乐不思蜀改善为红桃，绝不凭空提供牌堆中的心牌。
    expect(choice.kind).toBe('cancel');
  }
});

it('基础 AI 用本人真实红桃手牌改善自己的乐不思蜀，仍经过正式预览与提交', async () => {
  const match = privateMatch();
  await grant(match, 'standard:guicai');
  await match.room.run('hand', (ctx) =>
    moveCards(
      ctx,
      [{ cards: ['secret-one'], from: 'draw', to: 'a:hand', place: 'bottom' }],
      'setup',
    ),
  );
  const running = match.room.run('judge', (ctx) =>
    judge(ctx, {
      player: 'a',
      reason: 'standard:indulgence',
      match: (_at, card) => card.suit === 'heart',
    }),
  );
  const request = await nextRequest(match.room);
  const reply = decideBasic(observeAgent(match, 'a'), request, (value) =>
    match.room.decisions.preview(request.id, value),
  );
  expect(reply).toEqual({ kind: 'submit', value: { cards: ['secret-one'], targets: [] } });
  if (reply.kind !== 'submit') throw new Error('Expected a legal retrial.');
  expect(match.room.decisions.submit(request.id, request.token, reply.value)).toEqual({
    kind: 'accepted',
  });
  expect(await running).toMatchObject({
    value: { matched: true, card: { id: 'secret-one' } },
  });
});

it('含司马懿、郭嘉、甄姬的八人局，基础 AI 经正式改判、暗选和分牌走到身份胜负', async () => {
  const lineup = [9, 10, 8, 6, 7, 0, 2, 5].map((index) => legacyGenerals[index]!.id);
  const match = createOfflineMatch({ seed: 3, preset: 'standard:identity', lineup });
  await playMatch(match, { steps: 5000 });

  expect(match.room.history.facts(Judgment.replaced).length).toBeGreaterThan(0);
  expect(
    match.room.history
      .facts(CardEvent.taken)
      .some(
        (fact) =>
          (fact.data.detail as { declaration?: { reason?: string } }).declaration?.reason ===
          'standard:fankui',
      ),
  ).toBe(true);
  expect(match.room.history.facts(Cards.peeked).length).toBeGreaterThan(0);
  expect(match.room.history.facts(Cards.given).length).toBeGreaterThan(0);
}, 60_000);
