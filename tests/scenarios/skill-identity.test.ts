import { expect, it } from 'vitest';
import { ownedCards, Skill } from '../../src/sdk';
import { activeOffers, validateActive } from '../../src/rules/skills/active';
import { runPhase, runTurn } from '../../src/rules/turn/turn';
import { setGender } from '../../src/rules/characters/gender';
import { Cost } from '../../src/rules/costs/pay';
import type { Context, PhaseView } from '../../src/sdk';
import { standardGeneralSkills } from '../fixtures/standard';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, chooseAndActivate as activate } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { CardEvent } from '../../src/sdk';
import { testTiming } from '../fixtures/timing';

const original = { kind: 'general', id: 'original' } as const;
const additional = { kind: 'effect', id: 'additional' } as const;
const cases = [
  { name: '结姻', id: 'jieyin', action: 'discard-heal', cards: 2, targets: ['b'] },
  { name: '制衡', id: 'zhiheng', action: 'exchange', cards: 1, targets: [] },
  { name: '青囊', id: 'qingnang', action: 'discard-heal', cards: 1, targets: ['b'] },
  { name: '反间', id: 'fanjian', action: 'guess-suit', cards: 0, targets: ['b'] },
  { name: '离间', id: 'lijian', action: 'forced-duel', cards: 1, targets: ['b', 'c'] },
] as const;
type Scenario = (typeof cases)[number];
type Game = ReturnType<typeof cardGame>;

function scenario() {
  return cardGame({
    hands: {
      a: Array.from({ length: 8 }, (_, i) => card(`fee${i}`, 'jink', 'heart')),
      b: [],
    },
    draw: Array.from({ length: 12 }, (_, i) => card(`draw${i}`, 'jink', 'heart')),
    skills: standardGeneralSkills,
  });
}
async function prepare(game: Game, skill: string) {
  await game.room.run('prepare', async (ctx) => {
    setGender(ctx, 'a', 'female');
    setGender(ctx, 'b', 'male');
    setGender(ctx, 'c', 'male');
    setGender(ctx, 'd', 'male');
    ctx.commit(
      testTiming('fixture.wounds'),
      ['a', 'b', 'c'].map((player) => ({ kind: 'vitality', player, hp: 2 })),
      null,
    );
    await game.skills.grant(ctx, { owner: 'a', skill, source: original });
  });
}
function currentInstance(game: Game, skill: string) {
  return game.room.world.snapshot.skills.find(
    (entry) => entry.owner === 'a' && entry.skill === skill,
  )!.id;
}
async function resolveAction(game: Game, rule: Scenario) {
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('cards-targets');
  expect(request.player).toBe('a');
  const cards = game.room.world.zone('a:hand').cards.slice(0, rule.cards);
  expect(
    game.room.decisions.submit(request.id, request.token, { cards, targets: rule.targets }),
  ).toEqual({ kind: 'accepted' });
  if (rule.id !== 'fanjian') return;

  const guess = await nextRequest(game.room);
  expect(guess.kind).toBe('choose-option');
  expect(guess.player).toBe('b');
  expect(game.room.decisions.submit(guess.id, guess.token, 'heart')).toEqual({ kind: 'accepted' });
  const hidden = await nextRequest(game.room);
  expect(hidden.player).toBe('b');
  const option = (hidden.data as { preview: { cards: { id: string }[] } }).preview.cards[0]!.id;
  expect(
    game.room.decisions.submit(hidden.id, hidden.token, { cards: [option], targets: [] }),
  ).toEqual({ kind: 'accepted' });
}

for (const rule of cases) {
  for (const change of ['recreate', 'additional-source'] as const) {
    it(`${rule.name}支付后${change}不刷新本阶段次数；新阶段仍可再次发动且原后效完整结束`, async () => {
      const game = scenario();
      const skill = `standard:${rule.id}`;
      await prepare(game, skill);
      const firstInstance = currentInstance(game, skill);
      let replaced = false;
      game.room.on(Cost.paid, {
        id: 'change-source-after-payment',
        owner: null,
        eligible: (_ctx, receipt) => receipt.skill === skill && !replaced,
        async run(ctx) {
          replaced = true;
          if (change === 'recreate') {
            await game.skills.revoke(ctx, 'a', skill, original);
            await game.skills.grant(ctx, { owner: 'a', skill, source: original });
          } else {
            await game.skills.grant(ctx, { owner: 'a', skill, source: additional });
            await game.skills.revoke(ctx, 'a', skill, original);
          }
        },
      });

      let firstPhase: PhaseView;
      const first = game.room.run('first-phase', (ctx) =>
        runPhase(ctx, 'a', 'play', async (at, phase) => {
          firstPhase = phase;
          await activate(at, phase, { instance: firstInstance, action: rule.action });
          const current = currentInstance(game, skill);
          expect(current === firstInstance).toBe(change !== 'recreate');
          expect(activeOffers(at, phase).some((offer) => offer.skill === skill)).toBe(false);
          expect(
            validateActive(at, phase, {
              instance: current,
              action: rule.action,
              cards: ownedCards(at.world, 'a', ['hand', 'equipment']).slice(0, rule.cards),
              targets: rule.targets,
            }).ok,
          ).toBe(false);
          // 绕过菜单直接提交新实例也不能支付第二次；材料与目标仍足够。
          expect(ownedCards(at.world, 'a').length).toBeGreaterThanOrEqual(rule.cards);
          await activate(at, phase, { instance: current, action: rule.action });
        }),
      );
      await resolveAction(game, rule);
      expect(await first).toMatchObject({ kind: 'resolved' });
      expect(replaced).toBe(true);
      expect(game.room.history.facts(Skill.invoked)).toHaveLength(1);
      expect(game.room.history.facts(Skill.invoked)[0]?.data.detail).toMatchObject({
        skill,
        instance: firstInstance,
      });
      expect(game.room.decisions.pending).toEqual([]);

      const second = game.room.run('second-phase', (ctx) =>
        runPhase(ctx, 'a', 'play', async (at, phase) => {
          expect(phase.id).not.toBe(firstPhase.id);
          expect(activeOffers(at, phase).some((offer) => offer.skill === skill)).toBe(true);
          await activate(at, phase, {
            instance: currentInstance(game, skill),
            action: rule.action,
          });
        }),
      );
      await resolveAction(game, rule);
      expect(await second).toMatchObject({ kind: 'resolved' });
      expect(game.room.history.facts(Skill.invoked)).toHaveLength(2);
      if (rule.id === 'jieyin') {
        expect(game.room.world.player('a').hp).toBe(4);
        expect(game.room.world.player('b').hp).toBe(4);
      } else if (rule.id === 'qingnang') expect(game.room.world.player('b').hp).toBe(4);
      else if (rule.id === 'lijian') {
        expect(game.room.history.facts(CardEvent.used)).toHaveLength(2);
        // b 无杀；第二次伤害进入濒死并死亡，已声明决斗仍完整清理。
        expect(game.room.world.player('b').alive).toBe(false);
      } else if (rule.id === 'zhiheng') {
        expect(game.room.world.zone('draw').cards).toHaveLength(10);
        expect(game.room.world.zone('a:hand').cards).toHaveLength(8);
      } else expect(game.room.world.zone('b:hand').cards).toHaveLength(2);
      expect(game.room.world.snapshot.states.some((state) => state.key === 'core:use-count')).toBe(
        false,
      );
      expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
      expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(
        game.room.world.snapshot,
      );
    });
  }
}

it.each(cases)('$name嵌套同角色出牌阶段有独立次数，返回后外层额度不会被刷新', async (rule) => {
  const game = scenario();
  const skill = `standard:${rule.id}`;
  await prepare(game, skill);
  const instance = currentInstance(game, skill);
  const running = game.room.run('nested-phases', (ctx) =>
    runPhase(ctx, 'a', 'play', async (at, outer) => {
      await activate(at, outer, { instance: instance, action: rule.action });
      expect(activeOffers(at, outer).some((offer) => offer.skill === skill)).toBe(false);
      await runPhase(at, 'a', 'play', async (inside, inner) => {
        expect(inner.id).not.toBe(outer.id);
        expect(activeOffers(inside, inner).some((offer) => offer.skill === skill)).toBe(true);
        await activate(inside, inner, { instance: instance, action: rule.action });
      });
      expect(activeOffers(at, outer).some((offer) => offer.skill === skill)).toBe(false);
      await activate(at, outer, { instance: instance, action: rule.action });
    }),
  );
  await resolveAction(game, rule);
  await resolveAction(game, rule);
  expect(await running).toMatchObject({ kind: 'resolved' });
  expect(game.room.history.facts(Skill.invoked)).toHaveLength(2);
  await game.room.run('fresh-phase', (ctx) =>
    runPhase(ctx, 'a', 'play', (at, phase) => {
      // 即使离间已杀死 b，c/d 仍是合法男性组合；不是缺目标导致旧额度不可用。
      expect(activeOffers(at, phase).some((offer) => offer.skill === skill)).toBe(true);
    }),
  );
  expect(game.room.world.snapshot.states.some((state) => state.key === 'core:use-count')).toBe(
    false,
  );
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it.each([false, true])('授予/撤销技能以拥有者为事件主体，活动回合优先为 %s', async (inTurn) => {
  const game = scenario();
  const seen: string[] = [];
  for (const owner of ['a', 'b', 'c', 'd'])
    game.room.on(Skill.changed, {
      id: `changed:${owner}`,
      owner,
      eligible: () => true,
      run: () => {
        seen.push(owner);
      },
    });
  const body = async (ctx: Context) => {
    await game.skills.grant(ctx, { owner: 'c', skill: 'standard:kurou', source: original });
    await game.skills.revoke(ctx, 'c', 'standard:kurou', original);
  };
  await game.room.run('change', async (ctx) => {
    if (inTurn) await runTurn(ctx, 'b', { phases: ['play'], body: (at) => body(at) });
    else await body(ctx);
  });
  const order = inTurn ? ['b', 'c', 'd', 'a'] : ['c', 'd', 'a', 'b'];
  expect(seen).toEqual(Array.from({ length: 2 }, () => order).flat());
  const orders = game.room.history.entries.filter(
    (entry) =>
      entry.type === 'window.order' &&
      (entry.data as { window: string }).window === Skill.changed.id,
  );
  expect(orders.map((entry) => entry.data)).toEqual(
    Array.from({ length: 2 }, () => ({
      window: Skill.changed.id,
      subject: 'c',
      anchor: inTurn ? 'b' : 'c',
      override: false,
    })),
  );
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});
