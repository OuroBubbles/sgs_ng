import { testTiming } from '../fixtures/timing';
import { expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { defineSkill, rulesOf, on, moveCards, loseHp, createContent, useCard } from '../../src/sdk';
import type { SkillDefinition } from '../../src/sdk';
import { createRoleMatch, defaultContent, practiceContent } from '../../src/host/content';
import { cardView } from '../../src/host/projection';
import { observeAgent } from '../../src/host/agent-observation';
import { decideBasic } from '../../src/host/basic-agent';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { nextRequest } from '../fixtures/room';
import { RoleMatch } from '../../src/host/role-match';
import { standard } from '../fixtures/standard';
import { luoyiAftereffect } from '../../src/content/standard/generals/xuchu';

it('普通源码直接组合无命名空间的定义，保留时点身份、本局目录和真实技能结算', async () => {
  const window = testTiming<{ player: string }>('plain.window');
  const catalog = createContent(
    {
      cards: [{ id: 'ink', label: '墨', type: 'basic' }],
      decks: [
        {
          id: 'play',
          label: '试局',
          create: () => [{ id: 'one', name: 'ink', suit: 'spade', rank: 1 }],
        },
      ],
    },
    {
      skills: [
        defineSkill({
          id: 'study',
          name: '研习',
          triggers: [
            on(window, {
              locked: true,
              id: 'lose',
              when: (_ctx, event, self) => event.player === self.owner,
              effect: (ctx, _event, self) =>
                loseHp(ctx, { player: self.owner, amount: 1, reason: self.skill }),
            }),
          ],
        }),
      ],
      generals: [
        { id: 'scholar', name: '学士', kingdom: '群', gender: 'male', maxHp: 4, skills: ['study'] },
      ],
    },
  );
  const first = catalog.createBooks();
  const second = catalog.createBooks();
  expect(first.skills).not.toBe(second.skills);
  expect(first.skills.definition('study').triggers![0]!.window).toBe(window);
  const match = new RoleMatch({
    id: 'plain',
    seed: 1,
    content: catalog,
    deck: 'play',
    players: [
      { id: 'a', general: 'scholar' },
      { id: 'b', general: 'scholar' },
    ],
  });
  match.room.inspect((ctx) => expect(rulesOf(ctx)).toBe(match.skills));
  await match.prepare();
  const hp = match.room.world.player('a').hp;
  await match.room.run('plain', (ctx) => ctx.window(window, { player: 'a' }));
  expect(match.room.world.player('a').hp).toBe(hp - 1);
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
  match.room.abort('done');
});

it('内置源码显式组合标准与演武牌、武将和牌组，不自动发现目录', () => {
  // 独立效果可经普通定义组合；技能工厂不能再偷偷重复登记它。
  const content = createContent({ ...standard, effects: [] }, { effects: [luoyiAftereffect] });
  const first = content.createBooks();
  const second = content.createBooks();
  expect(first.skills.definition('standard:luoyi').name).toBe('裸衣');
  expect(second.skills.effects).not.toBe(first.skills.effects);
  for (const { skills } of [first, second])
    expect(() => skills.effects.register([luoyiAftereffect])).toThrow(/Duplicate effect/);
  expect(defaultContent.cards).toHaveLength(32);
  expect(defaultContent.generals).toHaveLength(26);
  expect(defaultContent.createDeck('standard:identity')).toHaveLength(108);
  expect(defaultContent.createDeck('standard:mechanics')).toHaveLength(288);
  expect(() => defaultContent.createDeck('workshop:showcase')).toThrow(/Unknown deck/);
  expect(practiceContent.cards).toHaveLength(37);
  expect(practiceContent.generals).toHaveLength(31);
  for (const [id, count] of [
    ['faces', 40],
    ['showcase', 44],
    ['relics', 40],
    ['chains', 48],
    ['defense', 48],
  ] as const)
    expect(practiceContent.createDeck('workshop:' + id)).toHaveLength(count);
});

it('声明列表在组合时固定，每局目录独立且技能经 rulesOf 读取本局目录', () => {
  const plain = { id: 'plain', name: '普通技能' };
  const skills: SkillDefinition[] = [plain];
  const content = createContent({ skills });
  skills.length = 0;
  const one = content.createBooks();
  const two = content.createBooks();
  expect(one.skills.definition('plain').name).toBe('普通技能');
  expect(two.skills).not.toBe(one.skills);
  expect(two.skills).not.toBe(one.skills);
});

it('组合拒绝重复定义和失效引用，另一局已经创建的目录保持独立', () => {
  const card = { id: 'card', label: '牌', type: 'basic' as const };
  expect(() => createContent({ cards: [card] }, { cards: [card] })).toThrow(/Duplicate card/);
  const skill = defineSkill({ id: 'skill', name: '技' });
  const valid = createContent({ skills: [skill] }).createBooks();
  expect(() => createContent({ skills: [skill, { ...skill }] }).createBooks()).toThrow(/Duplicate/);
  expect(() =>
    createContent({
      generals: [
        { id: 'guest', name: '客', kingdom: '群', gender: 'none', maxHp: 4, skills: ['missing'] },
      ],
    }).createBooks(),
  ).toThrow(/Unknown skill/);
  expect(valid.skills.definition('skill')).toMatchObject({ id: 'skill', name: '技' });
  expect(() => createContent({ cardViews: [{ id: 'missing', kind: 'other' }] })).toThrow(
    /unknown card/,
  );
});

it('普通定义与预装配目录共用牌组和效果装配，单机入口无需预先组合目录', async () => {
  for (const content of [standard, createContent(standard)]) {
    const offline = createRoleMatch({
      seed: 1,
      content,
      lineup: ['standard:guanyu', 'standard:caocao'],
    });
    expect(offline.deckName).toBe('标准＋EX（108 张）');
    expect(offline.initial.cards).toHaveLength(108);
    await offline.prepare();
    expect(rebuildWorld(offline.initial, offline.room.history.facts())).toEqual(
      offline.room.world.snapshot,
    );
    offline.room.abort('done');
    const match = new RoleMatch({
      id: 'content',
      seed: 1,
      players: [{ id: 'a' }, { id: 'b' }],
      deck: 'standard:identity',
      content,
    });
    await match.room.run('effect', (ctx) =>
      match.skills.effects.add(ctx, luoyiAftereffect, {
        owner: 'a',
        data: { actor: 'a', turn: 'probe' },
      }),
    );
    expect(match.skills.effects.instances(match.room.world, luoyiAftereffect)[0]?.data).toEqual({
      actor: 'a',
      turn: 'probe',
    });
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
    match.room.abort('done');
  }
});

it('实体牌按固定快照验证，重复实体与未知牌组明确失败', () => {
  const make = (name: string, duplicate = false) =>
    createContent({
      cards: [{ id: 'card', label: '牌', type: 'basic' }],
      decks: [
        {
          id: 'deck',
          label: '牌组',
          create: () => {
            const card = { id: 'one', name, suit: 'heart' as const, rank: 1 };
            return duplicate ? [card, card] : [card];
          },
        },
      ],
    });
  expect(() => make('missing').createDeck('deck')).toThrow(/Unknown card/);
  expect(() => make('card', true).createDeck('deck')).toThrow(/Duplicate physical card/);
  expect(() => make('card').createDeck('unknown')).toThrow(/Unknown deck/);

  let reads = 0;
  const physical = {
    id: 'physical',
    get name() {
      return ++reads === 1 ? 'card' : 'missing';
    },
    suit: 'heart' as const,
    rank: 1,
  };
  const match = new RoleMatch({
    id: 'snapshot',
    seed: 1,
    players: [{ id: 'a' }, { id: 'b' }],
    content: { cards: [{ id: 'card', label: '牌', type: 'basic' }] },
    deck: [physical],
  });
  expect(reads).toBe(1);
  expect(match.initial.cards[0]?.name).toBe('card');
  expect(Object.isFrozen(physical)).toBe(false);
  match.room.abort('done');
});

for (const branch of ['draw', 'recover'] as const) {
  it(`演武源码经实际目录完成闻策与整备 ${branch} 分支，使用普通选择并清理材料`, async () => {
    const match = createRoleMatch({
      seed: 1,
      preset: 'workshop:showcase',
      lineup: ['workshop:guest', 'standard:guanyu'],
      content: practiceContent,
    });
    await match.prepare();
    const id = 'workshop-card-41';
    const view = cardView(match, id);
    expect(view).toMatchObject({ id, name: '整备', kind: 'trick' });
    expect(view.description).toContain('回复 1 点体力');
    expect(
      match.room.world.snapshot.skills
        .filter((skill) => skill.owner === '甲席')
        .map((skill) => skill.skill)
        .sort(),
    ).toEqual(['standard:wusheng', 'workshop:hearing']);
    await match.room.run('fixture', async (ctx) => {
      await moveCards(
        ctx,
        [{ cards: [id], from: ctx.world.position(id), to: '甲席:hand', place: 'bottom' }],
        'fixture',
      );
      if (branch === 'recover') await loseHp(ctx, { player: '甲席', amount: 1, reason: 'fixture' });
    });
    const before = match.room.world.zone('甲席:hand').cards.length;
    const hp = match.room.world.player('甲席').hp;
    const running = match.room.run('test-use', (ctx) =>
      useCard(ctx, {
        actor: '甲席',
        choice: { kind: 'physical', card: id },
        targets: ['甲席'],
        timing: { kind: 'effect' },
      }),
    );
    const trigger = await nextRequest(match.room);
    expect(trigger.prompt).toContain('闻策');
    expect(match.room.decisions.submit(trigger.id, trigger.token, true)).toEqual({
      kind: 'accepted',
    });
    const option = await nextRequest(match.room);
    expect(option.kind).toBe('choose-option');
    expect(
      decideBasic(observeAgent(match, '甲席'), option, (input) =>
        match.room.decisions.preview(option.id, input),
      ),
    ).toEqual({ kind: 'submit', value: 'draw' });
    if (branch === 'draw')
      expect(match.room.decisions.preview(option.id, 'recover')?.valid).toBe(false);
    expect(match.room.decisions.submit(option.id, option.token, branch)).toEqual({
      kind: 'accepted',
    });
    expect(await running).toMatchObject({
      kind: 'resolved',
      value: { kind: 'used' },
    });
    expect(match.room.world.zone('甲席:hand').cards).toHaveLength(
      before + (branch === 'draw' ? 2 : 0),
    );
    expect(match.room.world.player('甲席').hp).toBe(hp + (branch === 'recover' ? 1 : 0));
    expect(match.room.world.position(id)).toBe('discard');
    expect(match.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
  });
}

it('混合内容的闻策也能响应标准锦囊，工厂未捕获另一套规则目录', async () => {
  const match = createRoleMatch({
    seed: 1,
    preset: 'workshop:showcase',
    lineup: ['workshop:guest', 'standard:guanyu'],
    content: practiceContent,
  });
  await match.prepare();
  const id = 'workshop-card-37';
  await match.room.run('fixture', (ctx) =>
    moveCards(
      ctx,
      [{ cards: [id], from: ctx.world.position(id), to: '甲席:hand', place: 'bottom' }],
      'fixture',
    ),
  );
  const running = match.room.run('use', (ctx) =>
    useCard(ctx, {
      actor: '甲席',
      choice: { kind: 'physical', card: id },
      targets: ['甲席'],
      timing: { kind: 'effect' },
    }),
  );
  const trigger = await nextRequest(match.room);
  expect(trigger.prompt).toContain('闻策');
  match.room.decisions.submit(trigger.id, trigger.token, false);
  expect(await running).toMatchObject({ kind: 'resolved' });
});

it('演武源码与基础 AI 共用标准动作/具名选项，真实完成整局，无必选卡死', async () => {
  const match = createRoleMatch({
    seed: 42,
    preset: 'workshop:showcase',
    lineup: ['workshop:guest', 'standard:guanyu', 'workshop:guest', 'standard:zhaoyun'],
    content: practiceContent,
  });
  const running = match.start();
  let decisions = 0;
  try {
    while (!match.result && decisions < 1800) {
      await setImmediate();
      const request = match.room.decisions.pending[0];
      if (!request) {
        expect(match.room.status).not.toBe('faulted');
        continue;
      }
      const answer = decideBasic(observeAgent(match, request.player), request, (input) =>
        match.room.decisions.preview(request.id, input),
      );
      expect(answer.kind, request.prompt).not.toBe('unsupported');
      if (answer.kind === 'unsupported') break;
      const reply =
        answer.kind === 'cancel'
          ? match.room.decisions.cancel(request.id, request.token)
          : match.room.decisions.submit(request.id, request.token, answer.value);
      expect(reply, request.prompt).toEqual({ kind: 'accepted' });
      decisions++;
    }
    expect(match.result, `${decisions} decisions`).not.toBeNull();
    expect(await running).toMatchObject({ kind: 'resolved' });
  } finally {
    match.room.abort('test finished');
    await running;
  }
}, 60_000);
