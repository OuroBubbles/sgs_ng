import { expect, it } from 'vitest';
import {
  damage,
  recover,
  loseHp,
  installRescue,
  isDying,
  kill,
  moveCards,
  defineSkill,
  on,
  viewAs,
  ownedCards,
  finishGame,
  installRoleMode,
  Target,
  Use,
  Cards,
  Damage,
  Dying,
  Death,
  Hp,
} from '../../src/sdk';
import type { DeathDraft, DyingResult } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { card, cardGame, use } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';

const cause = { kind: 'rule', seq: null, data: null } as const;
const hit = { from: 'a', to: 'b', amount: 4, nature: 'normal' } as const;

it('濒死救援在受伤后之前完整结算；桃产生 card.used 而不是 card.responded', async () => {
  const game = cardGame({ hands: { a: [card('p', 'peach', 'heart')], b: [] } });
  installRescue(game.room, game.book);
  const order: string[] = [];
  game.room.on(Hp.recovered, {
    id: 'heal',
    owner: null,
    eligible: () => true,
    run: () => {
      order.push('heal');
    },
  });
  game.room.on(Dying.finished, {
    id: 'dying-cleared',
    owner: null,
    eligible: () => true,
    run: (ctx) => {
      expect(isDying(ctx.world, 'b')).toBe(false);
    },
  });
  game.room.on(Damage.received, {
    id: 'after',
    owner: null,
    eligible: () => true,
    run: (ctx) => {
      expect(ctx.world.player('b')).toMatchObject({ hp: 1, alive: true });
      expect(isDying(ctx.world, 'b')).toBe(false);
      order.push('after');
    },
  });
  const running = game.room.run('hit', (ctx) => damage(ctx, hit));
  const request = await nextRequest(game.room);
  expect(request).toMatchObject({
    player: 'a',
    kind: 'use-card',
    data: { timing: 'rescue', targets: ['b'] },
  });
  expect(game.room.world.player('b')).toMatchObject({ hp: 0, alive: true });
  expect(isDying(game.room.world, 'b')).toBe(true);
  expect(
    game.room.decisions.submit(request.id, request.token, {
      kind: 'generated',
      face: { name: 'standard:peach' },
      materials: [],
      reason: 'cheat',
    }).kind,
  ).toBe('rejected');
  game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: 'p' });
  expect(await running).toMatchObject({ value: { kind: 'dealt', afterHp: 0 } });
  expect(order).toEqual(['heal', 'after']);
  expect(game.room.history.facts('card.used')).toHaveLength(1);
  expect(game.room.history.facts('card.responded')).toEqual([]);
  expect(game.room.world.position('p')).toBe('discard');
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('负体力允许同一救援者连续用桃，放弃后按座次交给下一人', async () => {
  const game = cardGame({
    hands: {
      a: [],
      b: [card('own', 'peach')],
      c: [card('c1', 'peach'), card('c2', 'peach')],
      d: [card('d1', 'peach')],
    },
  });
  installRescue(game.room, game.book);
  const running = game.room.run('hit', (ctx) => damage(ctx, { ...hit, amount: 6 }));
  let request = await nextRequest(game.room);
  expect(request.player).toBe('b');
  game.room.decisions.cancel(request.id, request.token);
  for (const id of ['c1', 'c2', 'd1']) {
    request = await nextRequest(game.room);
    expect(request.player).toBe(id === 'd1' ? 'd' : 'c');
    game.room.decisions.submit(request.id, request.token, { kind: 'physical', card: id });
  }
  await running;
  expect(game.room.world.player('b')).toMatchObject({ hp: 1, alive: true });
  expect(game.room.world.zone('b:hand').cards).toEqual(['own']);
  expect(game.room.history.facts('card.used')).toHaveLength(3);
  expect(game.room.world.snapshot.zones.filter((zone) => zone.kind === 'processing')).toEqual([]);
});

it('救援能使用作者转换配方，并统一检查用牌禁止', async () => {
  const medicine = defineSkill({
    id: 'probe:medicine',
    name: '药',
    triggers: [],
    viewAs: [
      viewAs({
        id: 'peach',
        label: '转桃',
        names: () => ['standard:peach'],
        materials: (ctx, { self }) => ownedCards(ctx.world, self.owner),
        count: { min: 1, max: 1 },
        make: () => ({ name: 'standard:peach' }),
      }),
    ],
  });
  const game = cardGame({ hands: { a: [card('j', 'jink')], b: [] }, skills: [medicine] });
  installRescue(game.room, game.book);
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, {
      owner: 'a',
      skill: medicine.id,
      source: { kind: 'general', id: 'a' },
    }),
  );
  const instance = game.room.world.snapshot.skills[0]!.id;
  const running = game.room.run('hit', (ctx) => damage(ctx, hit));
  const request = await nextRequest(game.room);
  game.room.decisions.submit(request.id, request.token, {
    kind: 'viewAs',
    instance,
    recipe: 'peach',
    materials: ['j'],
  });
  await running;
  expect(game.room.world.player('b').hp).toBe(1);
  expect(game.room.world.position('j')).toBe('discard');
  const prohibited = cardGame({
    hands: { a: [card('p', 'peach')], b: [] },
    policy: { prohibitUse: () => true },
  });
  installRescue(prohibited.room, prohibited.book);
  await prohibited.room.run('hit', (ctx) => damage(ctx, hit));
  expect(prohibited.room.world.player('b').alive).toBe(false);
  expect(prohibited.room.world.position('p')).toBe('a:hand');
});

it('无救援时先开放死亡效果，再埋葬剩余所属区域和技能；死亡时牌和技能快照仍可读取', async () => {
  const order: string[] = [];
  const legacy = defineSkill({
    id: 'probe:legacy',
    name: '遗赠',
    triggers: [
      on(Death.committed, {
        locked: true,
        id: 'gift',
        retain: () => true,
        when: (_ctx, event, self) => event.player === self.owner,
        async effect(ctx, event) {
          expect(event.zonesBefore.find((zone) => zone.id === 'b:hand')?.cards).toEqual([
            'gift',
            'rest',
          ]);
          expect(event.skillsBefore).toHaveLength(1);
          order.push('legacy');
          await moveCards(
            ctx,
            [{ cards: ['gift'], from: 'b:hand', to: 'c:hand', place: 'bottom' }],
            'legacy',
          );
        },
      }),
    ],
  });
  const game = cardGame({
    hands: { a: [], b: [card('gift', 'slash'), card('rest', 'jink')] },
    equipment: { b: [card('equip', 'slash')] },
    skills: [legacy],
  });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'b', skill: legacy.id, source: { kind: 'general', id: 'b' } }),
  );
  game.room.on(Death.buried, {
    id: 'buried',
    owner: null,
    eligible: () => true,
    run: (ctx) => {
      order.push('buried');
      expect(ctx.world.snapshot.skills.filter((skill) => skill.owner === 'b')).toEqual([]);
      expect(ctx.world.zone('b:hand').cards).toEqual([]);
    },
  });
  game.room.on(Cards.moved, {
    id: 'burial-is-atomic',
    owner: null,
    eligible: (_ctx, event) => event.moves.some((move) => move.from === 'b:equipment'),
    run: (ctx) => {
      expect(ctx.world.snapshot.skills).toEqual([]);
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(order).toEqual(['legacy', 'buried']);
  expect(game.room.world.position('gift')).toBe('c:hand');
  expect(game.room.world.zone('discard').cards).toEqual(['rest', 'equip']);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('死亡前防止与濒死末尾回复均可阻止死亡，关闭后的草案不可修改', async () => {
  const game = cardGame({ hands: { a: [] } });
  let draft: DeathDraft | undefined;
  game.room.on(Death.before, {
    id: 'prevent',
    owner: null,
    eligible: () => true,
    run: (_ctx, current) => {
      draft = current;
      current.prevent('probe');
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(game.room.world.player('b')).toMatchObject({ hp: 0, alive: true });
  expect(game.room.history.facts('player.died')).toEqual([]);
  expect(isDying(game.room.world, 'b')).toBe(false);
  expect(() => draft?.prevent('late')).toThrow();
  const saved = cardGame({ hands: { a: [] } });
  saved.room.on(Dying.finishing, {
    id: 'last-heal',
    owner: null,
    eligible: () => true,
    async run(ctx, event) {
      await recover(ctx, { from: null, to: event.player, amount: 1 });
    },
  });
  await saved.room.run('hit', (ctx) => damage(ctx, hit));
  expect(saved.room.world.player('b')).toMatchObject({ hp: 1, alive: true });
  expect(saved.room.history.facts('player.died')).toEqual([]);
});

it('同角色嵌套濒死的内层退出不清掉外层身份；内层救回后外层不重复求桃', async () => {
  const game = cardGame({ hands: { a: [] } });
  let nested = false;
  const finished: DyingResult[] = [];
  game.room.on(Dying.started, {
    id: 'nested-loss',
    owner: null,
    eligible: () => !nested,
    async run(ctx) {
      nested = true;
      await loseHp(ctx, { player: 'b', amount: 1, reason: 'nested' });
      expect(ctx.world.player('b').hp).toBe(1);
      expect(isDying(ctx.world, 'b')).toBe(true);
    },
  });
  game.room.on(Dying.finishing, {
    id: 'inner-heal',
    owner: null,
    eligible: (ctx) => ctx.world.player('b').hp <= 0,
    async run(ctx) {
      await recover(ctx, { from: null, to: 'b', amount: 2 });
    },
  });
  game.room.on(Dying.finished, {
    id: 'record',
    owner: null,
    eligible: () => true,
    run: (_ctx, result) => {
      finished.push(result);
    },
  });
  await game.room.run('hit', (ctx) => damage(ctx, hit));
  expect(finished.map((event) => event.kind)).toEqual(['rescued', 'rescued']);
  expect(new Set(finished.map((event) => event.event.id)).size).toBe(2);
  expect(isDying(game.room.world, 'b')).toBe(false);
});

it('失去体力独立于伤害，可进入濒死；没有伤害来源或伤害后窗口', async () => {
  const game = cardGame({ hands: { a: [] } });
  const seen: string[] = [];
  game.room.on(Damage.dealt, {
    id: 'damage',
    owner: null,
    eligible: () => true,
    run: () => {
      seen.push('damage');
    },
  });
  game.room.on(Hp.lost, {
    id: 'loss',
    owner: null,
    eligible: () => true,
    run: () => {
      seen.push('loss');
    },
  });
  game.room.on(Death.committed, {
    id: 'cause',
    owner: null,
    eligible: () => true,
    run: (_ctx, event) => {
      expect(event).toMatchObject({ killer: null, cause: { kind: 'hp-loss' } });
    },
  });
  await game.room.run('loss', (ctx) => loseHp(ctx, { player: 'b', amount: 4, reason: 'cost' }));
  expect(seen).toEqual(['loss']);
  expect(game.room.world.player('b').alive).toBe(false);
  expect(game.room.history.facts('damage.dealt')).toEqual([]);
});

it('已宣告牌的来源死亡不会移走处理材料或取消已产生效果', async () => {
  const game = cardGame({ hands: { a: [card('s', 'slash'), card('left', 'jink')], b: [] } });
  game.room.on(Target.confirming, {
    id: 'source-dies',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await kill(ctx, { player: 'a', killer: null, cause, reason: 'rule' });
      expect(ctx.world.zone('a:hand').cards).toEqual([]);
      expect(ctx.world.zone('discard').cards).toEqual(['left']);
      expect(ctx.world.zone(ctx.world.position('s')).kind).toBe('processing');
    },
  });
  await use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 's' },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  expect(game.room.world.player('a').alive).toBe(false);
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.zone('discard').cards).toEqual(['left', 's']);
});

it('濒死中确定终局后不再求桃/死亡/伤害后效，仍完整收束用牌处理区', async () => {
  const game = cardGame({ hands: { a: [card('s', 'slash')], b: [] } });
  installRescue(game.room, game.book);
  installRoleMode(game.room);
  await game.room.run('setup', (ctx) => {
    ctx.commit('setup', [{ kind: 'vitality', player: 'b', hp: 1 }], null);
  });
  let finished: DyingResult | undefined;
  game.room.on(Dying.started, {
    id: 'terminal',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await finishGame(ctx, { winners: ['a'], reason: 'probe' });
    },
  });
  game.room.on(Dying.finished, {
    id: 'result',
    owner: null,
    eligible: () => true,
    run: (_ctx, result) => {
      finished = result;
    },
  });
  game.room.on(Damage.received, {
    id: 'no-after',
    owner: null,
    eligible: () => true,
    run: () => {
      throw new Error('Unexpected damage aftermath.');
    },
  });
  let useClosed = false;
  game.room.on(Use.finished, {
    id: 'use-closes',
    owner: null,
    eligible: () => true,
    run: () => {
      useClosed = true;
    },
  });
  await use(game, {
    actor: 'a',
    choice: { kind: 'physical', card: 's' },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  expect(finished?.kind).toBe('unavailable');
  expect(useClosed).toBe(true);
  expect(game.room.status).toBe('ended');
  expect(game.room.world.player('b')).toMatchObject({ hp: 0, alive: true });
  expect(game.room.world.position('s')).toBe('discard');
  expect(game.room.decisions.pending).toEqual([]);
  expect(isDying(game.room.world, 'b')).toBe(false);
});

it('死亡效果故障保留已提交死亡与未善后区域，不伪造完成/回滚', async () => {
  const game = cardGame({ hands: { a: [], b: [card('b', 'jink')] } });
  game.room.on(Death.committed, {
    id: 'fault',
    owner: null,
    eligible: () => true,
    run: () => {
      throw new Error('bad legacy');
    },
  });
  await expect(game.room.run('hit', (ctx) => damage(ctx, hit))).rejects.toThrow('bad legacy');
  expect(game.room.status).toBe('faulted');
  expect(game.room.world.player('b').alive).toBe(false);
  expect(game.room.world.position('b')).toBe('b:hand');
  expect(game.room.history.facts('player.buried')).toEqual([]);
});
