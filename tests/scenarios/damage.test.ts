import { describe, expect, it } from 'vitest';
import {
  damage,
  damageCausing,
  damageInflicting,
  damageReceived,
  damageSettled,
  moveCards,
} from '../../src/sdk';
import type { DamageDraft, DamageResult } from '../../src/sdk';
import { room } from '../fixtures/room';

const input = { from: 'a', to: 'b', amount: 2, nature: 'fire' } as const;

describe('伤害领域骨架与普通代码作者能力', () => {
  it('来源快照与目标草案分开，防御阶段仍可限伤再增伤', async () => {
    const game = room();
    const captured: { draft?: DamageDraft; result?: DamageResult } = {};
    game.on(damageCausing, {
      id: 'source-plus',
      owner: 'a',
      eligible: () => true,
      run: (_ctx, draft) => {
        draft.adjust(1, 'source');
      },
    });
    game.on(damageInflicting, {
      id: 'a-lion',
      owner: 'b',
      eligible: () => true,
      run: (_ctx, draft) => {
        captured.draft = draft;
        draft.setAmount(Math.min(1, draft.amount), 'silver-lion-like cap');
      },
    });
    game.on(damageInflicting, {
      id: 'b-plus',
      owner: 'b',
      eligible: () => true,
      run: (_ctx, draft) => {
        draft.adjust(1, 'later effect');
      },
    });
    game.on(damageSettled, {
      id: 'settled',
      owner: 'b',
      eligible: () => true,
      run: (_ctx, result) => {
        captured.result = result;
      },
    });
    await game.run('hit', (ctx) => damage(ctx, input));
    expect(game.world.player('b').hp).toBe(2);
    expect(captured.result).toMatchObject({
      kind: 'dealt',
      amount: 2,
      hpLoss: 2,
      sourceSnapshot: { amount: 3 },
      input: { amount: 2 },
    });
    expect(captured.result?.edits.map((edit) => edit.after)).toEqual([3, 1, 2]);
    expect(Object.isFrozen(captured.result?.sourceSnapshot)).toBe(true);
    expect(() => captured.draft?.adjust(1, 'late')).toThrow();
  });

  it('受伤后嵌套反击与移牌完整结束，外层 damage 才返回', async () => {
    const game = room();
    const order: string[] = [];
    game.on(damageReceived, {
      id: 'counter',
      owner: 'b',
      eligible: (_ctx, result) => result.input.to === 'b',
      run: async (ctx) => {
        order.push('counter');
        await damage(ctx, { ...input, from: 'b', to: 'a', amount: 1 });
        for (const card of ['a1', 'a2'])
          await moveCards(
            ctx,
            [{ cards: [card], from: 'a:hand', to: 'b:hand', place: 'bottom' }],
            'ordinary loop',
          );
        order.push('counter done');
      },
    });
    await game.run('hit', async (ctx) => {
      await damage(ctx, input);
      order.push('outer done');
    });
    expect(order).toEqual(['counter', 'counter done', 'outer done']);
    expect(game.world.player('a').hp).toBe(3);
    expect(game.world.player('b').hp).toBe(2);
    expect(game.world.zone('a:hand').cards).toEqual([]);
    expect(game.world.zone('b:hand').cards).toEqual(['b1', 'a1', 'a2']);
    expect(game.history.facts().map((fact) => fact.data.kind)).toEqual([
      'damage.dealt',
      'damage.dealt',
      'cards.moved',
      'cards.moved',
    ]);
  });

  it.each(['prevent', 'zero'] as const)(
    '%s 不触发受伤后效果，但保留独立结果和收束窗口',
    async (kind) => {
      const game = room();
      const received: DamageResult[] = [];
      const settled: DamageResult[] = [];
      game.on(damageInflicting, {
        id: 'defend',
        owner: 'b',
        eligible: () => true,
        run: (_ctx, draft) => {
          if (kind === 'prevent') draft.prevent('immune');
          else draft.setAmount(0, 'reduce');
        },
      });
      game.on(damageReceived, {
        id: 'receive',
        owner: 'b',
        eligible: () => true,
        run: (_ctx, result) => {
          received.push(result);
        },
      });
      game.on(damageSettled, {
        id: 'settle',
        owner: 'b',
        eligible: () => true,
        run: (_ctx, result) => {
          settled.push(result);
        },
      });
      await game.run('hit', (ctx) => damage(ctx, input));
      expect(game.world.player('b').hp).toBe(4);
      expect(received).toEqual([]);
      expect(settled[0]?.kind).toBe(kind === 'prevent' ? 'prevented' : 'zero');
      expect(game.history.facts('damage.dealt')).toEqual([]);
    },
  );

  it('纯资格查询不能偷偷修改伤害草案', async () => {
    const game = room();
    game.on(damageCausing, {
      id: 'bad',
      owner: 'a',
      eligible: (_ctx, draft) => {
        draft.adjust(1, 'bad query');
        return true;
      },
      run: () => undefined,
    });
    await expect(game.run('hit', (ctx) => damage(ctx, input))).rejects.toThrow('Pure queries');
    expect(game.world.player('b').hp).toBe(4);
  });

  it('来源死亡不让已经产生的伤害被通用运行时吞掉', async () => {
    const game = room();
    await game.run('legacy', async (ctx) => {
      ctx.commit('source.died', [{ kind: 'vitality', player: 'a', hp: 0, alive: false }], {});
      await damage(ctx, input);
    });
    expect(game.world.player('b').hp).toBe(2);
    expect(game.history.facts('damage.dealt')).toHaveLength(1);
  });
});
