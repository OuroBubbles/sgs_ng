import { testTiming } from '../fixtures/timing';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Context } from '../../src/core/runtime/room';
import type { Change } from '../../src/core/model/state';
import type { Decision, Validation } from '../../src/core/decisions/hub';
import { Room } from '../../src/core/runtime/room';
import { World } from '../../src/core/state/world';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { moveCards, Cards } from '../../src/sdk';
import { choose, nextRequest, room, worldSeed } from '../fixtures/room';

describe('串行结算、作用域和故障现场', () => {
  it('触发可直接返回规则结果，窗口等待完成；普通 false 返回值不表示中止', async () => {
    const game = room();
    const tick = testTiming<null>('test.returned-rule');
    let resumed = false;
    let following = false;
    game.on(tick, {
      id: 'a-ask',
      owner: 'a',
      eligible: () => true,
      run: (ctx) => ctx.ask(choose()),
    });
    game.on(tick, {
      id: 'b-result',
      owner: 'a',
      eligible: () => true,
      run: () => {
        following = true;
        return false;
      },
    });
    const running = game.run('window', async (ctx) => {
      expect(await ctx.window(tick, null)).toBeUndefined();
      resumed = true;
    });
    const request = await nextRequest(game);
    expect(resumed).toBe(false);
    expect(following).toBe(false);
    expect(game.decisions.submit(request.id, request.token, 'yes')).toEqual({ kind: 'accepted' });
    await running;
    expect(resumed).toBe(true);
    expect(following).toBe(true);
    expect(game.status).toBe('ready');
    expect(game.history.facts()).toEqual([]);
  });

  it('子结算结束后父流程才恢复，事实保留父子因果与作用域', async () => {
    const game = room();
    const order: string[] = [];
    await game.run('turn', async (ctx) => {
      order.push('turn');
      await ctx.flow('phase', async (phase) => {
        order.push('phase');
        await phase.flow('skill', (skill) => {
          skill.commit(testTiming('skill.hp'), [{ kind: 'vitality', player: 'b', hp: 3 }], {
            player: 'b',
          });
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
    expect(Object.isFrozen(fact?.scopePath)).toBe(true);
    expect(fact?.scopePath).not.toBe(phase?.scopePath);
    for (const entry of game.history.entries.filter((entry) => entry.scopeId === fact?.scopeId))
      expect(entry.scopePath).toBe(fact?.scopePath);
    expect(game.world.player('b').hp).toBe(3);
    const snapshot = game.history.facts();
    await game.run('later', (ctx) => ctx.commit(testTiming('later.note'), [], null));
    expect(snapshot).toEqual([fact]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(game.history.facts()).toEqual(
      game.history.entries.filter((entry) => entry.type === 'commit'),
    );
    expect(game.history.facts(testTiming('skill.hp'), phase!.scopeId)).toEqual([fact]);
    expect(game.history.facts(testTiming('later.note'), phase!.scopeId)).toEqual([]);
    expect(game.history.facts(testTiming('missing'))).toEqual([]);
  });

  it('两个 Room 独立等待与执行；同局不能重入根流程', async () => {
    const a = room('a');
    const b = room('b');
    const waiting = a.run('waiting', (ctx) => ctx.ask(choose()));
    const request = await nextRequest(a);
    expect(() => a.run('overlap', () => undefined)).toThrow('running');
    await b.run('work', (ctx) =>
      ctx.commit(testTiming('hp'), [{ kind: 'vitality', player: 'b', hp: 2 }], {}),
    );
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
        ctx.commit(testTiming('illegal'), [{ kind: 'vitality', player: 'b', hp: 1 }], {});
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
      const result = await ctx.attempt('phase', (phase) => {
        phase.defer(() => {
          cleanup.push('first');
        });
        phase.defer(() => {
          cleanup.push('second');
        });
        phase.abort('skip remaining phase');
      });
      expect(result).toEqual({ kind: 'aborted', reason: 'skip remaining phase' });
      ctx.commit(testTiming('phase.cleaned'), [], {});
    });
    expect(cleanup).toEqual(['second', 'first']);
    expect(game.history.facts(testTiming('phase.cleaned'))).toHaveLength(1);
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
        ctx.commit(testTiming('paid'), [{ kind: 'vitality', player: 'b', hp: 3 }], {});
        throw new Error('content bug');
      }),
    ).rejects.toThrow('content bug');
    expect(game.world.player('b').hp).toBe(3);
    expect(game.history.facts()).toHaveLength(1);
    expect(() => captured.ctx?.commit(testTiming('late'), [], {})).toThrow('content bug');
    expect(() => game.run('continue', () => undefined)).toThrow('faulted');
  });

  it('正常关闭的上下文也不能在稍后写入', async () => {
    const game = room();
    const result = await game.run('capture', (ctx) => ctx);
    if (result.kind !== 'resolved') throw new Error('Expected context.');
    expect(() => result.value.commit(testTiming('late'), [], {})).toThrow('Scope closed');
    expect(game.history.facts()).toEqual([]);
  });

  it.each(['throw', 'async'] as const)(
    '%s 资源清理失败仍会尝试其他释放，并冻结对局',
    async (kind) => {
      const game = room();
      const released: string[] = [];
      const running = game.run('cleanup', (ctx) => {
        ctx.defer(() => {
          throw new Error('second resource failed');
        });
        ctx.defer(() => {
          released.push('safe');
        });
        const cleanup: unknown =
          kind === 'throw'
            ? () => {
                throw new Error('cleanup bug');
              }
            : async () => {
                await Promise.resolve();
                ctx.commit(testTiming('late cleanup'), [], {});
              };
        // 模拟没有经过项目 lint 的内容回调，运行时仍须守住同步释放边界。
        ctx.defer(cleanup as () => void);
      });
      await expect(running).rejects.toBeInstanceOf(AggregateError);
      await expect(running).rejects.toThrow(
        kind === 'throw' ? 'cleanup bug' : 'Resource cleanup cannot await.',
      );
      await expect(running).rejects.toThrow('second resource failed');
      expect(released).toEqual(['safe']);
      expect(game.status).toBe('faulted');
      expect(game.history.facts()).toEqual([]);
    },
  );

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
  it('决策固定原型方法与接收者，刷新仍读取当前私有字段', async () => {
    class Choice implements Decision<string> {
      player = 'a';
      kind = 'option';
      prompt = '选择当前选项';
      optional = false;
      #options = ['yes'];

      offer(option: string) {
        this.#options = [option];
      }

      available() {
        return this.#options.length > 0;
      }

      describe() {
        return { options: this.#options };
      }

      feedback(input: unknown) {
        return {
          selected: typeof input === 'string' && this.#options.includes(input) ? input : null,
        };
      }

      validate(input: unknown): Validation<string> {
        return typeof input === 'string' && this.#options.includes(input)
          ? { ok: true, value: input }
          : { ok: false, reason: 'Option changed.' };
      }
    }

    const game = room();
    const spec = new Choice();
    const running = game.run('method-choice', (ctx) => ctx.ask(spec));
    const first = await nextRequest(game);
    expect(first.data).toEqual({ options: ['yes'] });
    expect(game.decisions.preview(first.id, 'yes')).toMatchObject({
      valid: true,
      feedback: { selected: 'yes' },
    });

    const replaced = () => {
      throw new Error('Replaced decision method must not run.');
    };
    spec.available = replaced;
    spec.describe = replaced;
    spec.feedback = replaced;
    spec.validate = replaced;
    spec.offer('later');
    game.decisions.invalidate(first.id);
    expect(first.data).toEqual({ options: ['yes'] });
    expect(game.decisions.submit(first.id, first.token, 'yes')).toMatchObject({ reason: 'stale' });
    const current = game.decisions.preview(first.id, 'later');
    if (!current) throw new Error('Missing refreshed decision.');
    expect(current).toMatchObject({
      request: { data: { options: ['later'] } },
      valid: true,
      feedback: { selected: 'later' },
    });
    expect(game.decisions.submit(first.id, current.request.token, 'yes')).toMatchObject({
      reason: 'invalid',
    });
    expect(game.decisions.submit(first.id, current.request.token, 'later').kind).toBe('accepted');
    expect(await running).toEqual({ kind: 'resolved', value: { kind: 'chosen', value: 'later' } });
  });

  it('预览不提交，错误回复可修正，成功只接纳一次', async () => {
    const game = room();
    const running = game.run('choice', async (ctx) => {
      const result = await ctx.ask(choose());
      if (result.kind === 'chosen') ctx.commit(testTiming('chosen'), [], { option: result.value });
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
    expect(game.history.facts(testTiming('chosen'))).toHaveLength(1);
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
        player: 'a',
        kind: 'option',
        prompt: '选择牌',
        optional: false,
        validate: (input) =>
          Array.isArray(input) && input.every((id): id is string => typeof id === 'string')
            ? { ok: true, value: input }
            : { ok: false, reason: 'Expected string IDs.' },
      }),
    );
    const request = await nextRequest(game);
    expect(request.data).toBeNull();
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
    expect('validate' in request).toBe(false);
    const value = ['a1'];
    game.decisions.submit(request.id, request.token, value);
    value.push('a2');
    const result = await running;
    expect(result).toEqual({ kind: 'resolved', value: { kind: 'chosen', value: ['a1'] } });
    if (result.kind !== 'resolved' || result.value.kind !== 'chosen')
      throw new Error('Expected an accepted choice.');
    expectTypeOf(result.value.value).toEqualTypeOf<readonly string[]>();
    const local = [...result.value.value];
    local.push('a2');
    expect(result.value.value).toEqual(['a1']);
  });
});

describe('同步提交与批量移牌', () => {
  it('交换完整提交后才触发后效，before 快照与当前状态可同时查询', async () => {
    const game = room();
    const before = game.world.snapshot;
    const observed: unknown[] = [];
    game.on(Cards.moved, {
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
    expect(game.history.facts(Cards.moved)).toHaveLength(1);
    expect(game.world.snapshot.revision).toBe(1);
    expect(game.world.snapshot.players).toBe(before.players);
    expect(game.world.zone('draw')).toBe(before.zones.find((zone) => zone.id === 'draw'));
    expect(game.world.zone('a:hand')).not.toBe(before.zones[0]);
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
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const detail of [
      { callback: () => undefined },
      { cycle },
      { date: new Date() },
      { n: Infinity },
    ]) {
      const game = room();
      await expect(
        game.run('bad-data', (ctx) =>
          ctx.commit(testTiming('bad'), [{ kind: 'vitality', player: 'a', hp: 1 }], detail),
        ),
      ).rejects.toThrow(/plain finite data|Cyclic game data|plain objects/);
      expect(game.world.player('a').hp).toBe(4);
      expect(game.history.facts()).toEqual([]);
    }
  });

  it('提交输入只快照一次，状态与事实使用同一变化值并保留图内别名', async () => {
    const game = room();
    let reads = 0;
    const shared = { cards: ['a1'] };
    const marker = {
      kind: 'setState' as const,
      state: {
        id: 'probe:shared',
        key: 'probe:shared',
        owner: 'a',
        source: null,
        scopeId: null,
        value: shared,
      },
    };
    const changes: readonly Change[] = [
      {
        kind: 'vitality',
        player: 'a',
        get hp() {
          return ++reads === 1 ? 3 : 2;
        },
      },
      marker,
    ];
    const result = await game.run('snapshot', (ctx) =>
      ctx.commit(
        testTiming<unknown, { shared: typeof shared; marker: typeof marker }>('snapshot'),
        changes,
        { shared, marker },
      ),
    );
    if (result.kind !== 'resolved') throw new Error('Expected a committed snapshot.');
    const fact = result.value;
    expect(reads).toBe(1);
    expect(game.world.player('a').hp).toBe(3);
    expect(fact.data.changes[0]).toMatchObject({ hp: 3 });
    expect(fact.data.detail.marker).toBe(fact.data.changes[1]);
    expect(fact.data.detail.shared).toBe(fact.data.detail.marker.state.value);
    shared.cards.push('a2');
    expect(fact.data.detail.shared.cards).toEqual(['a1']);
    expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
  });

  it.each(['changes', 'detail'] as const)(
    '提交输入 %s 的 getter 不能重入规则操作，失败前没有状态或事实',
    async (position) => {
      const game = room();
      const before = game.world.snapshot;
      await expect(
        game.run('reentry', (ctx) => {
          const enter = () => {
            ctx.commit(testTiming('inner'), [{ kind: 'vitality', player: 'b', hp: 1 }], {});
            return 3;
          };
          ctx.commit(
            testTiming('outer'),
            [
              {
                kind: 'vitality',
                player: 'a',
                get hp() {
                  return position === 'changes' ? enter() : 3;
                },
              },
            ],
            {
              get value() {
                if (position === 'detail') enter();
                return 'captured';
              },
            },
          );
        }),
      ).rejects.toThrow('Pure queries cannot perform rule operations.');
      expect(game.status).toBe('faulted');
      expect(game.world.snapshot).toBe(before);
      expect(game.history.facts()).toEqual([]);
    },
  );

  it('旧视图与事实深度冻结，不因后续提交或输入对象修改而变化', async () => {
    const game = room();
    const before = game.world.snapshot;
    const detail = { cards: ['a1'] };
    await game.run('first', (ctx) => ctx.commit(testTiming('mark'), [], detail));
    const marked = game.world.snapshot;
    expect(marked).not.toBe(before);
    expect(marked.revision).toBe(before.revision + 1);
    for (const key of ['players', 'cards', 'zones', 'skills', 'states'] as const)
      expect(marked[key]).toBe(before[key]);
    detail.cards.push('a2');
    await game.run('second', (ctx) =>
      ctx.commit(testTiming('hp'), [{ kind: 'vitality', player: 'a', hp: 3 }], {}),
    );
    expect(before.players[0]?.hp).toBe(4);
    expect(game.world.snapshot.players).not.toBe(before.players);
    expect(game.world.snapshot.players[1]).toBe(before.players[1]);
    for (const key of ['cards', 'zones', 'skills', 'states'] as const)
      expect(game.world.snapshot[key]).toBe(before[key]);
    expect(game.history.facts(testTiming('mark'))[0]?.data.detail).toEqual({ cards: ['a1'] });
    expect(Object.isFrozen(game.world.snapshot.players[0])).toBe(true);
    expect(Object.isFrozen(game.history.facts(testTiming('mark'))[0]?.data.detail)).toBe(true);

    const shared = { value: 2 };
    const mutable = { cards: ['a1'] };
    const sparse = new Array<string>(3);
    sparse[2] = 'a2';
    const shifting = new Array<string>(5);
    shifting[4] = 'a2';
    Object.defineProperty(shifting, '0', {
      enumerable: true,
      get() {
        shifting.length = 2;
        return 'a1';
      },
    });
    const named = Object.fromEntries([['__proto__', { value: 1 }]]);
    const graphDetail = {
      left: shared,
      right: shared,
      shell: Object.freeze({ mutable }),
      sparse,
      shifting,
      named,
    };
    const graph = await game.run('graph', (ctx) =>
      ctx.commit(testTiming<unknown, typeof graphDetail>('graph'), [], graphDetail),
    );
    if (graph.kind !== 'resolved') throw new Error('Expected immutable graph.');
    const snapshot = graph.value.data.detail;
    shared.value = 9;
    mutable.cards.push('a2');
    expect(snapshot.left).toEqual({ value: 2 });
    expect(snapshot.left).toBe(snapshot.right);
    expect(snapshot.shell.mutable.cards).toEqual(['a1']);
    expectTypeOf(snapshot.shell.mutable.cards).toEqualTypeOf<readonly string[]>();
    // 原型方法调用模拟未经过类型检查的代码，运行时仍须拒绝。
    expect(() => Array.prototype.push.call(snapshot.shell.mutable.cards, 'a3')).toThrow();
    expect(snapshot.sparse).toEqual(sparse);
    expect(0 in snapshot.sparse).toBe(false);
    expect(snapshot.shifting.length).toBe(5);
    expect(Object.keys(snapshot.shifting)).toEqual(['0']);
    expect(Object.hasOwn(snapshot.named, '__proto__')).toBe(true);
    expect(snapshot.named.__proto__).toEqual({ value: 1 });
    expect(Object.getPrototypeOf(snapshot.named)).toBe(Object.prototype);
  });

  it('同 revision 换表与移除后按当前状态读取，旧快照与别局不变', () => {
    const state = { id: 'state', key: 'probe', owner: null, source: null, scopeId: null, value: 1 };
    const left = new World({ ...worldSeed(), states: [state] });
    const right = new World({ ...worldSeed(), states: [{ ...state, value: 2 }] });
    const before = left.reader.snapshot;
    expect(left.reader.state('missing')).toBeUndefined();
    expect(left.reader.state(state.id)).toBe(before.states[0]);
    expect(right.reader.snapshot.revision).toBe(before.revision);
    left.apply(right.reader.snapshot);
    expect(left.reader.state(state.id)?.value).toBe(2);
    expect(before.states[0]?.value).toBe(1);
    let keyReads = 0;
    const prepared = left.prepare([
      {
        kind: 'setState',
        state: {
          ...state,
          get key() {
            return ++keyReads === 1 ? 'probe' : '';
          },
          value: 3,
        },
      },
    ]);
    expect(prepared.states[0]?.key).toBe('probe');
    expect(keyReads).toBe(1);
    expect(left.reader.state(state.id)?.value).toBe(2);
    left.apply(prepared);
    expect(left.reader.state(state.id)?.value).toBe(3);
    left.apply(left.prepare([{ kind: 'removeState', state: state.id }]));
    expect(left.reader.state(state.id)).toBeUndefined();
    expect(right.reader.state(state.id)?.value).toBe(2);
  });

  it('初始状态中实体牌不能缺失或同时位于两个区域', () => {
    const seed = worldSeed();
    let rankReads = 0;
    const card = {
      ...seed.cards[0]!,
      get rank() {
        return ++rankReads <= 3 ? 7 : 14;
      },
    };
    const initial = new World({ ...seed, cards: [card, ...seed.cards.slice(1)] });
    expect(initial.reader.card(card.id).rank).toBe(7);
    expect(rankReads).toBe(1);
    expect(Object.isFrozen(card)).toBe(false);
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
    const window = testTiming<null>('test.window');
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
            testTiming('skill.gained'),
            [
              {
                kind: 'setSkill',
                skill: {
                  id: 'new-instance',
                  skill: 'new',
                  owner: 'a',
                  grants: [{ source: { kind: 'effect', id: 'grant' }, scopeId: null }],
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
    const window = testTiming<null>('order', ['before', 'after']);
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
    const window = testTiming<null>('choice-order');
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
    const window = testTiming<null>('temporary');
    const hits: string[] = [];
    await game.run('phase', async (ctx) => {
      ctx.defer(
        game.on(window, {
          id: 'temporary',
          owner: 'a',
          eligible: () => true,
          run: () => {
            hits.push('hit');
          },
        }),
      );
      await ctx.window(window, null);
    });
    await game.run('next-phase', (ctx) => ctx.window(window, null));
    expect(hits).toEqual(['hit']);
  });

  it.each(['query', 'describe', 'feedback'] as const)(
    '%s 返回异步值时先止写，并完整清理故障作用域',
    async (path) => {
      const game = room();
      const window = testTiming<null>('async.query.cleanup');
      const detach = [
        game.on(window, { id: 'cleanup', owner: null, eligible: () => true, run: () => {} }),
        game.addTriggerSource({ collect: () => [] }),
        game.onClose(() => {}),
      ];
      let cleaned = 0;
      const running = game.run('invalid.query', async (ctx) => {
        ctx.defer(() => {
          for (const remove of detach) {
            remove();
            cleaned++;
          }
        });
        const writeLater = async () => {
          await Promise.resolve();
          ctx.commit(testTiming('illegal.query'), [{ kind: 'vitality', player: 'b', hp: 1 }], {});
          return {};
        };
        if (path === 'query') {
          try {
            ctx.query(() => ctx.query(writeLater)).catch(() => undefined);
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
          ctx.commit(testTiming('after.catch'), [], {});
          return;
        }
        await ctx.ask({
          ...choose(),
          ...(path === 'describe' ? { describe: writeLater } : { feedback: writeLater }),
        });
      });
      if (path === 'feedback') {
        const request = await nextRequest(game);
        expect(() => game.decisions.preview(request.id, 'yes')).toThrow('Queries cannot await');
      }
      await expect(running).rejects.toThrow('Queries cannot await');
      expect(game.status).toBe('faulted');
      expect(game.world.player('b').hp).toBe(4);
      expect(game.history.facts()).toEqual([]);
      expect(game.decisions.pending).toEqual([]);
      expect(cleaned).toBe(3);
    },
  );

  it('资格查询中写状态会冻结本局', async () => {
    const game = room();
    const window = testTiming<null>('pure');
    game.on(window, {
      id: 'bad-query',
      owner: 'a',
      eligible: (ctx) => {
        ctx.commit(testTiming('illegal'), [], {});
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
    game.on(testTiming<number>('same'), {
      id: 'one',
      owner: 'a',
      eligible: () => true,
      run: () => undefined,
    });
    expect(() =>
      game.on(testTiming<string>('same'), {
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
