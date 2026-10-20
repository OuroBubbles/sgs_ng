import { expect, it } from 'vitest';
import { JointSelection } from '../../src/sdk';
import { nextRequest, room } from '../fixtures/room';

const items = (ids: readonly string[]) => ids.map((id) => ({ id, label: id }));

it('联合选择允许合法未完成前缀，只有牌和目标都完成才可提交', () => {
  const selection = new JointSelection({
    cards: () => items(['a1', 'a2']),
    targets: () => items(['b']),
    cardCount: { min: 1, max: 2 },
    targetCount: { min: 1, max: 1 },
  });
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
});

it('复杂点数和约束区分部分合法、存在完成路径、最终满足', () => {
  const ranks: Record<string, number> = { five: 5, eight: 8, six: 6 };
  const sum = (ids: readonly string[]) => ids.reduce((total, id) => total + (ranks[id] ?? 0), 0);
  const selection = new JointSelection({
    cards: () => items(Object.keys(ranks)),
    targets: () => [],
    cardCount: { min: 2, max: 2 },
    targetCount: { min: 0, max: 0 },
    constraints: {
      partial: (choice) => (sum(choice.cards) <= 13 ? null : 'Sum exceeds 13.'),
      complete: (choice) => (sum(choice.cards) === 13 ? null : 'Sum must equal 13.'),
      canComplete: (choice) =>
        choice.cards.length === 0 ||
        (choice.cards.length === 2
          ? sum(choice.cards) === 13
          : Object.keys(ranks).some(
              (id) => !choice.cards.includes(id) && sum([...choice.cards, id]) === 13,
            )),
    },
  });
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
});

it('零材料动作在没有任何实体牌时仍可完成', async () => {
  const game = room();
  const selection = new JointSelection({
    cards: () => [],
    targets: () => items(['b']),
    cardCount: { min: 0, max: 0 },
    targetCount: { min: 1, max: 1 },
  });
  const running = game.run('zero', (ctx) => ctx.ask(selection.decision('a', '零材料转换')));
  const request = await nextRequest(game);
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
  const selection = new JointSelection({
    cards: () => items(candidates),
    targets: () => items(['b']),
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 1, max: 1 },
  });
  const running = game.run('choose', (ctx) => ctx.ask(selection.decision('a', '选择')));
  const first = await nextRequest(game);
  expect(game.decisions.preview(first.id, { cards: ['a1'], targets: [] })).toMatchObject({
    valid: false,
    feedback: { valid: true, complete: false },
  });
  candidates = ['a2'];
  game.decisions.invalidate(first.id);
  const current = await nextRequest(game);
  expect(current.token).toBeGreaterThan(first.token);
  expect(current.data).toMatchObject({ preview: { cards: [{ id: 'a2' }] } });
  expect(game.decisions.preview(first.id, { cards: ['a1'], targets: ['b'] })).toMatchObject({
    valid: false,
    feedback: { refreshed: { cards: [], targets: ['b'] } },
  });
  expect(
    game.decisions.submit(first.id, first.token, { cards: ['a1'], targets: ['b'] }),
  ).toMatchObject({ reason: 'stale' });
  game.decisions.submit(first.id, current.token, { cards: ['a2'], targets: ['b'] });
  await running;
  expect(game.history.facts()).toEqual([]);
});

it('联合约束决定目标可选性，更换材料后重新计算', () => {
  const selection = new JointSelection({
    cards: () => items(['red', 'black']),
    targets: () => items(['b', 'c']),
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 1, max: 1 },
    constraints: {
      partial: (choice) =>
        choice.cards.includes('red') && choice.targets.includes('c')
          ? 'C cannot receive red.'
          : null,
      complete: () => null,
      canComplete: () => true,
    },
  });
  expect(
    selection.inspect({ cards: ['red'], targets: [] }).targets.find((target) => target.id === 'c')
      ?.selectable,
  ).toBe(false);
  expect(
    selection.inspect({ cards: ['black'], targets: [] }).targets.find((target) => target.id === 'c')
      ?.selectable,
  ).toBe(true);
  expect(selection.validate({ cards: ['red'], targets: ['c'] }).ok).toBe(false);
});

it('无足够候选时直接 unavailable，不产生永远不能完成的请求', async () => {
  const game = room();
  const selection = new JointSelection({
    cards: () => [],
    targets: () => items(['b']),
    cardCount: { min: 1, max: 2 },
    targetCount: { min: 1, max: 1 },
  });
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
      return items(['a1']);
    },
    targets: () => [],
    cardCount: { min: 1, max: 1 },
    targetCount: { min: 0, max: 0 },
  });
  const running = game.run('choose', (ctx) => ctx.ask(selection.decision('a', 'choose')));
  const request = await nextRequest(game);
  broken = true;
  expect(() => game.decisions.invalidate(request.id)).toThrow('candidate bug');
  await expect(running).rejects.toThrow('candidate bug');
  expect(game.decisions.pending).toEqual([]);
});
