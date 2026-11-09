import { expect, it, vi } from 'vitest';
import { SoloSession } from '../../src/host/solo';
import { Match, RoleMatch } from '../../src/host/role-match';
import { standardCards } from '../fixtures/standard';
import wusheng from '../../src/content/standard/skills/wusheng';
import { moveCards, Use } from '../../src/sdk';
import { finishGame } from '../../src/rules/game/end';
import '../../src/sdk';
import type { GameSelection, GameView } from '../../src/protocol';
import { card } from '../fixtures/cards';
import { nextRequest } from '../fixtures/room';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { createRoleMatch } from '../../src/host/content';
import type { Context } from '../../src/sdk';
import type { Validation } from '../../src/core/decisions/hub';
import { Game } from '../../src/rules/game/end';
import { testTiming } from '../fixtures/timing';

const empty = (): GameSelection => ({ offer: null, cards: [], targets: [] });

it('本地预览与回复把规则故障留在主持侧，返回不可操作结果并保留原始错误', async () => {
  for (const fault of ['throw', 'async'] as const) {
    for (const entry of ['inspect', 'inspectAnswer', 'reply', 'answer'] as const) {
      const match = createRoleMatch({ count: 2, seed: 42 });
      const session = new SoloSession(match, { human: '甲席' });
      let at: Context;
      let lateError = '';
      const validate =
        fault === 'throw'
          ? () => {
              throw new Error('probe:invalid-selection');
            }
          : ((async () => {
              await Promise.resolve();
              try {
                at.commit(testTiming('invalid.preview.late'), [], null);
              } catch (error) {
                lateError = (error as Error).message;
              }
              return { ok: true, value: null };
            }) as unknown as () => Validation<unknown>);
      const settled = match.room
        .run('ask', (ctx) => {
          at = ctx;
          return ctx.ask({
            player: '甲席',
            kind: 'cards-targets',
            prompt: '故障选择',
            data: {},
            optional: false,
            validate,
          });
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      try {
        const request = await nextRequest(match.room);
        let response: unknown;
        expect(() => {
          if (entry === 'inspect') response = session.inspect(request.id, request.token, empty());
          else if (entry === 'reply') response = session.reply(request.id, request.token, empty());
          else response = session[entry](request.id, request.token, {});
        }).not.toThrow();
        expect(response).toMatchObject(
          entry === 'inspect' || entry === 'inspectAnswer'
            ? { valid: false }
            : { kind: 'rejected', reason: 'closed' },
        );
        const message = fault === 'throw' ? 'probe:invalid-selection' : 'Queries cannot await';
        expect(((await settled) as Error).message).toContain(message);
        expect(session.view.error).toContain(message);
        expect(session.view.status).toBe('faulted');
        expect(session.view.decision).toBeNull();
        expect(session.view.automated).toBeNull();
        expect(match.room.decisions.pending).toEqual([]);
        expect(match.room.history.entries.filter((entry) => entry.type === 'fault')).toHaveLength(
          1,
        );
        expect(match.room.history.facts()).toEqual([]);
        if (fault === 'async') expect(lateError).toContain(message);
      } finally {
        session.dispose();
        await settled;
      }
    }
  }
});
function game(options: { wounded?: boolean; response?: boolean } = {}) {
  const match = new RoleMatch({
    id: 'local-test',
    seed: 42,
    players: [{ id: 'a', skills: [wusheng.id] }, { id: 'b' }],
    roles: ['lord', 'rebel'],
    content: {
      cards: standardCards,
      skills: [wusheng],
    },
    deck: [
      card('slash', 'slash'),
      card('private-a', 'peach', 'heart'),
      card('private-b', options.response ? 'jink' : 'peach'),
      ...Array.from({ length: 20 }, (_, i) => card(`hidden-deck-${i}`, 'jink')),
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
          to:
            card.id === 'slash' || card.id === 'private-a'
              ? 'a:hand'
              : card.id === 'private-b'
                ? 'b:hand'
                : 'draw',
          place: 'bottom',
        })),
        'fixture',
      );
      if (options.wounded)
        ctx.commit(testTiming('wounded'), [{ kind: 'vitality', player: 'b', hp: 1 }], null);
    },
  });
  const session = new SoloSession(match);
  session.start();
  return { match, session };
}
async function waitView(
  session: SoloSession,
  check: (view: GameView) => boolean,
): Promise<GameView> {
  return vi.waitFor(() => {
    expect(check(session.view)).toBe(true);
    return session.view;
  });
}
async function enter(session: SoloSession) {
  const hidden = await waitView(session, (view) => Boolean(view.handoff));
  session.confirmSeat(hidden.handoff!.key);
  return waitView(session, (view) => Boolean(view.decision));
}

it('交接前没有手牌、私有身份或请求描述；本人确认才显示，不能跳过交接直接回答', async () => {
  const { match, session } = game();
  try {
    const hidden = await waitView(session, (view) => Boolean(view.handoff));
    expect(hidden.hand).toEqual([]);
    expect(hidden.decision).toBeNull();
    expect(hidden.players.map((player) => player.role)).toEqual(['主公', null]);
    const request = await nextRequest(match.room);
    expect(session.answer(request.id, request.token, true).kind).toBe('rejected');
    expect(JSON.stringify(hidden)).not.toContain('private-b');
    expect(JSON.stringify(hidden)).not.toContain('hidden-deck-');
    const view = await enter(session);
    expect(view.viewer).toBe('a');
    expect(view.hand.map((card) => card.id)).toContain('private-a');
    expect(JSON.stringify(view)).not.toContain('private-b');
    expect(view.log.every((entry) => !entry.text.includes('hidden-deck-'))).toBe(true);
  } finally {
    session.dispose();
  }
});

it('真实杀/闪切换席位，遮住前一人手牌；旧选择不能用于下一人或回流后的请求', async () => {
  const { session, match } = game({ response: true });
  try {
    const a = await enter(session);
    const request = a.decision!;
    if (!('offers' in request)) throw new Error('Expected card request');
    const offer = request.offers.find((offer) => offer.cardId === 'slash')!;
    const selection = { offer: offer.id, cards: [], targets: ['b'] };
    const before = session.inspect(request.id, request.token, { ...selection, targets: [] });
    expect(before.valid).toBe(false);
    expect(before.targets.find((target) => target.id === 'b')?.selectable).toBe(true);
    expect(session.inspect(request.id, request.token, selection).valid).toBe(true);
    expect(session.reply(request.id, request.token, selection).kind).toBe('accepted');
    const curtain = await waitView(session, (view) => view.handoff?.player === 'b');
    expect(curtain.viewer).toBeNull();
    expect(curtain.hand).toEqual([]);
    expect(JSON.stringify(curtain)).not.toContain('private-a');
    expect(JSON.stringify(curtain)).not.toContain('private-b');
    expect(session.reply(request.id, request.token, selection).kind).toBe('rejected');
    const b = await enter(session);
    const response = b.decision!;
    if (!('offers' in response)) throw new Error('Expected response');
    expect(response.kind).toBe('card-response');
    expect(
      session.reply(response.id, response.token, { ...empty(), offer: response.offers[0]!.id })
        .kind,
    ).toBe('accepted');
    const again = await enter(session);
    expect(again.viewer).toBe('a');
    expect(again.hand.some((card) => card.id === 'slash')).toBe(false);
    expect(match.room.world.player('b').hp).toBe(4);
    expect(again.log.some((entry) => entry.text.includes('使用【闪】'))).toBe(true);
    expect(
      session.answer(response.id, response.token, { kind: 'physical', card: 'private-b' }).kind,
    ).toBe('rejected');
  } finally {
    session.dispose();
  }
});

it('武圣材料经同一个决策最终校验，预览不会移动手牌或支付次数', async () => {
  const { session, match } = game();
  try {
    const view = await enter(session);
    const request = view.decision!;
    if (!('offers' in request)) throw new Error('Expected offers');
    const recipe = request.offers.find((offer) => offer.kind === 'viewAs')!;
    const selection = {
      offer: recipe.id,
      cards: new Proxy(['private-a'], {}),
      targets: new Proxy(['b'], {}),
    };
    const revision = match.room.world.snapshot.revision;
    expect(session.inspect(request.id, request.token, selection).valid).toBe(true);
    expect(match.room.world.snapshot.revision).toBe(revision);
    expect(match.room.world.position('private-a')).toBe('a:hand');
    expect(session.reply(request.id, request.token, selection).kind).toBe('accepted');
    await waitView(
      session,
      (next) => Boolean(next.decision) && next.log.some((entry) => entry.text.includes('受到')),
    );
    expect(match.room.world.position('private-a')).toBe('discard');
    expect(match.room.world.player('b').hp).toBe(3);
  } finally {
    session.dispose();
  }
});

it('强制弃牌支持多张选择，不能取消；完成后新的回合必须重新交接', async () => {
  const { session } = game();
  try {
    let view = await enter(session);
    session.cancel(view.decision!.id, view.decision!.token);
    // a 起手两张再摸两张，未超过四张，不需要弃牌，直接轮到 b。
    const curtain = await waitView(session, (next) => next.handoff?.player === 'b');
    expect(curtain.hand).toEqual([]);
    view = await enter(session);
    session.cancel(view.decision!.id, view.decision!.token);
    await enter(session); // a 新回合又摸两张，手牌六张。
    view = session.view;
    session.cancel(view.decision!.id, view.decision!.token);
    const discard = await waitView(session, (next) => next.decision?.kind === 'cards-targets');
    expect(discard.decision!.optional).toBe(false);
    expect(session.cancel(discard.decision!.id, discard.decision!.token).kind).toBe('rejected');
    const selection = { ...empty(), cards: discard.hand.slice(0, 2).map((card) => card.id) };
    expect(session.inspect(discard.decision!.id, discard.decision!.token, selection).valid).toBe(
      true,
    );
    session.reply(discard.decision!.id, discard.decision!.token, selection);
    expect((await waitView(session, (next) => Boolean(next.handoff))).hand).toEqual([]);
  } finally {
    session.dispose();
  }
});

it('嵌套救援使用固定目标的 use-card 面板，不暴露其他席位候选', async () => {
  const { session, match } = game({ wounded: true });
  try {
    const a = await enter(session);
    const request = a.decision!;
    if (!('offers' in request)) throw new Error('Expected offers');
    const slash = request.offers.find((offer) => offer.cardId === 'slash')!;
    session.reply(request.id, request.token, { offer: slash.id, cards: [], targets: ['b'] });
    // 回合角色 a 先救：放弃自己的桃，然后切到 b。
    const ownRescue = await waitView(session, (next) => next.decision?.kind === 'use-card');
    session.cancel(ownRescue.decision!.id, ownRescue.decision!.token);
    const b = await enter(session);
    const rescue = b.decision!;
    expect(rescue).toMatchObject({ kind: 'use-card', fixedTargets: ['b'] });
    if (!('offers' in rescue)) throw new Error('Expected rescue offers');
    expect(
      session.inspect(rescue.id, rescue.token, { ...empty(), offer: rescue.offers[0]!.id }).valid,
    ).toBe(true);
    session.reply(rescue.id, rescue.token, { ...empty(), offer: rescue.offers[0]!.id });
    await enter(session);
    expect(match.room.world.player('b')).toMatchObject({ alive: true, hp: 1 });
    expect(session.view.actions.some((action) => action.card.name === '桃')).toBe(true);
  } finally {
    session.dispose();
  }
});

it('终局揭示身份，关闭后不再发布私有请求；释放订阅后没有迟到 UI 回调', async () => {
  const { session, match } = game();
  const views: GameView[] = [];
  const off = session.subscribe((view) => views.push(view));
  await enter(session);
  off();
  session.dispose();
  const length = views.length;
  await Promise.resolve();
  await Promise.resolve();
  expect(views).toHaveLength(length);
  expect(match.room.decisions.pending).toEqual([]);
  // 单独准备后提交终局，投影不依赖 UI 猜测身份。
  const ended = game();
  try {
    ended.match.room.on(Use.declared, {
      id: 'terminal',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        await finishGame(ctx, { winners: ['a'], reason: 'probe' });
      },
    });
    const view = await enter(ended.session);
    const decision = view.decision!;
    if (!('offers' in decision)) throw new Error('Expected card decision');
    const slash = decision.offers.find((offer) => offer.cardId === 'slash')!;
    ended.session.reply(decision.id, decision.token, {
      offer: slash.id,
      cards: [],
      targets: ['b'],
    });
    const final = await waitView(ended.session, (next) => next.status === 'ended');
    expect(final.players.map((player) => player.role)).toEqual(['主公', '反贼']);
    expect(final.decision).toBeNull();
    await vi.waitFor(() => {
      expect(ended.match.room.status).toBe('ended');
    });
    expect(ended.match.room.world.position('slash')).toBe('discard');
  } finally {
    ended.session.dispose();
  }
});

it('隐藏手牌撤销当前查看许可，旧交接令牌无效，再次确认不推进规则', async () => {
  const { session, match } = game();
  try {
    const first = await waitView(session, (view) => Boolean(view.handoff));
    const oldKey = first.handoff!.key;
    const view = await enter(session);
    const revision = match.room.world.snapshot.revision;
    session.hide();
    expect(session.view.hand).toEqual([]);
    expect(session.view.decision).toBeNull();
    expect(session.view.handoff?.turn).toBe(false);
    session.confirmSeat(oldKey);
    expect(session.view.viewer).toBeNull();
    session.confirmSeat(session.view.handoff!.key);
    expect(session.view.hand).toEqual(view.hand);
    expect(match.room.world.snapshot.revision).toBe(revision);
  } finally {
    session.dispose();
  }
});

it('执行侧中止不被界面误报为仍在结算或正常胜负', async () => {
  const { session, match } = game();
  try {
    await enter(session);
    match.room.abort('probe:stopped');
    const final = await waitView(session, (view) => view.status === 'stopped');
    expect(final.error).toBe('probe:stopped');
    expect(final.result).toBeNull();
    expect(final.decision).toBeNull();
  } finally {
    session.dispose();
  }
});

it('胜负提交后清理失败保留事实，并将原始作者故障传给主持视图', async () => {
  const { session, match } = game();
  try {
    match.room.on(Use.declared, {
      id: 'terminal-cleanup-fault',
      owner: null,
      eligible: () => true,
      async run(ctx) {
        ctx.defer(() => {
          throw new Error('作者释放故障');
        });
        await finishGame(ctx, { winners: ['a'], reason: 'probe' });
      },
    });
    const view = await enter(session);
    const decision = view.decision!;
    if (!('offers' in decision)) throw new Error('Expected card decision');
    const slash = decision.offers.find((offer) => offer.cardId === 'slash')!;
    session.reply(decision.id, decision.token, { offer: slash.id, cards: [], targets: ['b'] });
    const final = await waitView(
      session,
      (next) => next.status === 'faulted' && Boolean(next.error),
    );
    expect(final.error).toContain('作者释放故障');
    expect(match.room.history.entries.find((entry) => entry.type === 'fault')?.data).toEqual({
      message: final.error,
    });
    expect(final.result).toEqual({ winners: ['a'], reason: 'probe' });
    expect(final.decision).toBeNull();
    expect(match.room.decisions.pending).toEqual([]);
    expect(match.room.history.facts(Game.finished)).toHaveLength(1);
    expect(rebuildWorld(match.initial, match.room.history.facts())).toEqual(
      match.room.world.snapshot,
    );
  } finally {
    session.dispose();
  }
});
