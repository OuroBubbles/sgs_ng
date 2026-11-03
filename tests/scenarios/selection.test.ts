import { expect, it } from 'vitest';
import { ArrangementSelection, createContent, JointSelection, viewAs } from '../../src/sdk';
import type { ChoiceItem, Context, JointChoice, JointSelectionSpec } from '../../src/sdk';
import { nextRequest, room } from '../fixtures/room';

it('数量声明只读一次原型字段，模型使用已校验的固定范围而不冻结原对象', () => {
  class Count {
    minReads = 0;
    maxReads = 0;
    get min() {
      return ++this.minReads === 1 ? 1 : -1;
    }
    get max() {
      return ++this.maxReads === 1 ? ('all' as const) : 0;
    }
  }
  for (const kind of ['joint', 'card', 'recipe', 'arrange', 'dynamic-arrange'] as const) {
    const count = new Count();
    const expected = { min: 1, max: 'all' };
    if (kind === 'joint') {
      class Spec {
        cardReads = 0;
        countReads = 0;
        #cards = ['one'];

        get cards() {
          // eslint-disable-next-line @typescript-eslint/unbound-method -- 故意返回原方法，验证声明入口绑定原接收者。
          return ++this.cardReads === 1 ? this.readCards : () => [];
        }

        get cardCount() {
          return ++this.countReads === 1 ? count : { min: 0, max: 0 };
        }

        readCards() {
          return this.#cards;
        }
      }
      const spec = new Spec();
      const model = new JointSelection(spec);
      expect(spec.cardReads).toBe(1);
      expect(spec.countReads).toBe(1);
      expect(Object.isFrozen(spec)).toBe(false);
      expect(model.describe().cardCount).toEqual(expected);
      expect(model.validate({ cards: [], targets: [] }).ok).toBe(false);
      expect(model.validate({ cards: ['one'], targets: [] }).ok).toBe(true);
    } else if (kind === 'card') {
      const content = createContent({
        cards: [
          {
            id: 'probe:range',
            label: '范围',
            type: 'basic',
            use: { count, target: () => true, resolve: () => undefined },
          },
        ],
      });
      expect(content.cards[0]!.use!.count).toEqual(expected);
    } else if (kind === 'recipe') {
      expect(
        viewAs({
          id: 'convert',
          label: '转换',
          materials: () => ['one'],
          count,
          make: { name: 'standard:slash' },
        }).count,
      ).toEqual(expected);
    } else {
      const groups = [{ id: 'all', label: '全部', count }];
      const model = new ArrangementSelection({
        items: () => [{ id: 'one', label: 'one' }],
        groups: kind === 'arrange' ? groups : () => groups,
      });
      expect(model.initial()).toEqual({ groups: [{ id: 'all', items: ['one'] }] });
    }
    expect(count.minReads).toBe(1);
    expect(count.maxReads).toBe(1);
    expect(Object.isFrozen(count)).toBe(false);
  }
});

it('选择与候选中的空槽不算真实选项，也不能形成可提交的联合选择', () => {
  let cards = ['card'];
  const model = new JointSelection({
    cards: () => cards,
    cardCount: { min: 1, max: 1 },
    targets: () => ['target'],
    targetCount: { min: 1, max: 1 },
  });
  for (const field of ['cards', 'targets'] as const) {
    const choice = { cards: ['card'], targets: ['target'], [field]: new Array<string>(1) };
    expect(model.validate(choice).ok).toBe(false);
    expect(model.inspect(choice).complete).toBe(false);
  }
  expect(model.validate({ cards: ['card'], targets: ['target'] }).ok).toBe(true);
  cards = new Array<string>(1);
  expect(() => model.available()).toThrow('Candidates require distinct stable IDs.');
});

it('联合、分组、牌目标与转换的静态数量使用同一整数范围契约', () => {
  for (const count of [
    { min: -1, max: 1 },
    { min: 1, max: 0 },
    { min: 0.5, max: 1 },
    { min: 0, max: 1.2 },
    { min: 0, max: Number.POSITIVE_INFINITY },
    { min: 0, max: Number.MAX_SAFE_INTEGER + 1 },
    { min: Number.NaN, max: 'all' as const },
  ]) {
    expect(() => new JointSelection({ cards: () => [], cardCount: count })).toThrow(
      /Invalid .* count/,
    );
    expect(
      () =>
        new ArrangementSelection({
          items: () => [],
          groups: [{ id: 'all', label: '全部', count }],
        }),
    ).toThrow(/Invalid .* count/);
    expect(() =>
      new ArrangementSelection({
        items: () => [],
        groups: () => [{ id: 'all', label: '全部', count }],
      }).initial(),
    ).toThrow(/Invalid .* count/);
    expect(() =>
      createContent({
        cards: [
          {
            id: 'probe:count',
            label: '数量',
            type: 'basic',
            use: { count, target: () => true, resolve: () => undefined },
          },
        ],
      }),
    ).toThrow(/Invalid .* count/);
    expect(() =>
      viewAs({
        id: 'convert',
        label: '转换',
        materials: () => [],
        count,
        make: { name: 'standard:slash' },
      }),
    ).toThrow(/Invalid .* count/);
  }
});

it('联合选择的异步候选和约束不能变成合法回复，立即关闭请求并拒绝晚到写入', async () => {
  for (const field of ['cards', 'targets', 'partial', 'canComplete', 'complete'] as const) {
    const game = room();
    let at: Context;
    let lateError = '';
    const invalid = async () => {
      await Promise.resolve();
      try {
        at.commit('invalid.selection.late', [], null);
      } catch (error) {
        lateError = (error as Error).message;
      }
      return false;
    };
    const constraints = { partial: () => null, canComplete: () => true, complete: () => null };
    const spec = {
      cards: () => [],
      targets: () => [],
      cardCount: { min: 0, max: 0 },
      targetCount: { min: 0, max: 0 },
      constraints:
        field === 'cards' || field === 'targets'
          ? constraints
          : { ...constraints, [field]: invalid },
      ...(field === 'cards' || field === 'targets' ? { [field]: invalid } : {}),
    } as unknown as JointSelectionSpec;
    const selection = new JointSelection(spec);
    const before = game.world.snapshot;
    await expect(
      game.run('selection', (ctx) => {
        at = ctx;
        return ctx.ask(selection.decision('a', '异步约束'));
      }),
    ).rejects.toThrow(`Queries cannot await (selection.${field})`);
    await Promise.resolve();
    expect(lateError).toContain('Queries cannot await');
    expect(game.status).toBe('faulted');
    expect(game.decisions.pending).toEqual([]);
    expect(game.world.snapshot).toBe(before);
    expect(game.history.facts()).toEqual([]);
  }
});

it('联合选择允许合法未完成前缀，只有牌和目标都完成才可提交', () => {
  let cards: (string | ChoiceItem)[] = ['a1', { id: 'a2', label: '第二张材料' }];
  const selection = new JointSelection({
    cards: () => cards,
    targets: () => ['b'],
    cardCount: { min: 1, max: 2 },
    targetCount: { min: 1, max: 1 },
  });
  expect(selection.available()).toBe(true);
  expect(selection.describe().preview.cards).toMatchObject([
    { id: 'a1', label: 'a1' },
    { id: 'a2', label: '第二张材料' },
  ]);
  expect(selection.describe().preview.targets).toMatchObject([{ id: 'b', label: 'b' }]);
  expect(selection.validate({ cards: [], targets: [] }).ok).toBe(false);
  expect(selection.inspect({ cards: [], targets: [] })).toMatchObject({
    valid: true,
    complete: false,
  });
  expect(selection.inspect({ cards: ['a1'], targets: [] })).toMatchObject({
    valid: true,
    complete: false,
  });
  expect(selection.validate({ cards: ['a1'], targets: ['b'] })).toMatchObject({ ok: true });
  expect(selection.validate({ cards: ['a1', 'a1'], targets: ['b'] })).toMatchObject({
    ok: false,
    reason: 'Duplicate choice.',
  });
  cards = ['a1', { id: 'a1', label: '同一材料的别名' }];
  expect(() => selection.available()).toThrow('Candidates require distinct stable IDs.');
  cards = [''];
  expect(() => selection.available()).toThrow('Candidates require distinct stable IDs.');
});

it('复杂点数和约束可省略额外前缀检查，仍区分完成路径与最终满足', () => {
  const ranks: Record<string, number> = { five: 5, eight: 8, six: 6 };
  const sum = (ids: readonly string[]) => ids.reduce((total, id) => total + (ranks[id] ?? 0), 0);
  class Constraints {
    #sum = sum;

    complete(choice: JointChoice): string | null {
      return this.#sum(choice.cards) === 13 ? null : 'Sum must equal 13.';
    }

    canComplete(choice: JointChoice) {
      return (
        choice.cards.length === 0 ||
        (choice.cards.length === 2
          ? this.#sum(choice.cards) === 13
          : Object.keys(ranks).some(
              (id) => !choice.cards.includes(id) && this.#sum([...choice.cards, id]) === 13,
            ))
      );
    }
  }
  const constraints = new Constraints();
  const selection = new JointSelection({
    cards: () => Object.keys(ranks),
    cardCount: { min: 2, max: 2 },
    constraints,
  });
  constraints.complete = () => 'Changed constraint must not run.';
  constraints.canComplete = () => false;
  expect(Object.isFrozen(constraints)).toBe(false);
  expect(selection.available()).toBe(true);
  expect(selection.inspect({ cards: ['five'], targets: [] })).toMatchObject({
    valid: true,
    complete: false,
  });
  expect(selection.inspect({ cards: ['six'], targets: [] })).toMatchObject({
    valid: false,
    complete: false,
  });
  expect(
    selection.inspect({ cards: [], targets: [] }).cards.find((card) => card.id === 'six')
      ?.selectable,
  ).toBe(false);
  expect(selection.validate({ cards: ['five', 'eight'], targets: [] })).toMatchObject({ ok: true });
  expect(selection.validate({ cards: ['eight', 'six'], targets: [] }).ok).toBe(false);
});

it('零材料动作在没有任何实体牌时仍可完成', async () => {
  const game = room();
  expect(
    () => new JointSelection({ targets: () => ['b'] } as unknown as JointSelectionSpec),
  ).toThrow(/targets and targetCount/);
  const selection = new JointSelection({
    targets: () => ['b'],
    targetCount: { min: 1, max: 1 },
  });
  const running = game.run('zero', (ctx) => ctx.ask(selection.decision('a', '零材料转换')));
  const request = await nextRequest(game);
  expect(request.data).toMatchObject({ cardCount: { min: 0, max: 0 }, preview: { cards: [] } });
  expect(
    game.decisions.submit(request.id, request.token, { cards: ['a1'], targets: ['b'] }),
  ).toMatchObject({
    kind: 'rejected',
    reason: 'invalid',
  });
  expect(game.decisions.submit(request.id, request.token, { cards: [], targets: ['b'] }).kind).toBe(
    'accepted',
  );
  expect(await running).toMatchObject({
    kind: 'resolved',
    value: { kind: 'chosen', value: { cards: [], targets: ['b'] } },
  });
});

it('选择预览携带部分反馈，失效刷新更新候选且旧 token 不能支付', async () => {
  const game = room();
  let candidates = ['a1', 'a2'];
  class Candidate implements ChoiceItem {
    #reads = 0;
    #value: string;

    constructor(value: string) {
      this.#value = value;
    }

    get id() {
      return ++this.#reads === 1 ? this.#value : 'read-again';
    }

    get label() {
      return `选项 ${this.#value}`;
    }
  }
  class Spec {
    cardCount = { min: 1, max: 1 };
    targetCount = { min: 1, max: 1 };
    #cards = () => candidates;
    #targets = ['b'];

    cards() {
      return this.#cards().map((id) => new Candidate(id));
    }

    targets() {
      return this.#targets.map((id) => new Candidate(id));
    }
  }
  const spec = new Spec();
  const selection = new JointSelection(spec);
  spec.cards = () => [];
  spec.targets = () => [];
  expect(selection.describe({ cards: ['a1'], targets: ['b'] }).preview).toMatchObject({
    valid: true,
    complete: true,
    cards: [
      { id: 'a1', label: '选项 a1', selected: true },
      { id: 'a2', label: '选项 a2', selected: false },
    ],
    targets: [{ id: 'b', label: '选项 b', selected: true }],
  });
  const decision = selection.decision('a', '选择', {
    optional: true,
    reason: 'probe:selection',
    cancelLabel: '放弃选择',
  });
  expect(decision.optional).toBe(true);
  const running = game.run('choose', (ctx) => ctx.ask(decision));
  const first = await nextRequest(game);
  expect(first.data).toMatchObject({ reason: 'probe:selection', cancelLabel: '放弃选择' });
  expect(game.decisions.preview(first.id, { cards: ['a1'], targets: [] })).toMatchObject({
    valid: false,
    feedback: { valid: true, complete: false },
  });
  const choice = { cards: ['a1'], targets: ['b'] };
  expect(selection.describe(choice).preview.complete).toBe(true);
  candidates = ['a2'];
  game.decisions.invalidate(first.id);
  const current = await nextRequest(game);
  expect(current.token).toBeGreaterThan(first.token);
  expect(current.data).toMatchObject({ preview: { cards: [{ id: 'a2' }] } });
  expect(selection.describe(choice).preview.refreshed).toEqual({ cards: [], targets: ['b'] });
  expect(game.decisions.preview(first.id, { cards: ['a1'], targets: ['b'] })).toMatchObject({
    valid: false,
    feedback: { refreshed: { cards: [], targets: ['b'] } },
  });
  expect(
    game.decisions.submit(first.id, first.token, { cards: ['a1'], targets: ['b'] }),
  ).toMatchObject({ reason: 'stale' });
  game.decisions.submit(first.id, current.token, { cards: ['a2'], targets: ['b'] });
  await running;
  const cancelling = game.run('cancel', (ctx) => ctx.ask(decision));
  const request = await nextRequest(game);
  expect(game.decisions.cancel(request.id, request.token)).toEqual({ kind: 'accepted' });
  expect(await cancelling).toMatchObject({ kind: 'resolved', value: { kind: 'cancelled' } });
  expect(game.history.facts()).toEqual([]);
});

it('联合约束决定目标可选性，更换材料后重新计算', () => {
  class Constraints {
    #card = 'red';
    #target = 'c';

    partial(choice: JointChoice) {
      return choice.cards.includes(this.#card) && choice.targets.includes(this.#target)
        ? 'C cannot receive red.'
        : null;
    }

    complete() {
      return null;
    }

    canComplete() {
      return true;
    }
  }
  const constraints = new Constraints();
  const selection = new JointSelection({
    cards: () => ['red', 'black'],
    targets: () => ['b', 'c'],
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 1, max: 1 },
    constraints,
  });
  constraints.partial = () => null;
  expect(
    selection.inspect({ cards: ['red'], targets: [] }).targets.find((target) => target.id === 'c')
      ?.selectable,
  ).toBe(false);
  expect(
    selection.inspect({ cards: ['black'], targets: [] }).targets.find((target) => target.id === 'c')
      ?.selectable,
  ).toBe(true);
  expect(selection.validate({ cards: ['red'], targets: ['c'] }).ok).toBe(false);
  const described = selection.describe({ cards: ['red'], targets: [] });
  expect(described.preview.selection).toEqual({ cards: ['red'], targets: [] });
  expect(described.preview.targets.find((target) => target.id === 'c')?.selectable).toBe(false);
  expect(selection.describe().preview.selection).toEqual({ cards: [], targets: [] });
});

it('无足够候选时直接 unavailable，不产生永远不能完成的请求', async () => {
  const game = room();
  const selection = new JointSelection({
    cards: () => [],
    targets: () => ['b'],
    cardCount: { min: 1, max: 2 },
    targetCount: { min: 1, max: 1 },
  });
  expect(selection.available()).toBe(false);
  expect(await game.run('empty', (ctx) => ctx.ask(selection.decision('a', 'no cards')))).toEqual({
    kind: 'resolved',
    value: { kind: 'unavailable' },
  });
  expect(game.decisions.pending).toEqual([]);
});

it('描述刷新异常也冻结并关闭等待者，不留下无主选择', async () => {
  const game = room();
  let broken = false;
  const selection = new JointSelection({
    cards: () => {
      if (broken) throw new Error('candidate bug');
      return ['a1'];
    },
    cardCount: { min: 1, max: 1 },
  });
  const running = game.run('choose', (ctx) => ctx.ask(selection.decision('a', 'choose')));
  const request = await nextRequest(game);
  broken = true;
  expect(() => game.decisions.invalidate(request.id)).toThrow('candidate bug');
  await expect(running).rejects.toThrow('candidate bug');
  expect(game.decisions.pending).toEqual([]);
});
