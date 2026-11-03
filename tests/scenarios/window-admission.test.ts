import { expect, it } from 'vitest';
import {
  defineWindow,
  defineSkill,
  on,
  draw,
  damage,
  damageReceived,
  kill,
  invoke,
} from '../../src/sdk';
import type { Trigger, TriggerSource, WindowType, WindowRef } from '../../src/sdk';
import { room, nextRequest, choose } from '../fixtures/room';
import { card, cardGame } from '../fixtures/cards';
import { rebuildWorld } from '../../src/core/history/rebuild';

function dynamic(
  type: WindowType<unknown>,
  read: () => readonly Trigger<unknown>[],
): TriggerSource {
  return { collect: (window) => (window === type ? read() : []) };
}
function effect(
  id: string,
  run: Trigger<unknown>['run'],
  owner: string | null = 'a',
  group = 'main',
): Trigger<unknown> {
  return { id, owner, group, eligible: () => true, run };
}
const grantSource = { kind: 'general', id: 'test' } as const;

it.each([false, true])('默认不自动发现新候选，显式加入=%s 时当前窗口才执行', async (include) => {
  const game = room();
  const window = defineWindow<null>('admit.default');
  const seen: string[] = [];
  let current: Trigger<unknown>[] = [];
  const source = dynamic(window, () => current);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('0-create', () => {}),
    run(ctx) {
      current = [
        effect('new', () => {
          seen.push('new');
        }),
      ];
      if (include) expect(ctx.include(ctx.windowOf(window)!, source).added).toEqual(['new']);
      seen.push('returned');
    },
  });
  await game.run('first', (ctx) => ctx.window(window, null));
  expect(seen).toEqual(include ? ['returned', 'new'] : ['returned']);
});

it('最后一个旧候选补入当前席位，不因旧 pending 已空而丢失新队列', async () => {
  const game = room();
  const window = defineWindow<null>('admit.last');
  const seen: string[] = [];
  let current: Trigger<unknown>[] = [];
  const source = dynamic(window, () => current);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('last', () => {}),
    run(ctx) {
      current = [
        effect('a-before-lexically', () => {
          seen.push('new');
        }),
      ];
      const result = ctx.include(ctx.windowOf(window)!, source);
      expect(Object.isFrozen(result.added)).toBe(true);
      expect(Object.isFrozen(result.skipped)).toBe(true);
      seen.push('old-finished');
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null));
  expect(seen).toEqual(['old-finished', 'new']);
  expect(game.history.entries.filter((entry) => entry.type === 'window.included')).toHaveLength(1);
});

it.each([0, 2])('同一候选的 %s 次数只在首次入队读取，处理后再次加入也不刷新次数', async (total) => {
  const game = room();
  const window = defineWindow<null>('admit.count');
  const seen: number[] = [];
  let count = total,
    reads = 0;
  const source = dynamic(window, () => [
    {
      ...effect('repeat', (_ctx, _payload, occurrence) => {
        seen.push(occurrence.index);
      }),
      times: () => {
        reads++;
        return count;
      },
    },
  ]);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('inject', () => {}, 'b'),
    run(ctx) {
      count = 9;
      expect(ctx.include(ctx.windowOf(window)!, source)).toEqual({
        state: 'open',
        added: [],
        skipped: [{ id: 'repeat', reason: 'known' }],
      });
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null));
  expect(reads).toBe(1);
  expect(seen).toEqual(total === 0 ? [] : [1, 2]);
});

it('当前组/席位可加入，过去的组/席位不倒转，后续组仍按固定座次执行', async () => {
  const game = room();
  const window = defineWindow<null>('admit.cursor', ['before', 'main', 'after']);
  const seen: string[] = [];
  let current: Trigger<unknown>[] = [];
  const source = dynamic(window, () => current);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('inject', () => {}, 'b'),
    run(ctx) {
      current = [
        effect(
          'past-group',
          () => {
            seen.push('bad');
          },
          'c',
          'before',
        ),
        effect(
          'past-null',
          () => {
            seen.push('bad');
          },
          null,
        ),
        effect('past-a', () => {
          seen.push('bad');
        }),
        effect(
          'current-b',
          () => {
            seen.push('b');
          },
          'b',
        ),
        effect(
          'future-c',
          () => {
            seen.push('c');
          },
          'c',
        ),
        effect(
          'future-group-a',
          () => {
            seen.push('after-a');
          },
          'a',
          'after',
        ),
      ];
      const result = ctx.include(ctx.windowOf(window)!, source);
      expect(result.added).toEqual(['current-b', 'future-c', 'future-group-a']);
      expect(result.skipped.map((entry) => entry.reason)).toEqual(['past', 'past', 'past']);
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null));
  expect(seen).toEqual(['b', 'c', 'after-a']);
});

it('显式锚点固定本次游标，后注册来源不会重排已经经过的行动序', async () => {
  const game = room();
  const window = defineWindow<null>('admit.anchor');
  let current: Trigger<unknown>[] = [];
  const seen: string[] = [];
  const source = dynamic(window, () => current);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('inject', () => {}, 'c'),
    run(ctx) {
      current = ['a', 'b', 'c'].map((owner) =>
        effect(
          owner,
          () => {
            seen.push(owner);
          },
          owner,
        ),
      );
      expect(ctx.include(ctx.windowOf(window)!, source).skipped).toEqual([
        { id: 'b', reason: 'past' },
      ]);
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null, { anchor: 'b' }));
  expect(seen).toEqual(['c', 'a']);
});

it('新自动项先执行，新的可选项与既有可选项继续共用正式排序决策', async () => {
  const game = room();
  const window = defineWindow<null>('admit.order');
  const seen: string[] = [];
  let current: Trigger<unknown>[] = [];
  const source = dynamic(window, () => current);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('0-inject', () => {}),
    run(ctx) {
      current = [
        effect('z-auto', () => {
          seen.push('auto');
        }),
        {
          ...effect('new-choice', () => {
            seen.push('new');
          }),
          order: 'choose',
        },
      ];
      ctx.include(ctx.windowOf(window)!, source);
    },
  });
  game.on(window, {
    ...effect('old-choice', () => {
      seen.push('old');
    }),
    order: 'choose',
  });
  const running = game.run('window', (ctx) => ctx.window(window, null));
  const request = await nextRequest(game);
  expect(request.kind).toBe('trigger-order');
  expect(seen).toEqual(['auto']);
  expect(game.decisions.submit(request.id, request.token, 'new-choice').kind).toBe('accepted');
  await running;
  expect(seen).toEqual(['auto', 'new', 'old']);
});

it('同名嵌套窗口的最近引用正确，也可从子窗口显式加入捕获的外层窗口', async () => {
  const game = room();
  const window = defineWindow<number>('admit.nested');
  let outer: WindowRef<number> | null = null;
  let born = false;
  const seen: string[] = [],
    occurrences: string[] = [];
  const source = dynamic(window, () => [
    {
      ...effect('base', async (ctx, payload) => {
        const ref = ctx.windowOf(window)!;
        expect(ref.payload).toBe(payload);
        seen.push(`base:${String(payload)}`);
        if (payload === 0) {
          outer = ref;
          await ctx.window(window, 1);
          expect(ctx.windowOf(window)).toBe(ref);
        } else {
          expect(ref).not.toBe(outer);
          born = true;
          ctx.include(ref, source);
          ctx.include(outer!, source);
        }
      }),
      times: (ctx, payload) => {
        expect(ctx.windowOf(window)?.payload).toBe(payload);
        return 1;
      },
    },
    ...(born
      ? [
          effect('born', (_ctx, payload, occurrence) => {
            seen.push(`born:${String(payload)}`);
            occurrences.push(occurrence.id);
          }),
        ]
      : []),
  ]);
  game.addTriggerSource(source);
  await game.run('window', (ctx) => ctx.window(window, 0));
  expect(seen).toEqual(['base:0', 'base:1', 'born:1', 'born:0']);
  expect(new Set(occurrences).size).toBe(2);
});

it('原窗口关闭后的引用不能在新根流程、新窗口或另一局重用，伪造同 ID 也不行', async () => {
  const game = room(),
    other = room('other');
  const window = defineWindow<null>('admit.closed');
  const source = dynamic(window, () => []);
  game.addTriggerSource(source);
  other.addTriggerSource(source);
  let saved: WindowRef<null> | null = null;
  game.on(window, {
    ...effect('capture', () => {}),
    run(ctx) {
      const ref = ctx.windowOf(window)!;
      if (!saved) saved = ref;
      else expect(() => ctx.include(saved!, source)).toThrow('closed or is not an ancestor');
      expect(() => ctx.include({ ...ref }, source)).toThrow('closed or is not an ancestor');
    },
  });
  await game.run('first', (ctx) => ctx.window(window, null));
  await game.run('next', async (ctx) => {
    expect(ctx.windowOf(window)).toBeNull();
    expect(() => ctx.include(saved!, source)).toThrow('closed or is not an ancestor');
    await ctx.window(window, null);
  });
  await other.run('other', (ctx) =>
    expect(() => ctx.include(saved!, source)).toThrow('closed or is not an ancestor'),
  );
});

it('纯查询、投影和等待子流程的父 Context 不能改队列，合法子流程完成后可正常加入', async () => {
  const game = room();
  const window = defineWindow<null>('admit.context');
  let current: Trigger<unknown>[] = [];
  const source = dynamic(window, () => current);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('inject', () => {}),
    async run(ctx) {
      const ref = ctx.windowOf(window)!;
      expect(() => ctx.query(() => ctx.include(ref, source))).toThrow('Pure queries');
      expect(() => game.inspect((read) => read.include(ref, source))).toThrow('read-only');
      const waiting = ctx.flow('wait', (child) => child.ask(choose()));
      expect(() => ctx.include(ref, source)).toThrow('waiting');
      await waiting;
      current = [effect('valid', () => {})];
      expect(ctx.include(ref, source).added).toEqual(['valid']);
    },
  });
  const running = game.run('window', (ctx) => ctx.window(window, null));
  const request = await nextRequest(game);
  expect(game.decisions.submit(request.id, request.token, 'yes').kind).toBe('accepted');
  await running;
});

it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  '非法次数 %s 导致整批加入失败，先前合法项也未入队',
  async (count) => {
    const game = room();
    const window = defineWindow<null>('admit.atomic');
    const seen: string[] = [];
    let current: Trigger<unknown>[] = [];
    const source = dynamic(window, () => current);
    game.addTriggerSource(source);
    game.on(window, {
      ...effect('inject', () => {}),
      run(ctx) {
        const good = effect('good', () => {
          seen.push('good');
        });
        current = [
          good,
          {
            ...effect('bad', () => {
              seen.push('bad');
            }),
            times: () => count,
          },
        ];
        expect(() => ctx.include(ctx.windowOf(window)!, source)).toThrow('Trigger times');
        current = [good];
        expect(ctx.include(ctx.windowOf(window)!, source).added).toEqual(['good']);
      },
    });
    await game.run('window', (ctx) => ctx.window(window, null));
    expect(seen).toEqual(['good']);
  },
);

it('未挂接来源不可加入；重复批内 ID、错误组/席位、非布尔筛选均不修改队列', async () => {
  const game = room();
  const window = defineWindow<null>('admit.validation');
  let current: Trigger<unknown>[] = [];
  const source = dynamic(window, () => current),
    unattached = dynamic(window, () => []);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('inject', () => {}),
    run(ctx) {
      const ref = ctx.windowOf(window)!;
      expect(() => ctx.include(ref, unattached)).toThrow('not attached');
      current = [effect('same', () => {}), effect('same', () => {})];
      expect(() => ctx.include(ref, source)).toThrow('Duplicate window candidate ID');
      current = [effect('bad', () => {}, 'a', 'missing')];
      expect(() => ctx.include(ref, source)).toThrow('Unknown window group');
      current = [effect('bad', () => {}, 'missing')];
      expect(() => ctx.include(ref, source)).toThrow();
      current = [effect('bad', () => {})];
      expect(() => ctx.include(ref, source, () => undefined as unknown as boolean)).toThrow(
        'must return a boolean',
      );
      current = [effect('valid', () => {})];
      expect(ctx.include(ref, source).added).toEqual(['valid']);
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null));
});

it('来源不同但候选 ID 冲突必须报错，同一来源已经处理的 ID 则明确跳过', async () => {
  const game = room();
  const window = defineWindow<null>('admit.collision');
  const first = dynamic(window, () => [{ ...effect('same', () => {}), times: () => 0 }]);
  let current: Trigger<unknown>[] = [];
  const second = dynamic(window, () => current);
  game.addTriggerSource(first);
  game.addTriggerSource(second);
  game.on(window, {
    ...effect('inject', () => {}),
    run(ctx) {
      current = [effect('same', () => {})];
      expect(() => ctx.include(ctx.windowOf(window)!, second)).toThrow('belongs to another source');
      expect(ctx.include(ctx.windowOf(window)!, first).skipped).toEqual([
        { id: 'same', reason: 'known' },
      ]);
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null));
});

it('新选择 ID 不能复用已有 occurrence ID，即使旧项已经执行完成', async () => {
  const game = room();
  const window = defineWindow<null>('admit.occurrence');
  let current: Trigger<unknown>[] = [];
  const first = dynamic(window, () => [{ ...effect('A', () => {}), times: () => 1 }]);
  const second = dynamic(window, () => current);
  game.addTriggerSource(first);
  game.addTriggerSource(second);
  game.on(window, {
    ...effect('inject', () => {}, 'b'),
    run(ctx) {
      current = [effect(JSON.stringify(['A', 1]), () => {}, 'b')];
      expect(() => ctx.include(ctx.windowOf(window)!, second)).toThrow(
        'Duplicate window occurrence ID',
      );
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null));
});

it('加入后卸载/同对象重新登记不复活旧候选；同 ID 当前窗口不再接纳，下次窗口可执行', async () => {
  const game = room();
  const window = defineWindow<null>('admit.registration');
  let current: Trigger<unknown>[] = [],
    first = true;
  let seen = 0;
  const source = dynamic(window, () => current);
  let detach = game.addTriggerSource(source);
  game.on(window, {
    ...effect('0-inject', () => {}),
    run(ctx) {
      if (!first) return;
      first = false;
      current = [
        effect('new', () => {
          seen++;
        }),
      ];
      ctx.include(ctx.windowOf(window)!, source);
      detach();
      detach = game.addTriggerSource(source);
      expect(ctx.include(ctx.windowOf(window)!, source).skipped).toEqual([
        { id: 'new', reason: 'known' },
      ]);
    },
  });
  await game.run('first', (ctx) => ctx.window(window, null));
  expect(seen).toBe(0);
  await game.run('second', (ctx) => ctx.window(window, null));
  expect(seen).toBe(1);
  detach();
});

it('窗口 active 已为 false 时拒绝加入，不收集来源，也不读取新次数', async () => {
  const game = room();
  const window = defineWindow<null>('admit.stopped');
  let active = true,
    collections = 0;
  const source = dynamic(window, () => {
    collections++;
    return [];
  });
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('stop', () => {}),
    run(ctx) {
      active = false;
      const result = ctx.include(ctx.windowOf(window)!, source);
      expect(result).toEqual({ state: 'stopped', added: [], skipped: [] });
      expect(Object.isFrozen(result.added)).toBe(true);
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null, { active: () => active }));
  expect(collections).toBe(1);
});

it.each([false, true])(
  '技能授予后显式加入=%s，首次伤害也可通过正常发动/摸牌处理',
  async (include) => {
    const learned = defineSkill({
      id: 'probe:learned',
      name: '新技能',
      triggers: [
        on(damageReceived, {
          id: 'draw',
          when: (_ctx, { payload: hit, self }) => hit.input.to === self.owner,
          async run(ctx, { self }) {
            await draw(ctx, { player: self.owner, count: 1, reason: self.skill });
          },
        }),
      ],
    });
    const game = cardGame({ skills: [learned], hands: { b: [] }, draw: [card('reward', 'jink')] });
    game.room.on(damageReceived, {
      ...effect('0-learn', () => {}, 'b'),
      async run(ctx) {
        const change = await game.skills.grant(ctx, {
          owner: 'b',
          skill: learned.id,
          source: grantSource,
        });
        if (include)
          expect(
            game.skills.include(ctx, ctx.windowOf(damageReceived)!, [change.after!.id]).added,
          ).toHaveLength(1);
      },
    });
    await game.room.run('damage', (ctx) =>
      damage(ctx, { from: 'a', to: 'b', amount: 1, nature: 'normal' }),
    );
    expect(game.room.world.zone('b:hand').cards).toEqual(include ? ['reward'] : []);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  },
);

it('新候选的次数在加入时冻结，自己的后效再次 include 不追加剩余次数', async () => {
  const game = room();
  const window = defineWindow<null>('admit.new-times');
  let current: Trigger<unknown>[] = [],
    total = 3,
    reads = 0;
  const seen: number[] = [];
  const source = dynamic(window, () => current);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('inject', () => {}),
    run(ctx) {
      current = [
        {
          ...effect('repeat', (at, _payload, occurrence) => {
            seen.push(occurrence.index);
            total = 20;
            expect(at.include(at.windowOf(window)!, source).added).toEqual([]);
          }),
          times: () => {
            reads++;
            return total;
          },
        },
      ];
      ctx.include(ctx.windowOf(window)!, source);
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null));
  expect(reads).toBe(1);
  expect(seen).toEqual([1, 2, 3]);
});

it('新增候选子流程正常中止只消费当前一次，剩余独立次数继续', async () => {
  const game = room();
  const window = defineWindow<null>('admit.abort');
  let current: Trigger<unknown>[] = [];
  const seen: number[] = [];
  const source = dynamic(window, () => current);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('inject', () => {}),
    run(ctx) {
      current = [
        {
          ...effect('repeat', (at, _payload, occurrence) => {
            seen.push(occurrence.index);
            if (occurrence.index === 1) at.abort('first only');
          }),
          times: () => 2,
        },
      ];
      ctx.include(ctx.windowOf(window)!, source);
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null));
  expect(seen).toEqual([1, 2]);
  expect(game.status).toBe('ready');
});

it('筛选与次数函数均在纯查询内，拒绝写入后仍能完整加入同一批', async () => {
  const game = room();
  const window = defineWindow<null>('admit.pure');
  let current: Trigger<unknown>[] = [];
  const source = dynamic(window, () => current);
  game.addTriggerSource(source);
  game.on(window, {
    ...effect('inject', () => {}),
    run(ctx) {
      const ref = ctx.windowOf(window)!;
      current = [effect('good', () => {})];
      expect(() =>
        ctx.include(ref, source, () => {
          ctx.commit('bad', [], {});
          return true;
        }),
      ).toThrow('Pure queries');
      current = [
        {
          ...effect('good', () => {}),
          times: (at) => {
            at.commit('bad', [], {});
            return 1;
          },
        },
      ];
      expect(() => ctx.include(ref, source)).toThrow('Pure queries');
      current = [effect('good', () => {})];
      expect(ctx.include(ref, source).added).toEqual(['good']);
    },
  });
  await game.run('window', (ctx) => ctx.window(window, null));
  expect(game.history.facts('bad')).toHaveLength(0);
});

it('新候选进入排序菜单后来源被卸载，旧选择不执行，其余既有候选继续', async () => {
  const game = room();
  const window = defineWindow<null>('admit.stale-choice');
  let current: Trigger<unknown>[] = [];
  const seen: string[] = [];
  const source = dynamic(window, () => current);
  const remove = game.addTriggerSource(source);
  game.on(window, {
    ...effect('0-inject', () => {}),
    run(ctx) {
      current = [
        {
          ...effect('new', () => {
            seen.push('bad');
          }),
          order: 'choose',
        },
      ];
      ctx.include(ctx.windowOf(window)!, source);
    },
  });
  game.on(window, {
    ...effect('old', () => {
      seen.push('old');
    }),
    order: 'choose',
  });
  const running = game.run('window', (ctx) => ctx.window(window, null));
  const request = await nextRequest(game);
  remove();
  expect(game.decisions.submit(request.id, request.token, 'new').kind).toBe('accepted');
  await running;
  expect(seen).toEqual(['old']);
});

it('SkillBook 的窗口专用 Provider 可按实例加入，卸载/重装不绕过旧登记资格', async () => {
  const window = defineWindow<null>('admit.provider');
  let seen = 0,
    first = true;
  const definition = defineSkill({
    id: 'probe:provided',
    name: '动态来源',
    triggers: [
      on(window, {
        id: 'count',
        run() {
          seen++;
        },
      }),
    ],
  });
  const self = {
    id: 'provided:one',
    owner: 'a',
    skill: definition.id,
    name: definition.name,
    origin: null,
    effective: () => true,
  };
  const provider = {
    collect: (_world: unknown, event?: { type: object }) =>
      event?.type === window ? [{ self, definition }] : [],
  };
  const game = cardGame();
  game.room.on(window, {
    ...effect('0-install', () => {}),
    run(ctx) {
      if (!first) return;
      first = false;
      const remove = game.skills.addProvider(provider, ctx);
      expect(game.skills.include(ctx, ctx.windowOf(window)!, [self.id]).added).toHaveLength(1);
      remove(ctx);
      game.skills.addProvider(provider, ctx);
      expect(game.skills.include(ctx, ctx.windowOf(window)!, [self.id]).skipped[0]?.reason).toBe(
        'known',
      );
    },
  });
  await game.room.run('first', (ctx) => ctx.window(window, null));
  expect(seen).toBe(0);
  await game.room.run('second', (ctx) => ctx.window(window, null));
  expect(seen).toBe(1);
});

it('授予后在执行前死亡或失去技能，新候选与普通候选一样失效', async () => {
  for (const die of [false, true]) {
    const window = defineWindow<null>('admit.skill-lost');
    let seen = 0;
    const learned = defineSkill({
      id: 'probe:short',
      name: '短暂',
      triggers: [
        on(window, {
          id: 'count',
          run() {
            seen++;
          },
        }),
      ],
    });
    const game = cardGame({ skills: [learned] });
    game.room.on(window, {
      ...effect('inject', () => {}),
      async run(ctx) {
        const change = await game.skills.grant(ctx, {
          owner: 'a',
          skill: learned.id,
          source: grantSource,
        });
        game.skills.include(ctx, ctx.windowOf(window)!, [change.after!.id]);
        if (die)
          await kill(ctx, {
            player: 'a',
            killer: null,
            reason: 'rule',
            cause: { kind: 'rule', seq: null, data: null },
          });
        else await game.skills.revoke(ctx, 'a', learned.id, grantSource);
      },
    });
    await game.room.run('window', (ctx) => ctx.window(window, null));
    expect(seen).toBe(0);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
  }
});

it('同技能真正重新授予产生新实例，可显式加入；旧实例剩余次数不复活', async () => {
  const window = defineWindow<null>('admit.new-instance');
  let replaced = false;
  const ids: string[] = [];
  const learned = defineSkill({
    id: 'probe:regain',
    name: '重授',
    triggers: [
      on(window, {
        id: 'point',
        times: () => 2,
        async run(ctx, { self }) {
          ids.push(self.id);
          if (replaced) return;
          replaced = true;
          await game.skills.revoke(ctx, self.owner, self.skill, grantSource);
          const change = await game.skills.grant(ctx, {
            owner: self.owner,
            skill: self.skill,
            source: grantSource,
          });
          expect(
            game.skills.include(ctx, ctx.windowOf(window)!, [change.after!.id]).added,
          ).toHaveLength(1);
        },
      }),
    ],
  });
  const game = cardGame({ skills: [learned] });
  await game.room.run('grant', (ctx) =>
    game.skills.grant(ctx, { owner: 'a', skill: learned.id, source: grantSource }),
  );
  await game.room.run('window', (ctx) => ctx.window(window, null));
  expect(ids).toHaveLength(3);
  expect(ids[0]).not.toBe(ids[1]);
  expect(ids[1]).toBe(ids[2]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});

it('技能选择只影响选定实例，新技能仍使用普通 invoke/pay 和同一窗口因果路径', async () => {
  const window = defineWindow<null>('admit.selected');
  const seen: string[] = [];
  const definitions = ['one', 'two'].map((id) =>
    defineSkill({
      id: `probe:${id}`,
      name: id,
      triggers: [
        on(window, {
          id: 'invoke',
          order: 'choose',
          async run(ctx, { self }) {
            if (await invoke(ctx, self, `invoke ${id}`)) seen.push(id);
          },
        }),
      ],
    }),
  );
  const game = cardGame({ skills: definitions });
  game.room.on(window, {
    ...effect('inject', () => {}),
    async run(ctx) {
      const ref = ctx.windowOf(window)!;
      const first = await game.skills.grant(ctx, {
        owner: 'a',
        skill: 'probe:one',
        source: grantSource,
      });
      await game.skills.grant(ctx, { owner: 'a', skill: 'probe:two', source: grantSource });
      expect(game.skills.include(ctx, ref, [first.after!.id]).added).toHaveLength(1);
    },
  });
  const running = game.room.run('window', (ctx) => ctx.window(window, null));
  const request = await nextRequest(game.room);
  expect(request.kind).toBe('invoke');
  expect(game.room.decisions.submit(request.id, request.token, true).kind).toBe('accepted');
  await running;
  expect(seen).toEqual(['one']);
  expect(game.room.history.facts('skill.invoked')).toHaveLength(1);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});
