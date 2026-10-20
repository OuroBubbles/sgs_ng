import { expect, it } from 'vitest';
import { Room } from '../../src/core/runtime/room';
import { cardGame } from '../fixtures/cards';
import standard from '../../src/content/standard';
import { covenant } from '../../examples/effects/covenant';
import { definePackage, resolvePackages, EffectBook } from '../../src/sdk';
import { rebuildWorld } from '../../src/core/history/rebuild';

const pack = () =>
  definePackage({
    manifest: { id: 'covenant', name: '守约示例', version: '1', requires: [{ id: 'standard' }] },
    effects: [covenant],
  });
function create(selected = true) {
  const content = resolvePackages([standard, pack()], selected ? ['covenant'] : ['standard']);
  const books = content.createBooks();
  const initial = cardGame({ hands: { a: [] } }).initial;
  const room = new Room({ id: 'effects-package', seed: 42, world: initial });
  books.skills.attach(room);
  return { ...books, room, initial };
}
it('内容包显式登记普通效果定义，创建与查询使用本局真实目录', async () => {
  const game = create();
  await game.room.run('create', (ctx) =>
    game.book.effects.add(ctx, covenant, { owner: 'b', data: { target: 'b', remaining: 1 } }),
  );
  expect(game.room.inspect((ctx) => game.book.handLimit(ctx, 'b'))).toBe(5);
  expect(game.room.world.snapshot.skills).toEqual([]);
  expect(rebuildWorld(game.initial, game.room.history.facts())).toEqual(game.room.world.snapshot);
});
it('未选择的效果包不泄漏定义，未知声明拒绝整次提交', async () => {
  const game = create(false);
  await expect(
    game.room.run('missing', (ctx) =>
      game.book.effects.add(ctx, covenant, { owner: 'b', data: { target: 'b', remaining: 1 } }),
    ),
  ).rejects.toThrow('Unknown effect');
  expect(game.book.effects.instances(game.room.world)).toEqual([]);
  expect(game.room.world.snapshot.states).toEqual([]);
});
it.each(['namespace', 'duplicate'] as const)('包内效果 %s 在解析时诊断', (kind) => {
  expect(() =>
    definePackage({
      manifest: { id: kind === 'namespace' ? 'other' : 'covenant', name: 'invalid', version: '1' },
      effects: kind === 'duplicate' ? [covenant, covenant] : [covenant],
    }),
  ).toThrow(kind === 'duplicate' ? 'Duplicate effect' : 'own namespace');
});
it('每局效果实例独立，不随共用定义或包对象跨局共享', async () => {
  const left = create();
  const right = create();
  await left.room.run('add', (ctx) =>
    left.book.effects.add(ctx, covenant, { owner: 'b', data: { target: 'b', remaining: 1 } }),
  );
  expect(left.room.inspect((ctx) => left.book.handLimit(ctx, 'b'))).toBe(5);
  expect(right.room.inspect((ctx) => right.book.handLimit(ctx, 'b'))).toBe(4);
  expect(right.book.effects.instances(right.room.world)).toEqual([]);
});
it('效果列表在包声明时复制冻结，不改变函数与对象身份', () => {
  const declarations = [covenant];
  const entry = definePackage({
    manifest: { id: 'covenant', name: 'example', version: '1' },
    effects: declarations,
  });
  declarations.length = 0;
  expect(entry.effects).toHaveLength(1);
  expect(Object.isFrozen(entry.effects)).toBe(true);
  expect(entry.effects![0]!.create).toBe(covenant.create);
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
  const initial = cardGame({ hands: { a: [] } }).initial;
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
