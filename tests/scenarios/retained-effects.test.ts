import { testTiming } from '../fixtures/timing';
import { expect, it } from 'vitest';
import {
  blockSkill,
  defineSkill,
  draw,
  equip,
  equipmentCard,
  equipmentLost,
  invoke,
  kill,
  moveCards,
  on,
  pay,
  skillLost,
  withLifetime,
  activeOffers,
  runPhase,
  modify,
  cardQueries,
  viewAs,
  ownedCards,
  Cards,
  Death,
  Lifetime,
  Skill,
} from '../../src/sdk';
import type { Context, SkillHandle, PhaseView } from '../../src/sdk';
import type { SkillInstance } from '../../src/core/model/state';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { createOfflineMatch } from '../../src/app/offline/practice';
import { practiceContent } from '../../src/app/offline/practice';

const original = { kind: 'general', id: 'original' } as const;
const additional = { kind: 'effect', id: 'additional' } as const;
const death = { kind: 'rule', seq: null, data: null } as const;
type Game = ReturnType<typeof cardGame>;

async function answer(game: Game, value: unknown = true) {
  const request = await nextRequest(game.room);
  expect(game.room.decisions.submit(request.id, request.token, value)).toEqual({
    kind: 'accepted',
  });
  return request;
}
function rebuilt(game: Game) {
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
}
function lostArmor(run: (ctx: Context, self: SkillHandle) => void | Promise<void>) {
  const retained = true;
  const lost = {
    id: 'lost',
    locked: true,
    retain: (ctx: Context, moved: Parameters<typeof equipmentLost>[1], self: SkillHandle) =>
      retained && equipmentLost(ctx.world, moved, self),
    when: (ctx: Context, moved: Parameters<typeof equipmentLost>[1], self: SkillHandle) =>
      retained && equipmentLost(ctx.world, moved, self),
    effect: (ctx: Context, _event: unknown, self: SkillHandle) => run(ctx, self),
  };
  return equipmentCard({
    id: 'probe:retained-armor',
    label: '离场甲',
    slot: 'armor',
    skill: defineSkill({
      id: 'probe:retained-armor-ability',
      name: '遗响',
      triggers: [on(Cards.moved, lost)],
    }),
  });
}

it('离场装备能使用普通 invoke 宣告并摸牌，当前能力目录仍没有旧装备', async () => {
  let captured: SkillHandle;
  let capturedAt: Context;
  const armor = lostArmor(async (ctx, self) => {
    captured = self;
    capturedAt = ctx;
    expect(self.active(ctx)).toBe(true);
    expect(game.skills.binding(ctx.world, self.id)).toBeUndefined();
    if (await invoke(ctx, self, '是否发动遗响？'))
      await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
  });
  const game = cardGame({
    hands: { a: [] },
    equipment: { a: [{ ...card('armor', 'slash'), name: armor.id }] },
    definitions: [armor],
    draw: [card('reward', 'jink')],
  });
  const running = game.room.run('loss', (ctx) =>
    moveCards(
      ctx,
      [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
      'loss',
    ),
  );
  expect((await answer(game)).kind).toBe('invoke');
  await running;
  expect(captured!.active(capturedAt!)).toBe(false);
  expect(game.room.world.zone('a:hand').cards).toEqual(['reward']);
  expect(game.room.history.facts('skill.invoked')[0]?.data.detail).toMatchObject({
    skill: 'probe:retained-armor-ability',
    instance: captured!.id,
  });
  await game.room.run('closed', (ctx) => {
    expect(captured.active(ctx)).toBe(false);
  });
  rebuilt(game);
});

it.each(['revoke', 'expiration'] as const)(
  '普通技能的 %s 快照可明确保留来源，旧实例不回到 World',
  async (kind) => {
    const respond = async (ctx: Context, self: SkillHandle) => {
      expect(self.active(ctx)).toBe(true);
      if (await invoke(ctx, self, '是否发动遗响？'))
        ctx.commit('probe.retained', [], { instance: self.id });
    };
    const legacy = defineSkill({
      id: 'probe:legacy',
      name: '遗响',
      triggers: [
        on(Skill.changed, {
          locked: true,
          id: 'lost',
          retain: (ctx, change, self) => skillLost(ctx.world, change.before, self),
          when: (ctx, change, self) => skillLost(ctx.world, change.before, self),
          effect: (ctx, _event, self) => respond(ctx, self),
        }),
        on(Lifetime.ended, {
          locked: true,
          id: 'expired',
          retain: (ctx, ended, self) =>
            ended.skillsBefore.some((old) => skillLost(ctx.world, old, self)),
          when: (ctx, ended, self) =>
            ended.skillsBefore.some((old) => skillLost(ctx.world, old, self)),
          effect: (ctx, _event, self) => respond(ctx, self),
        }),
      ],
    });
    const game = cardGame({ skills: [legacy] });
    const running = game.room.run('lifecycle', async (ctx) => {
      if (kind === 'revoke') {
        await game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: original });
        await game.skills.revoke(ctx, 'a', legacy.id, original);
      } else
        await withLifetime(ctx, 'borrowed', async (inside, lifetime) => {
          await game.skills.grant(inside, {
            owner: 'a',
            skill: legacy.id,
            source: original,
            lifetime,
          });
        });
    });
    expect((await answer(game)).kind).toBe('invoke');
    await running;
    expect(game.room.world.snapshot.skills).toHaveLength(0);
    expect(game.room.history.facts('probe.retained')).toHaveLength(1);
    expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
    rebuilt(game);
  },
);

it('retain 不自动保留所有离场效果；没有声明的旧技能候选不能执行', async () => {
  const legacy = defineSkill({
    id: 'probe:no-retain',
    name: '不保留',
    triggers: [
      on(Skill.changed, {
        locked: true,
        id: 'lost',
        when: (ctx, change, self) => skillLost(ctx.world, change.before, self),
        effect: (ctx) => {
          ctx.commit('probe.unexpected', [], null);
        },
      }),
    ],
  });
  const game = cardGame({ skills: [legacy] });
  await game.room.run('revoke', async (ctx) => {
    await game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: original });
    await game.skills.revoke(ctx, 'a', legacy.id, original);
  });
  expect(game.room.history.facts('probe.unexpected')).toHaveLength(0);
  rebuilt(game);
});

it('同一后效的子流程可支付真实手牌费用，外层/其他 Room 与关闭后的引用没有该资格', async () => {
  let outer: Context, captured: SkillHandle;
  const foreign = cardGame();
  const armor = lostArmor(async (ctx, self) => {
    captured = self;
    expect(self.active(outer)).toBe(false);
    await foreign.room.run('foreign', (at) => {
      expect(self.active(at)).toBe(false);
    });
    await ctx.flow('nested-cost', async (at) => {
      const paid = await pay(at, {
        skill: self,
        cards: ['fee'],
        to: 'discard',
        reason: self.skill,
      });
      expect(paid.kind).toBe('paid');
    });
  });
  const game = cardGame({
    hands: { a: [card('fee', 'jink')] },
    equipment: { a: [{ ...card('armor', 'slash'), name: armor.id }] },
    definitions: [armor],
  });
  await game.room.run('loss', async (ctx) => {
    outer = ctx;
    await moveCards(
      ctx,
      [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
      'loss',
    );
    expect(captured.active(ctx)).toBe(false);
    await equip(ctx, game.book, { card: 'armor', owner: 'a', from: 'discard' });
    expect(captured.active(ctx)).toBe(false);
    expect(game.skills.binding(ctx.world, captured.id)!.self.active(ctx)).toBe(true);
    expect(
      (
        await pay(ctx, {
          skill: captured,
          cards: [],
          to: 'discard',
          reason: 'escaped',
        })
      ).kind,
    ).toBe('unavailable');
  });
  expect(game.room.world.position('fee')).toBe('discard');
  expect(game.room.history.facts('cost.paid')).toHaveLength(1);
  rebuilt(game);
});

it.each([false, true])('死亡来源的普通 invoke 必须明确 retain，值为 %s', async (allowDead) => {
  const legacy = defineSkill({
    id: 'probe:death',
    name: '遗言',
    triggers: [
      on(Death.committed, {
        locked: true,
        id: 'legacy',
        ...(allowDead ? { retain: () => true } : {}),
        when: (_ctx, event, self) => event.player === self.owner,
        async effect(ctx, _event, self) {
          if (await invoke(ctx, self, '是否留下遗言？'))
            ctx.commit('probe.last-word', [], { owner: self.owner });
        },
      }),
    ],
  });
  const game = cardGame({ skills: [legacy] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: original }),
  );
  const running = game.room.run('death', (ctx) =>
    kill(ctx, { player: 'a', killer: null, reason: 'rule', cause: death }),
  );
  if (allowDead) expect((await answer(game)).kind).toBe('invoke');
  await running;
  expect(game.room.history.facts('probe.last-word')).toHaveLength(allowDead ? 1 : 0);
  expect(game.room.world.player('a').alive).toBe(false);
  rebuilt(game);
});

it('失效不是技能失去，部分撤销也不重复发动；最后一个有效授予失去才可保留', async () => {
  const legacy = defineSkill({
    id: 'probe:partial',
    name: '遗响',
    triggers: [
      on(Skill.changed, {
        locked: true,
        id: 'lost',
        retain: (ctx, change, self) => skillLost(ctx.world, change.before, self),
        when: (ctx, change, self) => skillLost(ctx.world, change.before, self),
        effect: (ctx) => {
          ctx.commit('probe.retained', [], null);
        },
      }),
    ],
  });
  const game = cardGame({ skills: [legacy] });
  await game.room.run('sources', async (ctx) => {
    await game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: original });
    await game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: additional });
    await game.skills.setEnabled(ctx, 'a', legacy.id, original, false);
    await game.skills.setEnabled(ctx, 'a', legacy.id, original, true);
    await game.skills.revoke(ctx, 'a', legacy.id, original);
    expect(game.room.history.facts('probe.retained')).toHaveLength(0);
    await game.skills.revoke(ctx, 'a', legacy.id, additional);
  });
  expect(game.room.history.facts('probe.retained')).toHaveLength(1);
  rebuilt(game);
});

it('当前失效仍能阻止历史来源', async () => {
  const armor = lostArmor((ctx) => {
    ctx.commit('probe.unexpected', [], null);
  });
  const game = cardGame({
    hands: { a: [] },
    equipment: { a: [{ ...card('armor', 'slash'), name: armor.id }] },
    definitions: [armor],
  });
  await game.room.run('blocked', (ctx) =>
    withLifetime(ctx, 'silence', async (inside, lifetime) => {
      const binding = game.skills
        .bindings(inside.world)
        .find(({ self }) => self.origin?.id === 'armor')!;
      blockSkill(inside, binding.self, lifetime);
      await moveCards(
        inside,
        [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
        'loss',
      );
    }),
  );
  expect(game.room.history.facts('probe.unexpected')).toHaveLength(0);
  rebuilt(game);
});

for (const [window, group] of [
  [Death.buried, 'main'],
  [Death.finished, 'after'],
] as const) {
  it(`${window.id} 使用实际埋葬前的技能快照，死亡后新授予也能明确保留并自愿发动`, async () => {
    const legacy = defineSkill({
      id: 'probe:buried',
      name: '遗言',
      triggers: [
        on(window, {
          locked: true,
          id: 'legacy',
          group,
          retain: (ctx, event, self) =>
            event.burial.skillsBefore.some((old) => skillLost(ctx.world, old, self)),
          when: (ctx, event, self) =>
            event.burial.skillsBefore.some((old) => skillLost(ctx.world, old, self)),
          async effect(ctx, event, self) {
            expect(event.skillsBefore).toHaveLength(0);
            expect(event.burial.skillsBefore).toHaveLength(1);
            if (await invoke(ctx, self, '是否留下遗言？'))
              ctx.commit('probe.buried', [], { instance: self.id });
          },
        }),
      ],
    });
    const game = cardGame({ skills: [legacy] });
    game.room.on(Death.committed, {
      id: 'late-grant',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        await game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: additional });
      },
    });
    const running = game.room.run('death', (ctx) =>
      kill(ctx, { player: 'a', killer: null, reason: 'rule', cause: death }),
    );
    await answer(game);
    await running;
    expect(game.room.history.facts('player.died')[0]?.data.detail).toMatchObject({
      skillsBefore: [],
    });
    expect(game.room.history.facts('player.buried')[0]?.data.detail).toMatchObject({
      burial: { skillsBefore: [{ skill: legacy.id }] },
    });
    expect(game.room.history.facts('probe.buried')).toHaveLength(1);
    expect(game.room.world.snapshot.skills).toHaveLength(0);
    rebuilt(game);
  });
}

it('已开始后效不重新套用 when；普通支付只重查来源与调用者明确的费用条件', async () => {
  let started = false;
  const window = testTiming<null>('probe.once-started');
  const skill = defineSkill({
    id: 'probe:once-started',
    name: '起点',
    triggers: [
      on(window, {
        locked: true,
        id: 'start',
        when: () => !started,
        async effect(ctx, _event, self) {
          started = true;
          if (await invoke(ctx, self, '是否继续已开始的后效？'))
            ctx.commit('probe.started', [], null);
        },
      }),
    ],
  });
  const game = cardGame({ skills: [skill] });
  const running = game.room.run('event', async (ctx) => {
    await game.skills.grant(ctx, { owner: 'a', skill: skill.id, source: original });
    await ctx.window(window, null);
  });
  await answer(game);
  await running;
  expect(game.room.history.facts('probe.started')).toHaveLength(1);
  rebuilt(game);
});

it('后效执行中被明确失效会停止后续支付，不回滚已经完成的发动宣告', async () => {
  const armor = lostArmor(async (ctx, self) => {
    expect(await invoke(ctx, self, '是否发动？')).toBe(true);
    await withLifetime(ctx, 'block-later-payment', async (at, lifetime) => {
      blockSkill(at, self, lifetime);
      expect(self.active(at)).toBe(false);
      expect(
        (
          await pay(at, {
            skill: self,
            cards: ['fee'],
            to: 'discard',
            reason: 'later',
          })
        ).kind,
      ).toBe('unavailable');
    });
  });
  const game = cardGame({
    hands: { a: [card('fee', 'jink')] },
    equipment: { a: [{ ...card('armor', 'slash'), name: armor.id }] },
    definitions: [armor],
  });
  const running = game.room.run('loss', (ctx) =>
    moveCards(
      ctx,
      [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
      'loss',
    ),
  );
  await answer(game);
  await running;
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  expect(game.room.world.position('fee')).toBe('a:hand');
  rebuilt(game);
});

it.each(['abort', 'fault'] as const)(
  '后效 %s 也关闭历史引用，不能在另一个 Room 重新支付',
  async (exit) => {
    let captured: SkillHandle;
    let capturedAt: Context;
    const armor = lostArmor((ctx, self) => {
      captured = self;
      capturedAt = ctx;
      if (exit === 'abort') ctx.abort('local');
      throw new Error('probe fault');
    });
    const game = cardGame({
      hands: { a: [] },
      equipment: { a: [{ ...card('armor', 'slash'), name: armor.id }] },
      definitions: [armor],
    });
    const running = game.room.run('loss', (ctx) =>
      moveCards(
        ctx,
        [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
        'loss',
      ),
    );
    if (exit === 'fault') await expect(running).rejects.toThrow('probe fault');
    else await running;
    expect(captured!.active(capturedAt!)).toBe(false);
    const foreign = cardGame();
    await foreign.room.run('foreign', (ctx) => {
      expect(captured.active(ctx)).toBe(false);
    });
  },
);

it('retain 和新的 available 都是纯查询，不允许它们提交状态', async () => {
  const window = testTiming<null>('probe.impure-retain');
  const legacy = defineSkill({
    id: 'probe:impure',
    name: '错误来源',
    triggers: [
      on(Skill.changed, {
        locked: true,
        id: 'lost',
        retain(ctx) {
          ctx.commit('probe.unexpected', [], null);
          return true;
        },
        effect: () => {},
      }),
    ],
  });
  const game = cardGame({ skills: [legacy] });
  await expect(
    game.room.run('impure', async (ctx) => {
      await game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: original });
      await game.skills.revoke(ctx, 'a', legacy.id, original);
    }),
  ).rejects.toThrow(/quer/i);
  expect(game.room.history.facts('probe.unexpected')).toHaveLength(0);
  const other = cardGame();
  await expect(
    other.room.run('impure-available', async (ctx) => {
      const self: SkillHandle = {
        id: 'invalid',
        owner: 'a',
        skill: 'probe:bad',
        name: '错误资格',
        origin: null,
        active(at) {
          at.commit(window.id, [], null);
          return true;
        },
      };
      await pay(ctx, { skill: self, cards: [], to: 'discard', reason: 'bad' });
    }),
  ).rejects.toThrow(/quer/i);
  expect(other.room.history.facts(window.id)).toHaveLength(0);
});

it('每个 occurrence 有独立的后效资格，拒绝第一次不吞掉第二次', async () => {
  let first: SkillHandle | null = null;
  const armor = equipmentCard({
    id: 'probe:twice',
    label: '双响',
    slot: 'armor',
    skill: defineSkill({
      id: 'probe:twice-ability',
      name: '双响',
      triggers: [
        on(Cards.moved, {
          locked: true,
          id: 'lost',
          times: () => 2,
          retain: (ctx, moved, self) => equipmentLost(ctx.world, moved, self),
          when: (ctx, moved, self) => equipmentLost(ctx.world, moved, self),
          async effect(ctx, _event, self, _value, occurrence) {
            if (first) expect(first.active(ctx)).toBe(false);
            first ??= self;
            if (await invoke(ctx, self, `第${occurrence.index}次？`))
              ctx.commit('probe.occurrence', [], { index: occurrence.index });
          },
        }),
      ],
    }),
  });
  const game = cardGame({
    hands: { a: [] },
    equipment: { a: [{ ...card('armor', 'slash'), name: armor.id }] },
    definitions: [armor],
  });
  const running = game.room.run('loss', (ctx) =>
    moveCards(
      ctx,
      [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
      'loss',
    ),
  );
  await answer(game, false);
  await answer(game, true);
  await running;
  expect(game.room.history.facts('probe.occurrence')[0]?.data.detail).toEqual({ index: 2 });
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  rebuilt(game);
});

it('自定义窗口显式提供技能快照；目录不读取任意历史，登记在挂接后封口', async () => {
  const window = testTiming<{ readonly before: readonly SkillInstance[] }>('probe.snapshot');
  const legacy = defineSkill({
    id: 'probe:custom',
    name: '旧来源',
    triggers: [
      on(window, {
        locked: true,
        id: 'retained',
        retain: (ctx, event, self) => event.before.some((old) => skillLost(ctx.world, old, self)),
        when: (ctx, event, self) => event.before.some((old) => skillLost(ctx.world, old, self)),
        async effect(ctx, _event, self) {
          if (await invoke(ctx, self, '是否发动旧来源？')) ctx.commit('probe.custom', [], null);
        },
      }),
    ],
  });
  const game = cardGame({
    skills: [legacy],
    setup: (book) => {
      book.skills.registerSnapshots(window, (event) => event.before);
      expect(() => book.skills.registerSnapshots(window, (event) => event.before)).toThrow(
        'Duplicate',
      );
    },
  });
  expect(() => game.skills.registerSnapshots(window, () => [])).toThrow('sealed');
  let before: readonly SkillInstance[];
  const running = game.room.run('custom', async (ctx) => {
    await game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: original });
    before = ctx.world.snapshot.skills;
    await game.skills.revoke(ctx, 'a', legacy.id, original);
    expect(game.skills.bindings(ctx.world)).toHaveLength(0);
    await ctx.window(window, { before }, { subject: 'a' });
  });
  await answer(game);
  await running;
  expect(game.room.history.facts('probe.custom')).toHaveLength(1);
  rebuilt(game);
});

it.each(['invalid-array', 'conflicting-owner'] as const)(
  '历史快照的 %s 在执行效果前报作者错误',
  async (kind) => {
    const window = testTiming<{ readonly before: readonly SkillInstance[] }>('probe.bad-snapshot');
    const legacy = defineSkill({
      id: 'probe:snapshot-error',
      name: '快照错误',
      triggers: [
        on(window, {
          locked: true,
          id: 'effect',
          effect: (ctx) => {
            ctx.commit('probe.unexpected', [], null);
          },
        }),
      ],
    });
    const game = cardGame({
      skills: [legacy],
      setup: (book) => {
        book.skills.registerSnapshots(window, (event) =>
          kind === 'invalid-array'
            ? (undefined as unknown as readonly SkillInstance[])
            : event.before.map((skill) => ({ ...skill, owner: 'b' })),
        );
      },
    });
    await expect(
      game.room.run('event', async (ctx) => {
        await game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: original });
        await ctx.window(window, { before: ctx.world.snapshot.skills });
      }),
    ).rejects.toThrow(kind === 'invalid-array' ? /array/ : /Conflicting/);
    expect(game.room.history.facts('probe.unexpected')).toHaveLength(0);
  },
);

it('同一历史身份重复出现在自定义快照中，不复制发动次数', async () => {
  const window = testTiming<{ readonly before: readonly SkillInstance[] }>(
    'probe.duplicate-snapshot',
  );
  const legacy = defineSkill({
    id: 'probe:deduplicated',
    name: '同一来源',
    triggers: [
      on(window, {
        locked: true,
        id: 'lost',
        retain: (ctx, event, self) => event.before.some((old) => skillLost(ctx.world, old, self)),
        when: (ctx, event, self) => event.before.some((old) => skillLost(ctx.world, old, self)),
        async effect(ctx, _event, self) {
          await invoke(ctx, self, '只应询问一次');
        },
      }),
    ],
  });
  const game = cardGame({
    skills: [legacy],
    setup: (book) => {
      book.skills.registerSnapshots(window, (event) => [...event.before, ...event.before]);
    },
  });
  const running = game.room.run('event', async (ctx) => {
    await game.skills.grant(ctx, { owner: 'a', skill: legacy.id, source: original });
    const before = ctx.world.snapshot.skills;
    await game.skills.revoke(ctx, 'a', legacy.id, original);
    await ctx.window(window, { before });
  });
  await answer(game);
  await running;
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  rebuilt(game);
});

it('历史来源的支付资格不恢复转换、查询修正或主动技能', async () => {
  let phase: PhaseView;
  const armor = equipmentCard({
    id: 'probe:many-abilities',
    label: '来源隔离',
    slot: 'armor',
    skill: defineSkill({
      id: 'probe:many-abilities',
      name: '来源隔离',
      viewAs: [
        viewAs({
          id: 'slash',
          label: '转换杀',
          names: () => ['standard:slash'],
          count: { min: 1, max: 1 },
          materials: (ctx, { self }) => ownedCards(ctx.world, self.owner),
          make: () => ({ name: 'standard:slash' }),
        }),
      ],
      modifiers: [modify(cardQueries.handLimitCorrection, () => 2)],
      active: [{ id: 'active', label: '主动', available: () => true, run: () => {} }],
      triggers: [
        on(Cards.moved, {
          locked: true,
          id: 'lost',
          retain: (ctx, event, self) => equipmentLost(ctx.world, event, self),
          when: (ctx, event, self) => equipmentLost(ctx.world, event, self),
          async effect(ctx, _event, self) {
            expect(self.active(ctx)).toBe(true);
            expect(game.book.handLimit(ctx, 'a')).toBe(4);
            expect(activeOffers(ctx, game.book, phase)).toHaveLength(0);
            expect(
              game.book.build(
                ctx,
                'a',
                {
                  kind: 'viewAs',
                  instance: self.id,
                  recipe: 'slash',
                  materials: ['fee'],
                },
                'use',
              ).ok,
            ).toBe(false);
            expect(await invoke(ctx, self, '仍然可以发动离场后效？')).toBe(true);
          },
        }),
      ],
    }),
  });
  const game = cardGame({
    hands: { a: [card('fee', 'jink')] },
    equipment: { a: [{ ...card('armor', 'slash'), name: armor.id }] },
    definitions: [armor],
  });
  const running = game.room.run('phase', (ctx) =>
    runPhase(ctx, game.book, 'a', 'play', async (at, current) => {
      phase = current;
      expect(game.book.handLimit(at, 'a')).toBe(6);
      expect(activeOffers(at, game.book, current)).toHaveLength(1);
      await moveCards(
        at,
        [{ cards: ['armor'], from: 'a:equipment', to: 'discard', place: 'bottom' }],
        'loss',
      );
    }),
  );
  await answer(game);
  await running;
  rebuilt(game);
});

it('普通 class 提供的来源保留 this 与原型方法，不依赖对象展开复制方法', async () => {
  const window = testTiming<null>('probe.class-source');
  class Source implements SkillHandle {
    readonly id = 'class-source';
    readonly owner = 'a';
    readonly skill = 'probe:class';
    readonly name = '普通类';
    readonly origin = null;
    #owner = 'a';
    active(ctx: Context) {
      return ctx.world.player(this.#owner).alive;
    }
  }
  const definition = defineSkill({
    id: 'probe:class',
    name: '普通类',
    triggers: [
      on(window, {
        locked: true,
        id: 'run',
        async effect(ctx, _event, self) {
          if (await invoke(ctx, self, '普通类来源？')) ctx.commit('probe.class', [], null);
        },
      }),
    ],
  });
  const game = cardGame({
    skills: [],
    setup: (book) => {
      book.skills.addProvider({ collect: () => [{ self: new Source(), definition }] });
    },
  });
  const running = game.room.run('event', (ctx) => ctx.window(window, null));
  await answer(game);
  await running;
  expect(game.room.history.facts('probe.class')).toHaveLength(1);
  rebuilt(game);
});

it.each([false, true])('作者包用真实发牌的遗玉/八卦替换，是否发动为 %s', async (accept) => {
  const content = practiceContent;
  const match = createOfflineMatch({
    seed: 10,
    preset: 'workshop:relics',
    lineup: ['workshop:guest', 'standard:guanyu'],
    content,
  });
  await match.prepare();
  expect(match.progress?.next).toBe('甲席');
  const before = match.room.world.zone('甲席:hand').cards.length;
  expect(match.room.world.position('relic-card-2')).toBe('甲席:hand');
  expect(match.room.world.position('relic-card-14')).toBe('甲席:hand');
  const running = match.room.run('replacement', async (ctx) => {
    for (const card of ['relic-card-2', 'relic-card-14'])
      expect(
        (
          await match.book.use(ctx, {
            actor: '甲席',
            choice: { kind: 'physical', card },
            targets: [],
            timing: { kind: 'effect' },
          })
        ).kind,
      ).toBe('used');
  });
  const request = await nextRequest(match.room);
  expect(request.kind).toBe('invoke');
  expect(request.prompt).toContain('玉碎');
  expect(match.room.decisions.submit(request.id, request.token, accept)).toEqual({
    kind: 'accepted',
  });
  await running;
  expect(match.room.world.zone('甲席:hand').cards).toHaveLength(before - 2 + Number(accept));
  expect(match.room.world.position('relic-card-2')).toBe('discard');
  expect(match.room.world.position('relic-card-14')).toBe('甲席:equipment');
  expect(match.room.history.facts('skill.invoked')).toHaveLength(Number(accept));
  if (accept)
    expect(match.room.history.facts('skill.invoked')[0]?.data.detail).toMatchObject({
      skill: 'workshop:jade-echo',
      instance: JSON.stringify(['equipment', '甲席', 'relic-card-2']),
    });
  expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
    match.room.world.snapshot,
  );
});
