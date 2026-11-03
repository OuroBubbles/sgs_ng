import { testTiming } from '../fixtures/timing';
import { describe, expect, it } from 'vitest';
import {
  defineSkill,
  on,
  SkillBook,
  skillEffective,
  blockSkill,
  withLifetime,
  defineState,
  readState,
  setState,
  Lifetime,
} from '../../src/sdk';
import type { Context, SkillHandle, Trigger, TriggerOccurrence } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';
import { room, worldSeed } from '../fixtures/room';

const general = { kind: 'general', id: 'general:a' } as const;
const equipment = { kind: 'equipment', id: 'equipment:1' } as const;

describe('技能实例与独立授予来源', () => {
  it('自定义技能绑定保留原型身份和方法，有限次数及组序正常结算', async () => {
    const game = room();
    const window = testTiming<null>('test.bound-method', ['before', 'main']);
    class Bound implements Trigger<unknown> {
      #self: SkillHandle;
      #count = 2;

      constructor(self: SkillHandle) {
        this.#self = self;
      }

      get id() {
        return `${this.#self.id}:raw`;
      }

      get owner() {
        return this.#self.owner;
      }

      get group() {
        return 'before';
      }

      times() {
        return this.#count;
      }

      eligible(ctx: Context) {
        return this.#self.effective(ctx.world);
      }

      async run(ctx: Context, _payload: unknown, occurrence: TriggerOccurrence) {
        await ctx.flow('bound', (child) =>
          child.commit('probe.bound', [], {
            owner: this.#self.owner,
            index: occurrence.index,
            total: occurrence.total,
            count: this.#count++,
          }),
        );
      }
    }
    const book = new SkillBook([
      {
        id: 'test:bound-method',
        name: '绑定探针',
        triggers: [{ id: 'raw', window, bind: (self) => new Bound(self) }],
      },
    ]);
    book.attach(game);
    game.on(window, {
      id: 'main',
      owner: null,
      eligible: () => true,
      run: (ctx) => ctx.commit('probe.main', [], null),
    });
    await game.run('bound-method', async (ctx) => {
      await book.grant(ctx, { owner: 'a', skill: 'test:bound-method', source: general });
      await ctx.window(window, null);
    });
    expect(game.history.facts('probe.bound').map((fact) => fact.data.detail)).toEqual([
      { owner: 'a', index: 1, total: 2, count: 2 },
      { owner: 'a', index: 2, total: 2, count: 3 },
    ]);
    expect(
      game.history
        .facts()
        .slice(-3)
        .map((fact) => fact.data.kind),
    ).toEqual(['probe.bound', 'probe.bound', 'probe.main']);
    expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
  });

  it('失去最后来源再获得产生新实例，开窗候选不会借新身份复活', async () => {
    const game = room();
    const window = testTiming<null>('test.regain');
    const hits: string[] = [];
    const book = new SkillBook([
      defineSkill({
        id: 'test:skill',
        name: 'test',
        triggers: [
          on(window, {
            locked: true,
            id: 'run',
            effect: (_ctx, _event, self) => {
              hits.push(self.id);
            },
          }),
        ],
      }),
    ]);
    book.attach(game);
    let previous = '';
    await game.run('grant', async (ctx) => {
      await book.grant(ctx, { owner: 'b', skill: 'test:skill', source: general });
      previous = ctx.world.snapshot.skills[0]?.id ?? '';
    });
    game.on(window, {
      id: 'regain',
      owner: 'a',
      eligible: () => true,
      run: async (ctx) => {
        const previousHandle = book.binding(ctx.world, previous)!.self;
        expect(previousHandle.effective(ctx.world)).toBe(true);
        await book.revoke(ctx, 'b', 'test:skill', general);
        expect(previousHandle.effective(ctx.world)).toBe(false);
        await book.grant(ctx, { owner: 'b', skill: 'test:skill', source: general });
        expect(previousHandle.effective(ctx.world)).toBe(false);
      },
    });
    await game.run('window', (ctx) => ctx.window(window, null));
    expect(hits).toEqual([]);
    expect(game.world.snapshot.skills[0]?.id).not.toBe(previous);
  });

  it('开窗期间新获得的技能从下一窗口参与', async () => {
    const game = room();
    const window = testTiming<null>('test.gain');
    const hits: string[] = [];
    const book = new SkillBook([
      defineSkill({
        id: 'test:new',
        name: 'new',
        triggers: [
          on(window, {
            locked: true,
            id: 'hit',
            effect: () => {
              hits.push('new');
            },
          }),
        ],
      }),
    ]);
    book.attach(game);
    game.on(window, {
      id: 'grant',
      owner: 'a',
      eligible: () => true,
      run: async (ctx) => {
        await book.grant(ctx, { owner: 'b', skill: 'test:new', source: general });
      },
    });
    await game.run('one', (ctx) => ctx.window(window, null));
    expect(hits).toEqual([]);
    await game.run('two', (ctx) => ctx.window(window, null));
    expect(hits).toEqual(['new']);
  });

  it('多来源授予、开关和撤销保持同一实例与单次触发，句柄按实际 World 查询', async () => {
    const game = room();
    const other = room();
    const window = testTiming<null>('test.skill');
    const hits: string[] = [];
    const trigger = on(window, {
      locked: true,
      effect: (_ctx, _event, self) => {
        hits.push(self.id);
      },
    });
    expect(() => on(window, { locked: true, id: '', effect: () => {} })).toThrow(
      'Trigger requires an ID.',
    );
    expect(
      () => new SkillBook([{ id: 'duplicate', name: '重复', triggers: [trigger, trigger] }]),
    ).toThrow('[duplicate] Duplicate trigger ID: test.skill.');
    const book = new SkillBook([
      defineSkill({ id: 'test:skill', name: 'test', triggers: [trigger] }),
    ]);
    book.attach(game);
    book.attach(other);
    try {
      await game.run('toggle', async (ctx) => {
        await book.grant(ctx, { owner: 'a', skill: 'test:skill', source: general });
        await book.grant(ctx, { owner: 'a', skill: 'test:skill', source: equipment });
        const id = ctx.world.snapshot.skills[0]!.id;
        const handle = book.binding(ctx.world, id)!.self;
        expect(ctx.world.snapshot.skills).toHaveLength(1);
        expect(other.world.snapshot.skills).toEqual([]);
        expect(handle.effective(other.world)).toBe(false);

        // 两局刻意使用相同规则 ID，句柄必须查询实际传入的 World。
        await other.run('grant', (at) =>
          book.grant(at, { owner: 'a', skill: 'test:skill', source: general }),
        );
        expect(other.world.snapshot.skills[0]!.id).toBe(id);
        const otherHandle = book.binding(other.world, id)!.self;
        expect(handle.effective(other.world)).toBe(true);

        await book.setEnabled(ctx, 'a', 'test:skill', general, false);
        expect(skillEffective(ctx.world, id)).toBe(true);
        expect(handle.effective(ctx.world)).toBe(true);
        await book.setEnabled(ctx, 'a', 'test:skill', equipment, false);
        expect(skillEffective(ctx.world, id)).toBe(false);
        expect(handle.effective(ctx.world)).toBe(false);
        expect(otherHandle.effective(other.world)).toBe(true);
        expect(otherHandle.effective(ctx.world)).toBe(false);
        await ctx.window(window, null);
        expect(hits).toEqual([]);

        await book.setEnabled(ctx, 'a', 'test:skill', general, true);
        expect(skillEffective(ctx.world, id)).toBe(true);
        expect(handle.effective(ctx.world)).toBe(true);

        await book.setEnabled(ctx, 'a', 'test:skill', equipment, true);
        await ctx.window(window, null);
        await book.revoke(ctx, 'a', 'test:skill', general);
        await ctx.window(window, null);
      });
      expect(hits).toHaveLength(2);
      expect(hits[0]).toBe(hits[1]);
      expect(game.world.snapshot.skills[0]?.grants).toHaveLength(1);
      expect(game.world.snapshot.skills[0]?.grants[0]?.source).toEqual(equipment);
    } finally {
      game.abort('test cleanup');
      other.abort('test cleanup');
    }
  });

  it('重复授予同来源幂等，未知定义不留下半注册实例', async () => {
    const game = room();
    const book = new SkillBook([defineSkill({ id: 'test:skill', name: 'test', triggers: [] })]);
    book.attach(game);
    await game.run('grant', async (ctx) => {
      await book.grant(ctx, { owner: 'a', skill: 'test:skill', source: general });
      await book.grant(ctx, { owner: 'a', skill: 'test:skill', source: general });
    });
    expect(game.history.facts('skill.changed')).toHaveLength(1);
    await expect(
      game.run('unknown', (ctx) =>
        book.grant(ctx, { owner: 'a', skill: 'missing', source: general }),
      ),
    ).rejects.toThrow('Unknown skill');
    expect(game.world.snapshot.skills).toHaveLength(1);
  });

  it('死亡角色的常规效果不参与，显式死亡后效果仍可运行', async () => {
    const game = room();
    const window = testTiming<null>('death');
    const hits: string[] = [];
    const book = new SkillBook([
      defineSkill({
        id: 'test:skill',
        name: 'test',
        triggers: [
          on(window, {
            locked: true,
            id: 'ordinary',
            effect: () => {
              hits.push('ordinary');
            },
          }),
          on(window, {
            locked: true,
            id: 'legacy',
            allowDead: true,
            effect: () => {
              hits.push('legacy');
            },
          }),
        ],
      }),
    ]);
    book.attach(game);
    await game.run('death', async (ctx) => {
      await book.grant(ctx, { owner: 'a', skill: 'test:skill', source: general });
      ctx.commit('death', [{ kind: 'vitality', player: 'a', hp: 0, alive: false }], {});
      await ctx.window(window, null);
    });
    expect(hits).toEqual(['legacy']);
  });
});

describe('显式生存期、状态与授予到期', () => {
  it('状态初值与写入校验同一份快照，getter 不会在校验后重新读取', async () => {
    const game = room();
    let reads = 0;
    const input = {
      get amount() {
        return ++reads === 1 ? 1 : -1;
      },
    };
    const key = defineState('test:snapshot', input, (value): value is { amount: number } => {
      if (!value || typeof value !== 'object' || !('amount' in value)) return false;
      const amount = value.amount;
      return Number.isSafeInteger(amount) && Number(amount) >= 0;
    });
    expect(key.initial.amount).toBe(1);
    expect(reads).toBe(1);

    reads = 0;
    const target = { owner: 'a', source: null, lifetime: null };
    await game.run('state', (ctx) => {
      setState(ctx, key, target, input);
      expect(reads).toBe(1);
      expect(readState(ctx.world, key, target).amount).toBe(1);
    });
    expect(input.amount).toBe(-1);
    expect(readState(game.world, key, target).amount).toBe(1);
    expect(game.status).toBe('ready');
    expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
  });

  it('复杂状态读取在类型和运行时都深只读，外部输入修改不影响已提交值', async () => {
    const game = room();
    const key = defineState(
      'test:cards',
      { cards: [] as string[] },
      (value): value is { cards: string[] } =>
        value !== null &&
        typeof value === 'object' &&
        'cards' in value &&
        Array.isArray(value.cards) &&
        value.cards.every((id) => typeof id === 'string'),
    );
    await game.run('state', (ctx) =>
      withLifetime(ctx, 'turn', (turn, lifetime) => {
        const target = { owner: 'a', source: 'state', lifetime };
        const input = { cards: ['a1'] };
        setState(turn, key, target, input);
        input.cards.push('a2');
        const snapshot = readState(turn.world, key, target);
        expect(snapshot.cards).toEqual(['a1']);
        // @ts-expect-error 内容不能把读取状态赋给可变数组。
        const mutable: string[] = snapshot.cards;
        expect(() => mutable.push('a2')).toThrow();
      }),
    );
  });
  const marker = defineState(
    'test:marker',
    0,
    (value): value is number => typeof value === 'number' && Number.isSafeInteger(value),
  );

  it('阶段中止仍原子清除临时状态和授予，永久来源保留', async () => {
    const game = room();
    const book = new SkillBook([defineSkill({ id: 'test:skill', name: 'test', triggers: [] })]);
    book.attach(game);
    await game.run('turn', async (ctx) => {
      await book.grant(ctx, { owner: 'a', skill: 'test:skill', source: general });
      await withLifetime(ctx, 'phase', async (phase, lifetime) => {
        await book.grant(phase, { owner: 'a', skill: 'test:skill', source: equipment, lifetime });
        setState(phase, marker, { owner: 'a', source: 'effect', lifetime }, 7);
        phase.abort('phase skipped');
      });
      expect(ctx.world.snapshot.states).toEqual([]);
      expect(ctx.world.snapshot.skills[0]?.grants.map((grant) => grant.source)).toEqual([general]);
    });
    expect(rebuildWorld(worldSeed(), game.history.facts())).toEqual(game.world.snapshot);
  });

  it('临时技能失效到期恢复；已经执行的技能不会被隐式倒放', async () => {
    const game = room();
    const window = testTiming<null>('blocked');
    const hits: string[] = [];
    const book = new SkillBook([
      defineSkill({
        id: 'test:skill',
        name: 'test',
        triggers: [
          on(window, {
            locked: true,
            id: 'run',
            effect: () => {
              hits.push('hit');
            },
          }),
        ],
      }),
    ]);
    book.attach(game);
    await game.run('turn', async (ctx) => {
      await book.grant(ctx, { owner: 'a', skill: 'test:skill', source: general });
      await withLifetime(ctx, 'phase', async (phase, lifetime) => {
        blockSkill(phase, phase.world.snapshot.skills[0]?.id ?? '', lifetime);
        await phase.window(window, null);
      });
      await ctx.window(window, null);
    });
    expect(hits).toEqual(['hit']);
  });

  it('技能失去不一刀切删除其已产生的独立状态', async () => {
    const game = room();
    const book = new SkillBook([defineSkill({ id: 'test:skill', name: 'test', triggers: [] })]);
    book.attach(game);
    await game.run('turn', (ctx) =>
      withLifetime(ctx, 'turn', async (turn, lifetime) => {
        await book.grant(turn, { owner: 'a', skill: 'test:skill', source: general });
        const source = turn.world.snapshot.skills[0]?.id ?? '';
        const target = { owner: 'a', source, lifetime };
        setState(turn, marker, target, 9);
        await book.revoke(turn, 'a', 'test:skill', general);
        expect(readState(turn.world, marker, target)).toBe(9);
      }),
    );
    expect(game.world.snapshot.states).toEqual([]);
  });

  it('额外阶段有新生存期身份，且不能向已经结束的生存期写状态', async () => {
    const game = room();
    const lifetimes: Lifetime[] = [];
    await game.run('turn', async (ctx) => {
      for (let i = 0; i < 2; i++)
        await withLifetime(ctx, 'phase', (phase, lifetime) => {
          lifetimes.push(lifetime);
          setState(phase, marker, { owner: 'a', source: null, lifetime }, i);
        });
      const old = lifetimes[0];
      if (!old) throw new Error('Expected lifetime.');
      expect(() => setState(ctx, marker, { owner: 'a', source: null, lifetime: old }, 1)).toThrow(
        'closed or outside',
      );
    });
    expect(lifetimes[0]?.id).not.toBe(lifetimes[1]?.id);
    expect(lifetimes.every((lifetime) => !lifetime.active)).toBe(true);
  });

  it('到期后效不能重新将状态绑定到刚结束的生存期', async () => {
    const game = room();
    let lifetime: Lifetime | undefined;
    game.on(Lifetime.ended, {
      id: 'late',
      owner: 'a',
      eligible: () => true,
      run: (ctx) => {
        if (!lifetime) throw new Error('Expected lifetime.');
        const endedLifetime = lifetime;
        expect(() =>
          setState(ctx, marker, { owner: 'a', source: null, lifetime: endedLifetime }, 1),
        ).toThrow('closed or outside');
      },
    });
    await game.run('turn', (ctx) =>
      withLifetime(ctx, 'phase', (_phase, current) => {
        lifetime = current;
      }),
    );
    expect(game.world.snapshot.states).toEqual([]);
  });

  it('资格查询不能写入临时状态', async () => {
    const game = room();
    const window = testTiming<null>('pure-state');
    await expect(
      game.run('turn', (ctx) =>
        withLifetime(ctx, 'turn', async (turn, lifetime) => {
          turn.defer(
            game.on(window, {
              id: 'bad',
              owner: 'a',
              eligible: (query) => {
                setState(query, marker, { owner: 'a', source: null, lifetime }, 1);
                return true;
              },
              run: () => undefined,
            }),
          );
          await turn.window(window, null);
        }),
      ),
    ).rejects.toThrow('Pure queries');
    expect(game.world.snapshot.states).toEqual([]);
  });

  it('即使对局和流程 ID 完全相同，也不能跨 World 使用生存期句柄', async () => {
    const a = room('same');
    const b = room('same');
    await a.run('turn', (outer) =>
      withLifetime(outer, 'phase', async (_phase, foreign) => {
        await b.run('turn', (inner) =>
          withLifetime(inner, 'phase', (local, lifetime) => {
            expect(lifetime.id).toBe(foreign.id);
            expect(() =>
              setState(local, marker, { owner: 'a', source: null, lifetime: foreign }, 1),
            ).toThrow('closed or outside');
            expect(() =>
              readState(local.world, marker, { owner: 'a', source: null, lifetime: foreign }),
            ).toThrow('another World');
          }),
        );
      }),
    );
    expect(a.world.snapshot.states).toEqual([]);
    expect(b.world.snapshot.states).toEqual([]);
  });
});
