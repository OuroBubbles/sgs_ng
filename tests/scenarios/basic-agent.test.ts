import { expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { Match, RoleMatch } from '../../src/host/role-match';
import { SoloSession } from '../../src/host/solo';
import { createRoleMatch } from '../../src/host/content';
import { observeAgent } from '../../src/host/agent-observation';
import { decideBasic } from '../../src/host/basic-agent';
import type { DecisionRequest } from '../../src/core/decisions/hub';
import { standardCards } from '../../src/content/standard/cards';
import { chooseOwnedCard, moveCards, Use, askUse, useCard } from '../../src/sdk';
import { nextRequest } from '../fixtures/room';
import type { Card, FlowResult } from '../../src/sdk';
import { card } from '../fixtures/cards';
import { playMatch } from '../fixtures/match';
import { testTiming } from '../fixtures/timing';

function fixture() {
  const match = new RoleMatch({
    id: 'solo-test',
    seed: 42,
    players: [{ id: 'a' }, { id: 'b' }],
    roles: ['lord', 'rebel'],
    content: {
      cards: standardCards,
    },
    deck: [
      card('slash', 'slash'),
      card('secret-b', 'jink'),
      ...Array.from({ length: 24 }, (_, i) => card(`deck-${i}`, 'jink')),
    ],
  });
  match.room.on(Match.prepared, {
    id: 'fixture',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await moveCards(
        ctx,
        ctx.world.snapshot.cards.map((card) => ({
          cards: [card.id],
          from: ctx.world.position(card.id),
          to: card.id === 'slash' ? 'a:hand' : card.id === 'secret-b' ? 'b:hand' : 'draw',
          place: 'bottom',
        })),
        'fixture',
      );
    },
  });
  return match;
}
const waitPlay = async (session: SoloSession) =>
  vi.waitFor(() => {
    expect(session.view.decision?.kind).toBe('play-action');
    return session.view.decision!;
  });

it('本人托管后拒绝旧输入，收回和暂停立即撤销未执行的 AI，交接不改变规则事实', async () => {
  const match = fixture();
  const session = new SoloSession(match, { human: 'a', aiDelayMs: 100 });
  try {
    session.start();
    const request = await waitPlay(session);
    const revision = match.room.world.snapshot.revision;
    const facts = match.room.history.facts().length;
    expect(session.setDelegated(true)).toEqual({ kind: 'accepted' });
    expect(session.view.control?.delegated).toBe(true);
    expect(session.view.decision).toBeNull();
    expect(session.cancel(request.id, request.token)).toMatchObject({ kind: 'rejected' });
    expect(session.setDelegated(false)).toEqual({ kind: 'accepted' });
    expect(session.view.decision?.id).toBe(request.id);
    session.setDelegated(true);
    session.hide();
    session.setDelegated(false);
    session.resume();
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(session.view.decision).toMatchObject({ id: request.id, token: request.token });
    expect(match.room.world.snapshot.revision).toBe(revision);
    expect(match.room.history.facts()).toHaveLength(facts);
    expect(session.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
  } finally {
    session.dispose();
  }
});

it('本人托管遇到未支持的必选请求时交还原决策，作者可以继续回答', async () => {
  const match = fixture();
  match.room.on(Match.prepared, {
    id: 'author-choice',
    owner: null,
    eligible: () => true,
    async run(ctx) {
      await ctx.ask({
        player: 'a',
        kind: 'manual-only',
        prompt: '作者请求',
        data: null,
        optional: false,
        validate: (input) =>
          input === 'manual'
            ? { ok: true, value: input }
            : { ok: false, reason: 'manual required' },
      });
    },
  });
  const session = new SoloSession(match, { human: 'a', aiDelayMs: 10 });
  try {
    session.start();
    await vi.waitFor(() => expect(session.view.decision?.kind).toBe('unsupported'));
    const request = session.view.decision!;
    session.setDelegated(true);
    await vi.waitFor(() => expect(session.view.control?.delegated).toBe(false));
    expect(session.view.error).toBe('');
    expect(session.view.control?.reason).toContain('manual-only');
    expect(session.view.decision).toMatchObject({ id: request.id, token: request.token });
    expect(session.answer(request.id, request.token, 'manual')).toEqual({ kind: 'accepted' });
  } finally {
    session.dispose();
  }
});

async function rigged(hands: Readonly<Record<string, readonly Card[]>>) {
  const match = new RoleMatch({
    id: 'agent-rules',
    seed: 42,
    content: {
      cards: standardCards,
    },
    players: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
    roles: ['lord', 'rebel', 'loyalist', 'renegade'],
    deck: Object.values(hands).flat(),
  });
  await match.prepare();
  await match.room.run('fixture', async (ctx) => {
    await moveCards(
      ctx,
      Object.entries(hands).flatMap(([owner, cards]) =>
        cards.map((card) => ({
          cards: [card.id],
          from: ctx.world.position(card.id),
          to: `${owner}:hand`,
          place: 'bottom' as const,
        })),
      ),
      'fixture',
    );
  });
  return match;
}
async function drive<T>(match: RoleMatch, flow: Promise<FlowResult<T>>) {
  let settled = false;
  const running = flow.finally(() => {
    settled = true;
  });
  try {
    for (let step = 0; !settled && step < 80; step++) {
      await setImmediate();
      const request = match.room.decisions.pending[0];
      if (!request) continue;
      const answer = decideBasic(observeAgent(match, request.player), request, (input) =>
        match.room.decisions.preview(request.id, input),
      );
      if (answer.kind === 'unsupported') throw new Error(answer.reason);
      expect(
        answer.kind === 'cancel'
          ? match.room.decisions.cancel(request.id, request.token)
          : match.room.decisions.submit(request.id, request.token, answer.value),
      ).toEqual({ kind: 'accepted' });
    }
    expect(settled).toBe(true);
    return await running;
  } finally {
    match.room.abort('done');
    await running;
  }
}

it('救援按本人身份与公开主公判断：不救敌方，保留的桃通过真实用牌救回主公', async () => {
  const match = await rigged({ c: [card('peach', 'peach', 'heart')] });
  const result = await drive(
    match,
    match.room.run('rescue-choice', async (ctx) => {
      ctx.commit(
        testTiming('dying-fixture'),
        [
          { kind: 'vitality', player: 'a', hp: 0 },
          { kind: 'vitality', player: 'b', hp: 0 },
        ],
        null,
      );
      const ask = (dying: string) =>
        askUse(ctx, {
          actor: 'c',
          names: ['standard:peach'],
          targets: [dying],
          timing: { kind: 'rescue', dying },
          prompt: '救援',
        });
      const enemy = await ask('b');
      expect(enemy).toMatchObject({ kind: 'declined' });
      expect(ctx.world.position('peach')).toBe('c:hand');
      return await ask('a');
    }),
  );
  expect(result).toMatchObject({
    kind: 'resolved',
    value: { kind: 'used' },
  });
  expect(match.room.world.player('a').hp).toBe(1);
  expect(match.room.world.player('b').hp).toBe(0);
  expect(match.room.world.position('peach')).toBe('discard');
});

it('连续三层无懈使用公开根效果和深度决策，支付三张牌并正确保护主公', async () => {
  const match = await rigged({
    a: [card('counter-a', 'nullification')],
    b: [card('duel', 'duel'), card('counter-b', 'nullification')],
    c: [card('counter-c', 'nullification')],
  });
  const depths: number[] = [];
  match.room.on(Use.declared, {
    id: 'depths',
    owner: null,
    eligible: (_ctx, use) => use.timing.kind === 'counter',
    run(_ctx, use) {
      if (use.timing.kind === 'counter') depths.push(use.timing.opportunity.depth);
    },
  });
  await drive(
    match,
    match.room.run(
      'duel',
      async (ctx) =>
        await useCard(ctx, {
          actor: 'b',
          choice: { kind: 'physical', card: 'duel' },
          targets: ['a'],
          timing: { kind: 'effect' },
        }),
    ),
  );
  expect(depths).toEqual([0, 1, 2]);
  expect(match.room.world.player('a').hp).toBe(4);
  for (const id of ['counter-a', 'counter-b', 'counter-c'])
    expect(match.room.world.position(id)).toBe('discard');
});

it('观察只含本人手牌与公开身份，交换其他席位的私有牌和身份不改变观察', async () => {
  const make = (swapped: boolean) =>
    new RoleMatch({
      id: 'knowledge',
      seed: 42,
      content: {
        cards: standardCards,
      },
      players: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
      roles: swapped
        ? ['rebel', 'lord', 'renegade', 'loyalist']
        : ['rebel', 'lord', 'loyalist', 'renegade'],
      deck: [
        card('mine', 'slash'),
        card('hidden-c', swapped ? 'peach' : 'jink'),
        card('hidden-d', 'duel'),
        card('secret-draw', 'slash'),
      ],
    });
  const observations = [];
  for (const swapped of [false, true]) {
    const match = make(swapped);
    await match.prepare();
    await match.room.run('fixture', async (ctx) => {
      await moveCards(
        ctx,
        ctx.world.snapshot.cards.map((card) => ({
          cards: [card.id],
          from: ctx.world.position(card.id),
          to:
            card.id === 'mine'
              ? 'a:hand'
              : card.id === 'hidden-c'
                ? 'c:hand'
                : card.id === 'hidden-d'
                  ? 'd:hand'
                  : 'draw',
          place: 'bottom',
        })),
        'fixture',
      );
    });
    observations.push(observeAgent(match, 'a'));
    match.room.abort('done');
  }
  expect(observations[0]).toEqual(observations[1]);
  expect(observations[0]!.players.map((player) => player.role)).toEqual([
    'rebel',
    'lord',
    null,
    null,
  ]);
  expect(JSON.stringify(observations[0])).not.toMatch(/hidden-c|hidden-d|secret-draw/);
});

it('默认单人控制固定视角；AI 自动出闪，私有响应不投影，不接受人类代答', async () => {
  const match = fixture();
  const session = new SoloSession(match, { human: 'a', aiDelayMs: 30 });
  const views: string[] = [];
  let observeResponse: (request: (typeof match.room.decisions.pending)[number]) => void = () => {};
  const aiReady = new Promise<(typeof match.room.decisions.pending)[number]>((resolve) => {
    observeResponse = resolve;
  });
  const off = session.subscribe((view) => {
    expect(view.handoff).toBeNull();
    expect(view.players.find((player) => player.self)?.id).toBe('a');
    if (view.viewer) expect(view.viewer).toBe('a');
    views.push(JSON.stringify(view));
    const pending = match.room.decisions.pending[0];
    if (view.automated === 'b' && pending?.kind === 'card-response') observeResponse(pending);
  });
  try {
    session.start();
    const request = await waitPlay(session);
    const offer = session.view.decision;
    expect(offer && 'offers' in offer).toBe(true);
    session.reply(request.id, request.token, {
      offer: offer && 'offers' in offer ? offer.offers.find((o) => o.cardId === 'slash')!.id : null,
      cards: [],
      targets: ['b'],
    });
    const aiRequest = await aiReady;
    expect(session.view.decision).toBeNull();
    expect(session.view.automated).toBe('b');
    expect(
      session.answer(aiRequest.id, aiRequest.token, { kind: 'physical', card: 'secret-b' }),
    ).toMatchObject({ kind: 'rejected', reason: 'closed' });
    await vi.waitFor(() => expect(match.room.world.position('secret-b')).toBe('discard'));
    expect(match.room.world.player('b').hp).toBe(4);
    expect(match.room.world.position('secret-b')).toBe('discard');
    // 公开响应使用展示 ID；私有手牌实体 ID 始终不出现在画面数据中。
    expect(views.join('')).not.toContain('secret-b');
    expect(session.view.log.some((line) => line.text.includes('b使用【闪】'))).toBe(true);
  } finally {
    off();
    session.dispose();
  }
});

it('暂停冻结 AI 请求并隐藏手牌；继续只回答一次，关闭会取消定时任务', async () => {
  const match = fixture();
  const session = new SoloSession(match, { human: 'a', aiDelayMs: 100 });
  try {
    session.start();
    const request = await waitPlay(session);
    session.cancel(request.id, request.token);
    await vi.waitFor(() => expect(session.view.automated).toBe('b'));
    session.hide();
    const key = match.room.decisions.pending[0]!.id;
    expect(session.view).toMatchObject({
      paused: true,
      viewer: null,
      hand: [],
      decision: null,
      handoff: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(match.room.decisions.pending[0]!.id).toBe(key);
    session.resume();
    await vi.waitFor(() => expect(match.room.decisions.pending[0]?.id).not.toBe(key));
    session.hide();
    session.dispose();
    const revision = match.room.world.snapshot.revision;
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(match.room.world.snapshot.revision).toBe(revision);
    expect(match.room.decisions.pending).toEqual([]);
  } finally {
    session.dispose();
  }
});

it('请求令牌在等待时失效，AI 重新读取请求而不提交旧草稿', async () => {
  const match = fixture();
  const session = new SoloSession(match, { human: 'a', aiDelayMs: 200 });
  try {
    session.start();
    const request = await waitPlay(session);
    session.cancel(request.id, request.token);
    await vi.waitFor(() => expect(session.view.automated).toBe('b'));
    const current = match.room.decisions.pending[0]!;
    match.room.decisions.invalidate(current.id);
    await vi.waitFor(() => expect(match.room.decisions.pending[0]?.id).not.toBe(current.id));
    expect(session.view.error).toBe('');
  } finally {
    session.dispose();
  }
});

it('基础 AI 区分取牌用途与技能发动：突袭后续取牌可完成，寒冰仅在可选发动时保留伤害', async () => {
  const match = fixture();
  await match.prepare();
  for (const [reason, optional] of [
    ['standard:tuxi', false],
    ['standard:fankui', true],
    ['standard:ice_sword-ability', true],
    ['standard:ice_sword-ability', false],
  ] as const) {
    const running = match.room.run('choose', (ctx) =>
      chooseOwnedCard(ctx, {
        actor: 'a',
        target: 'b',
        areas: ['hand'],
        reason,
        optional,
      }),
    );
    const request = await nextRequest(match.room);
    expect(request.data).toMatchObject({ purpose: 'owned-card', reason });
    expect(JSON.stringify(request.data)).not.toContain('secret-b');
    const answer = decideBasic(observeAgent(match, 'a'), request, (input) =>
      match.room.decisions.preview(request.id, input),
    );
    const decline = reason === 'standard:ice_sword-ability' && optional;
    if (decline) {
      expect(answer).toEqual({ kind: 'cancel' });
      expect(match.room.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
    } else {
      expect(answer.kind).toBe('submit');
      if (answer.kind !== 'submit') throw Error('Real owned-card choice must complete.');
      expect(match.room.decisions.submit(request.id, request.token, answer.value)).toEqual({
        kind: 'accepted',
      });
    }
    expect(await running).toMatchObject({
      value: decline ? { kind: 'unavailable' } : { kind: 'chosen', card: 'secret-b' },
    });
  }
  match.room.abort('done');
});

it('未知必选决策明确返回不支持；可选扩展决策允许放弃', async () => {
  const match = fixture();
  await match.prepare();
  const request: DecisionRequest = {
    id: 'custom',
    token: 1,
    revision: 0,
    player: 'b',
    kind: 'custom-extension',
    data: {},
    prompt: '自定义',
    optional: false,
  };
  expect(decideBasic(observeAgent(match, 'b'), request, () => null)).toMatchObject({
    kind: 'unsupported',
  });
  expect(decideBasic(observeAgent(match, 'b'), { ...request, optional: true }, () => null)).toEqual(
    { kind: 'cancel' },
  );
  match.room.abort('done');
});

for (const [count, seed, preset] of [
  [2, 42, 'standard:identity'],
  [4, 27, 'standard:identity'],
  [6, 42, 'standard:identity'],
  [8, 42, 'standard:identity'],
  [2, 255, 'standard:mechanics'],
] as const) {
  it(`${count} 席 ${preset} 种子 ${seed}：基础 AI 使用真实规则完成整局，无非法回复或必选卡死`, async () => {
    const match = createRoleMatch({ count, seed, preset });
    await playMatch(match, { steps: Infinity, decisions: 1800 });
  }, 60_000);
}
