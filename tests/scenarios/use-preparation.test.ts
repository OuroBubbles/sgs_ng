import { expect, it } from 'vitest';
import { damage, kill, moveCards } from '../../src/sdk';
import type { CardDefinition, Decision, UseIntent, Validation } from '../../src/sdk';
import { card, cardGame, use } from '../fixtures/cards';

it('附属选择保留原型方法和实时资格，映射后仍完整验证再支付', async () => {
  type Selection = Pick<UseIntent, 'targets' | 'parameters'>;
  class Choice implements Decision<Selection> {
    player = 'a';
    kind = 'choose-option';
    get data(): never {
      throw new Error('Dynamic descriptions must not read unused static data.');
    }
    optional = true;
    open = true;
    #label = '选择探针目标';

    get prompt() {
      return this.#label;
    }

    available() {
      return this.open;
    }

    describe() {
      return { options: [{ id: 'b', label: this.#label }], reason: 'probe:selection' };
    }

    feedback(input: unknown) {
      return { prompt: this.#label, selected: input };
    }

    validate(input: unknown): Validation<Selection> {
      return typeof input === 'string'
        ? { ok: true, value: { targets: [input], parameters: this.#label } }
        : { ok: false, reason: 'Expected a target.' };
    }
  }
  const selection = new Choice();
  const definition: CardDefinition = {
    type: 'trick',
    id: 'probe:selection',
    label: '选择探针',
    use: {
      count: { min: 1, max: 1 },
      target: (_ctx, { request, target }) => request.actor !== target,
      selection: () => selection,
      resolve: (ctx, { effect }) =>
        damage(ctx, { from: effect.actor, to: effect.target, amount: 1, nature: 'normal' }),
    },
  };
  const game = cardGame({
    hands: { a: [{ ...card('p', 'slash'), name: definition.id }] },
    definitions: [definition],
  });
  const result = await game.room.run('selection', async (ctx) => {
    const input = {
      actor: 'a',
      choice: { kind: 'physical' as const, card: 'p' },
      timing: { kind: 'effect' as const },
    };
    const decision = game.book.useSelection(ctx, input);
    expect(decision.prompt).toBe('选择探针目标');
    expect(decision.describe?.()).toEqual(selection.describe());
    expect(decision.available?.()).toBe(true);
    selection.open = false;
    expect(decision.available?.()).toBe(false);
    expect(decision.validate('b').ok).toBe(false);
    expect(game.room.world.position('p')).toBe('a:hand');
    expect(game.room.history.facts('card.used')).toEqual([]);
    selection.open = true;

    const replaced = () => {
      throw new Error('Replaced selection method must not run.');
    };
    selection.available = replaced;
    selection.describe = replaced;
    selection.feedback = replaced;
    selection.validate = replaced;
    expect(decision.describe?.()).toMatchObject({ reason: 'probe:selection' });
    expect(decision.feedback?.('b')).toEqual({ prompt: '选择探针目标', selected: 'b' });
    // 原选择允许这个值，统一用牌校验仍须拒绝自身目标。
    expect(decision.validate('a').ok).toBe(false);
    const chosen = decision.validate('b');
    if (!chosen.ok) throw new Error(chosen.reason);
    return game.book.use(ctx, { ...input, ...chosen.value });
  });
  expect(result).toMatchObject({ kind: 'resolved', value: { kind: 'used' } });
  expect(game.room.world.player('b').hp).toBe(3);
  expect(game.room.world.position('p')).toBe('discard');
  expect(game.room.history.facts('card.used')).toHaveLength(1);
});

it('准备返回的参数仍经过牌定义的最终验证，未通过不支付', async () => {
  const definition: CardDefinition = {
    type: 'trick',
    id: 'probe:prepared',
    label: '准备探针',
    use: {
      count: { min: 1, max: 1 },
      target: () => true,
      canUse: (_ctx, { request }) =>
        request.parameters === undefined || request.parameters === 'valid'
          ? null
          : 'Invalid prepared value.',
      prepare: () => ({ ok: true, value: 'invalid' }),
      resolve: () => {},
    },
  };
  const game = cardGame({
    hands: { a: [{ ...card('p', 'slash'), name: definition.id }] },
    definitions: [definition],
  });
  expect(
    await use(game, {
      actor: 'a',
      choice: { kind: 'physical', card: 'p' },
      targets: ['b'],
      timing: { kind: 'effect' },
    }),
  ).toMatchObject({ value: { kind: 'unavailable', reason: 'Invalid prepared value.' } });
  expect(game.room.world.position('p')).toBe('a:hand');
  expect(game.room.history.facts('card.used')).toHaveLength(0);
});

it('准备期间生成牌材料被移动，不能重取新位置作为原始支付位置', async () => {
  const definition: CardDefinition = {
    type: 'trick',
    id: 'probe:prepared',
    label: '准备探针',
    use: {
      count: { min: 1, max: 1 },
      target: () => true,
      resolve: () => {},
      async prepare(ctx) {
        await moveCards(
          ctx,
          [{ cards: ['material'], from: 'a:hand', to: 'd:hand', place: 'bottom' }],
          'probe:moved',
        );
        return { ok: true, value: { chosen: 'b' } };
      },
    },
  };
  const game = cardGame({ hands: { a: [card('material', 'peach')] }, definitions: [definition] });
  const result = await use(game, {
    actor: 'a',
    choice: {
      kind: 'generated',
      face: { name: definition.id },
      materials: ['material'],
      reason: 'probe',
    },
    targets: ['b'],
    timing: { kind: 'effect' },
  });
  expect(result).toMatchObject({ value: { kind: 'unavailable' } });
  expect(game.room.world.position('material')).toBe('d:hand');
  expect(game.room.history.facts('card.used')).toHaveLength(0);
  expect(game.room.world.snapshot.zones.some((zone) => zone.kind === 'processing')).toBe(false);
});

it('准备期间自动目标集合变化时拒绝宣告，不悄悄用另一组目标付费', async () => {
  const definition: CardDefinition = {
    type: 'trick',
    id: 'probe:prepared',
    label: '准备探针',
    use: {
      count: { min: 0, max: 0 },
      target: () => true,
      resolve: () => {},
      fixedTargets: (ctx) => ctx.world.snapshot.players.filter((p) => p.alive).map((p) => p.id),
      async prepare(ctx) {
        await kill(ctx, {
          player: 'b',
          killer: null,
          reason: 'rule',
          cause: { kind: 'rule', seq: null, data: null },
        });
        return { ok: true, value: null };
      },
    },
  };
  const game = cardGame({
    hands: { a: [{ ...card('p', 'slash'), name: definition.id }] },
    definitions: [definition],
  });
  expect(
    await use(game, {
      actor: 'a',
      choice: { kind: 'physical', card: 'p' },
      targets: [],
      timing: { kind: 'effect' },
    }),
  ).toMatchObject({
    value: { kind: 'unavailable', reason: 'Card or targets changed during preparation.' },
  });
  expect(game.room.world.position('p')).toBe('a:hand');
  expect(game.room.history.facts('card.used')).toHaveLength(0);
});
