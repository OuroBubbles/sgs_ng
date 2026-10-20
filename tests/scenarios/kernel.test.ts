import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/core/runtime/room';
import { Room } from '../../src/core/runtime/room';
import { defineWindow } from '../../src/core/runtime/window';
import { moveCards, cardsMoved } from '../../src/sdk';
import { choose, nextRequest, room, worldSeed } from '../fixtures/room';

describe('串行结算、作用域和故障现场', () => {
  it('子结算结束后父流程才恢复，事实保留父子因果与作用域', async () => {
    const game = room();
    const order: string[] = [];
    await game.run('turn', async (ctx) => {
      order.push('turn');
      await ctx.flow('phase', async (phase) => {
        order.push('phase');
        await phase.flow('skill', (skill) => {
          skill.commit('skill.hp', [{ kind: 'vitality', player: 'b', hp: 3 }], { player: 'b' });
          order.push('skill');
        });
        order.push('phase resumes');
      });
      order.push('turn resumes');
    });
    expect(order).toEqual(['turn', 'phase', 'skill', 'phase resumes', 'turn resumes']);
    const fact = game.history.facts()[0];
    const phase = game.history.entries.find(
      (entry) => entry.type === 'flow.open' && entry.reason === 'phase',
    );
    expect(fact?.parentFlowId).toBe(phase?.flowId);
    expect(fact?.scopeId).not.toBe(phase?.scopeId);
    expect(game.world.player('b').hp).toBe(3);
  });

  it('两个 Room 独立等待与执行；同局不能重入根流程', async () => {
    const a = room('a');
    const b = room('b');
    const waiting = a.run('waiting', (ctx) => ctx.ask(choose()));
    const request = await nextRequest(a);
    expect(() => a.run('overlap', () => undefined)).toThrow('running');
    await b.run('work', (ctx) => ctx.commit('hp', [{ kind: 'vitality', player: 'b', hp: 2 }], {}));
    expect(a.world.player('b').hp).toBe(4);
    expect(b.world.player('b').hp).toBe(2);
    expect(a.decisions.submit(request.id, request.token, 'yes').kind).toBe('accepted');
    await waiting;
  });

  it('等待子结算时不能偷写父状态，冻结后释放悬挂决策', async () => {
    const game = room();
    await expect(
      game.run('bad', (ctx) => {
        const child = ctx.flow('child', (nested) => nested.ask(choose()));
        ctx.commit('illegal', [{ kind: 'vitality', player: 'b', hp: 1 }], {});
        return child;
      }),
    ).rejects.toThrow('Concurrent rule operation');
    expect(game.status).toBe('faulted');
    expect(game.world.player('b').hp).toBe(4);
    expect(game.decisions.pending).toEqual([]);
  });

  it('遗漏 await 会在父出口报错，不让等待操作逃逸', async () => {
    const game = room();
    const dropped: Promise<unknown>[] = [];
    await expect(
      game.run('bad', (ctx) => {
        dropped.push(ctx.flow('forgotten', (nested) => nested.ask(choose())));
      }),
    ).rejects.toThrow('Unawaited child operation');
    await Promise.allSettled(dropped);
    expect(game.decisions.pending).toEqual([]);
    expect(game.history.entries.filter((entry) => entry.type === 'fault')).toHaveLength(1);
  });

  it('子作用域中止只终止该子流程，父流程可以执行明确善后', async () => {
    const game = room();
    const cleanup: string[] = [];
    await game.run('turn', async (ctx) => {
      const result = await ctx.flow('phase', (phase) => {
        phase.defer(() => {
          cleanup.push('first');
        });
        phase.defer(() => {
          cleanup.push('second');
        });
        phase.abort('skip remaining phase');
      });
      expect(result).toEqual({ kind: 'aborted', reason: 'skip remaining phase' });
      ctx.commit('phase.cleaned', [], {});
    });
    expect(cleanup).toEqual(['second', 'first']);
    expect(game.history.facts('phase.cleaned')).toHaveLength(1);
    expect(game.status).toBe('ready');
  });

  it('整局结束唤醒等待者并拒绝旧回复，不把中止当作故障', async () => {
    const game = room();
    const waiting = game.run('turn', (ctx) => ctx.flow('phase', (phase) => phase.ask(choose())));
    const request = await nextRequest(game);
    game.abort('match ended');
    expect(await waiting).toEqual({ kind: 'aborted', reason: 'match ended' });
    expect(game.decisions.submit(request.id, request.token, 'yes')).toMatchObject({
      kind: 'rejected',
      reason: 'closed',
    });
    expect(game.status).toBe('ended');
    expect(game.history.entries.some((entry) => entry.type === 'fault')).toBe(false);
  });

  it('故障不撤销已经提交的事实，旧上下文永远不能重新写入', async () => {
    const game = room();
    const captured: { ctx?: Context } = {};
    await expect(
      game.run('broken', (ctx) => {
        captured.ctx = ctx;
        ctx.commit('paid', [{ kind: 'vitality', player: 'b', hp: 3 }], {});
        throw new Error('content bug');
      }),
    ).rejects.toThrow('content bug');
    expect(game.world.player('b').hp).toBe(3);
    expect(game.history.facts()).toHaveLength(1);
    expect(() => captured.ctx?.commit('late', [], {})).toThrow('content bug');
    expect(() => game.run('continue', () => undefined)).toThrow('faulted');
  });

  it('正常关闭的上下文也不能在稍后写入', async () => {
    const game = room();
    const result = await game.run('capture', (ctx) => ctx);
    if (result.kind !== 'resolved') throw new Error('Expected context.');
    expect(() => result.value.commit('late', [], {})).toThrow('Scope closed');
    expect(game.history.facts()).toEqual([]);
  });

  it('一个资源清理失败仍会尝试其他释放，并冻结对局', async () => {
    const game = room();
    const released: string[] = [];
    await expect(
      game.run('cleanup', (ctx) => {
        ctx.defer(() => {
          released.push('safe');
        });
        ctx.defer(() => {
          throw new Error('cleanup bug');
        });
      }),
    ).rejects.toThrow('Cleanup failed');
    expect(released).toEqual(['safe']);
    expect(game.status).toBe('faulted');
  });

  it('内容错误与清理错误同时发生时保留最初故障', async () => {
    const game = room();
    await expect(
      game.run('broken', (ctx) => {
        ctx.defer(() => {
          throw new Error('secondary cleanup bug');
        });
        throw new Error('original content bug');
      }),
    ).rejects.toThrow('original content bug');
    expect(game.history.entries.find((entry) => entry.type === 'fault')?.data).toEqual({
      message: 'original content bug',
    });
  });
});

describe('选择会话与最终验证', () => {
  it('预览不提交，错误回复可修正，成功只接纳一次', async () => {
    const game = room();
    const running = game.run('choice', async (ctx) => {
      const result = await ctx.ask(choose());
      if (result.kind === 'chosen') ctx.commit('chosen', [], { option: result.value });
      return result;
    });
    const request = await nextRequest(game);
    expect(game.decisions.preview(request.id, 'yes')?.valid).toBe(true);
    expect(game.history.facts()).toEqual([]);
    expect(game.decisions.cancel(request.id, request.token)).toMatchObject({ reason: 'required' });
    expect(game.decisions.submit(request.id, request.token, 'wrong')).toMatchObject({
      reason: 'invalid',
    });
    expect(game.decisions.submit(request.id, request.token, 'yes').kind).toBe('accepted');
    expect(game.decisions.submit(request.id, request.token, 'yes')).toMatchObject({
      reason: 'closed',
    });
    expect(await running).toEqual({ kind: 'resolved', value: { kind: 'chosen', value: 'yes' } });
    expect(game.history.facts('chosen')).toHaveLength(1);
  });

  it('草案失效 token 与 World revision 分开，提交时重新验证', async () => {
    const game = room();
    let allowed = true;
    const spec = choose();
    const running = game.run('choice', (ctx) =>
      ctx.ask({
        ...spec,
        validate: (input) =>
          allowed ? spec.validate(input) : { ok: false, reason: 'Draft changed.' },
      }),
    );
    const first = await nextRequest(game);
    game.decisions.invalidate(first.id);
    expect(game.world.snapshot.revision).toBe(0);
    expect(game.decisions.submit(first.id, first.token, 'yes')).toMatchObject({ reason: 'stale' });
    const current = game.decisions.preview(first.id, 'yes');
    if (!current) throw new Error('Missing preview.');
    allowed = false;
    expect(game.decisions.submit(first.id, current.request.token, 'yes')).toMatchObject({
      reason: 'invalid',
    });
    allowed = true;
    game.decisions.submit(first.id, current.request.token, 'no');
    await running;
  });

  it('无合法完成路径时不挂起，可选选择取消不产生支付', async () => {
    const game = room();
    const unavailable = await game.run('none', (ctx) =>
      ctx.ask({ ...choose(), available: () => false }),
    );
    expect(unavailable).toEqual({ kind: 'resolved', value: { kind: 'unavailable' } });
    expect(game.decisions.pending).toEqual([]);
    const waiting = game.run('optional', (ctx) => ctx.ask(choose(true)));
    const request = await nextRequest(game);
    expect(game.decisions.cancel(request.id, request.token).kind).toBe('accepted');
    expect(await waiting).toEqual({ kind: 'resolved', value: { kind: 'cancelled' } });
    expect(game.history.facts()).toEqual([]);
  });

  it('校验器异常冻结本局并释放请求，而不是吞错后继续', async () => {
    const game = room();
    const waiting = game.run('choice', (ctx) =>
      ctx.ask({
        ...choose(),
        validate: () => {
          throw new Error('validator bug');
        },
      }),
    );
    const request = await nextRequest(game);
    expect(() => game.decisions.preview(request.id, 'yes')).toThrow('validator bug');
    await expect(waiting).rejects.toThrow('validator bug');
    expect(game.status).toBe('faulted');
    expect(game.decisions.pending).toEqual([]);
  });

  it('回复接纳时复制值，展示描述可以序列化且不泄漏校验器', async () => {
    const game = room();
    const running = game.run('choice', (ctx) =>
      ctx.ask({
        ...choose(),
        validate: (input) =>
          Array.isArray(input) && input.every((id): id is string => typeof id === 'string')
            ? { ok: true, value: input }
            : { ok: false, reason: 'Expected string IDs.' },
      }),
    );
    const request = await nextRequest(game);
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
    expect('validate' in request).toBe(false);
    const value = ['a1'];
    game.decisions.submit(request.id, request.token, value);
    value.push('a2');
    expect(await running).toEqual({ kind: 'resolved', value: { kind: 'chosen', value: ['a1'] } });
  });
});

describe('同步提交与批量移牌', () => {
  it('交换完整提交后才触发后效，before 快照与当前状态可同时查询', async () => {
    const game = room();
    const observed: unknown[] = [];
    game.on(cardsMoved, {
      id: 'observe',
      owner: 'a',
      eligible: () => true,
      run: (ctx, batch) => {
        observed.push({
          a: ctx.world.zone('a:hand').cards,
          b: ctx.world.zone('b:hand').cards,
          before: batch.before,
        });
      },
    });
    await game.run('exchange', (ctx) =>
      moveCards(
        ctx,
        [
          { cards: ['a1', 'a2'], from: 'a:hand', to: 'b:hand', place: 'bottom' },
          { cards: ['b1'], from: 'b:hand', to: 'a:hand', place: 'bottom' },
        ],
        'exchange hands',
      ),
    );
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      a: ['b1'],
      b: ['a1', 'a2'],
      before: [
        { id: 'a:hand', cards: ['a1', 'a2'] },
        { id: 'b:hand', cards: ['b1'] },
      ],
    });
    expect(game.history.facts('cards.moved')).toHaveLength(1);
    expect(game.world.snapshot.revision).toBe(1);
  });

  it.each(['wrong-source', 'duplicate'] as const)(
    '批次 %s 失败时没有部分移动或事实',
    async (failure) => {
      const game = room();
      const original = game.world.snapshot;
      await expect(
        game.run('invalid', (ctx) =>
          moveCards(
            ctx,
            [
              { cards: ['a1'], from: 'a:hand', to: 'discard', place: 'bottom' },
              {
                cards: [failure === 'duplicate' ? 'a1' : 'b1'],
                from: 'a:hand',
                to: 'discard',
                place: 'bottom',
              },
            ],
            'bad batch',
          ),
        ),
      ).rejects.toThrow('Invalid move');
      expect(game.world.snapshot).toBe(original);
      expect(game.history.facts()).toEqual([]);
    },
  );

  it('事实序列化失败也必须发生在状态生效之前', async () => {
    const game = room();
    await expect(
      game.run('bad-data', (ctx) =>
        ctx.commit('bad', [{ kind: 'vitality', player: 'a', hp: 1 }], {
          callback: () => undefined,
        }),
      ),
    ).rejects.toThrow('plain finite data');
    expect(game.world.player('a').hp).toBe(4);
    expect(game.history.facts()).toEqual([]);
  });

  it('旧视图与事实深度冻结，不因后续提交或输入对象修改而变化', async () => {
    const game = room();
    const before = game.world.snapshot;
    const detail = { cards: ['a1'] };
    await game.run('first', (ctx) => ctx.commit('mark', [], detail));
    detail.cards.push('a2');
    await game.run('second', (ctx) =>
      ctx.commit('hp', [{ kind: 'vitality', player: 'a', hp: 3 }], {}),
    );
    expect(before.players[0]?.hp).toBe(4);
    expect(game.history.facts('mark')[0]?.data.detail).toEqual({ cards: ['a1'] });
    expect(Object.isFrozen(game.world.snapshot.players[0])).toBe(true);
    expect(Object.isFrozen(game.history.facts('mark')[0]?.data.detail)).toBe(true);
  });

  it('初始状态中实体牌不能缺失或同时位于两个区域', () => {
    const seed = worldSeed();
    expect(
      () =>
        new Room({
          id: 'bad',
          seed: 1,
          world: { ...seed, zones: seed.zones.filter((zone) => zone.id !== 'draw') },
        }),
    ).toThrow('exactly one location');
    expect(
      () =>
        new Room({
          id: 'bad',
          seed: 1,
          world: {
            ...seed,
            zones: [
              ...seed.zones,
              { id: 'extra', kind: 'special', owner: null, scopeId: null, cards: ['a1'] },
            ],
          },
        }),
    ).toThrow('Invalid card location');
  });
});

describe('Window 候选、行动顺序与纯查询', () => {
  it('开窗快照不吸收新技能，失去的候选在轮到时失效', async () => {
    const game = room();
    const window = defineWindow<null>('test.window');
    const order: string[] = [];
    const remove = game.on(window, {
      id: 'z-old',
      owner: 'a',
      eligible: () => true,
      run: () => {
        order.push('old');
      },
    });
    game.on(window, {
      id: 'a-grant',
      owner: 'a',
      eligible: () => true,
      run: (ctx) => {
        order.push('grant');
        remove();
        if (!ctx.world.snapshot.skills.some((skill) => skill.skill === 'new')) {
          ctx.commit(
            'skill.gained',
            [
              {
                kind: 'setSkill',
                skill: {
                  id: 'new-instance',
                  skill: 'new',
                  owner: 'a',
                  grants: [
                    { source: { kind: 'effect', id: 'grant' }, enabled: true, scopeId: null },
                  ],
                },
              },
            ],
            {},
          );
          game.on(window, {
            id: 'new',
            owner: 'a',
            eligible: (child) => child.world.snapshot.skills.some((skill) => skill.skill === 'new'),
            run: () => {
              order.push('new');
            },
          });
        }
      },
    });
    await game.run('first', (ctx) => ctx.window(window, null));
    expect(order).toEqual(['grant']);
    await game.run('second', (ctx) => ctx.window(window, null));
    expect(order).toEqual(['grant', 'grant', 'new']);
  });

  it('具名组先于座次，座次从明确锚点开始，同组自动项按稳定 ID', async () => {
    const game = room();
    const window = defineWindow<null>('order', ['before', 'after']);
    const order: string[] = [];
    for (const [id, owner, group] of [
      ['b2', 'b', 'before'],
      ['b1', 'b', 'before'],
      ['a', 'a', 'before'],
      ['c', 'c', 'before'],
      ['after', 'b', 'after'],
    ] as const) {
      game.on(window, {
        id,
        owner,
        group,
        eligible: () => true,
        run: () => {
          order.push(id);
        },
      });
    }
    await game.run('ordered', (ctx) => ctx.window(window, null, { anchor: 'b' }));
    expect(order).toEqual(['b1', 'b2', 'c', 'a', 'after']);
  });

  it('同一玩家多个可选顺序效果由决策选先后，一次 occurrence 不重复执行', async () => {
    const game = room();
    const window = defineWindow<null>('choice-order');
    const order: string[] = [];
    for (const id of ['first', 'second'])
      game.on(window, {
        id,
        owner: 'a',
        order: 'choose',
        eligible: () => true,
        run: () => {
          order.push(id);
        },
      });
    const running = game.run('window', (ctx) => ctx.window(window, null));
    const request = await nextRequest(game);
    expect(request.kind).toBe('trigger-order');
    game.decisions.submit(request.id, request.token, 'second');
    await running;
    expect(order).toEqual(['second', 'first']);
    expect(game.decisions.pending).toEqual([]);
  });

  it('临时监听在作用域结束后自动注销', async () => {
    const game = room();
    const window = defineWindow<null>('temporary');
    const hits: string[] = [];
    await game.run('phase', async (ctx) => {
      ctx.listen(window, {
        id: 'temporary',
        owner: 'a',
        eligible: () => true,
        run: () => {
          hits.push('hit');
        },
      });
      await ctx.window(window, null);
    });
    await game.run('next-phase', (ctx) => ctx.window(window, null));
    expect(hits).toEqual(['hit']);
  });

  it('资格查询中写状态会冻结本局', async () => {
    const game = room();
    const window = defineWindow<null>('pure');
    game.on(window, {
      id: 'bad-query',
      owner: 'a',
      eligible: (ctx) => {
        ctx.commit('illegal', [], {});
        return true;
      },
      run: () => undefined,
    });
    await expect(game.run('window', (ctx) => ctx.window(window, null))).rejects.toThrow(
      'Pure queries',
    );
    expect(game.history.facts()).toEqual([]);
  });

  it('同一 ID 的两个时点定义不能悄悄混用', () => {
    const game = room();
    game.on(defineWindow<number>('same'), {
      id: 'one',
      owner: 'a',
      eligible: () => true,
      run: () => undefined,
    });
    expect(() =>
      game.on(defineWindow<string>('same'), {
        id: 'two',
        owner: 'a',
        eligible: () => true,
        run: () => undefined,
      }),
    ).toThrow('Two window definitions');
  });
});

it('同种子、同输入产生相同随机轨迹，其他 Room 不消耗本局随机流', async () => {
  const a = room();
  const b = room();
  const unrelated = room('other');
  const run = (target: Room) =>
    target.run('random', (ctx) => Array.from({ length: 100 }, () => ctx.randomInt(13)));
  const result = await run(a);
  await run(unrelated);
  expect(await run(b)).toEqual(result);
  expect(b.history.entries).toEqual(a.history.entries);
  if (result.kind === 'resolved')
    expect(result.value.every((value) => value >= 0 && value < 13)).toBe(true);
});
