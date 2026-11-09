import { expect, it } from 'vitest';
import { Room } from '../../src/core/runtime/room';
import { cardSeed } from '../fixtures/cards';
import { standard } from '../fixtures/standard';
import { covenant } from '../../examples/effects/covenant';
import { createContent, EffectBook, handLimit } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';

function create(content: ReturnType<typeof createContent>) {
  const books = content.createBooks();
  const initial = cardSeed({ hands: { a: [] } });
  const room = new Room({ id: 'effects-package', seed: 42, world: initial });
  books.skills.attach(room);
  return { ...books, room, initial };
}

it('共用目录隔离两局效果，列表固定后真实创建、查询与重建', async () => {
  const effects = [covenant];
  const content = createContent(standard, { effects });
  effects.length = 0;
  const left = create(content);
  const right = create(content);
  expect(left.skills.effects).not.toBe(right.skills.effects);
  await left.room.run('create', (ctx) =>
    left.skills.effects.add(ctx, covenant, { owner: 'b', data: { target: 'b', remaining: 1 } }),
  );
  expect(left.room.inspect((ctx) => handLimit(ctx, 'b'))).toBe(5);
  expect(right.room.inspect((ctx) => handLimit(ctx, 'b'))).toBe(4);
  expect(right.skills.effects.instances(right.room.world)).toEqual([]);
  for (const game of [left, right]) {
    expect(game.room.world.snapshot.skills).toEqual([]);
    expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
    game.room.abort('done');
  }
  expect(() => createContent({ effects: [covenant, covenant] })).toThrow('Duplicate effect');
});

it('未选择的效果定义不泄漏定义，未知声明拒绝整次提交', async () => {
  const game = create(createContent(standard));
  await expect(
    game.room.run('missing', (ctx) =>
      game.skills.effects.add(ctx, covenant, { owner: 'b', data: { target: 'b', remaining: 1 } }),
    ),
  ).rejects.toThrow('Unknown effect');
  expect(game.skills.effects.instances(game.room.world)).toEqual([]);
  expect(game.room.world.snapshot.states).toEqual([]);
});

it('未知恢复定义令挂接原子失败，补齐定义后可正常挂接，不残留来源', () => {
  const record = {
    id: 'effect:restored:1',
    type: covenant.id,
    owner: 'b',
    origin: null,
    scopeId: null,
    data: { target: 'b', remaining: 1 },
  };
  const initial = cardSeed({ hands: { a: [] } });
  const room = new Room({
    id: 'restored-effect-package',
    seed: 42,
    world: {
      ...initial,
      states: [
        {
          id: record.id,
          key: 'rules:effect',
          owner: null,
          source: covenant.id,
          scopeId: null,
          value: record,
        },
      ],
    },
  });
  const effects = new EffectBook();
  expect(() => effects.attach(room)).toThrow('Unknown effect');
  effects.register([covenant]);
  const detach = effects.attach(room);
  expect(effects.instances(room.world, covenant)).toEqual([record]);
  detach();
});
