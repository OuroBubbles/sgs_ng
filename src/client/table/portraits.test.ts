import { afterEach, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';
import { PortraitTextures } from './portraits';

vi.mock('pixi.js', () => ({ Texture: { from: vi.fn() } }));

const pending: { src: string; resolve(): void; reject(): void }[] = [];
function setup() {
  pending.length = 0;
  vi.mocked(Texture.from).mockReset();
  const destroy = vi.fn();
  vi.mocked(Texture.from).mockImplementation(() => ({ destroy }) as unknown as Texture);
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode() {
        return new Promise<void>((resolve, reject) => {
          pending.push({ src: this.src, resolve, reject: () => reject(new Error('bad image')) });
        });
      }
    },
  );
  const changed = vi.fn();
  return { pool: new PortraitTextures(changed), changed, destroy };
}
afterEach(() => vi.unstubAllGlobals());

it('同图多席只解码一次，解码前回退轮廓，完成后使用独占纹理并请求重绘', async () => {
  const { pool, changed, destroy } = setup();
  pool.sync(['one', 'one']);
  pool.sync(['one']);
  expect(pending).toHaveLength(1);
  expect(pool.get('one')).toBeUndefined();
  pending[0]!.resolve();
  await Promise.resolve();
  expect(Texture.from).toHaveBeenCalledWith(expect.objectContaining({ src: 'one' }), true);
  expect(pool.get('one')).toBeDefined();
  expect(changed).toHaveBeenCalledTimes(1);
  pool.sync(['one', 'one']);
  expect(destroy).not.toHaveBeenCalled();
  pool.sync([]);
  pool.destroy();
  expect(destroy).toHaveBeenCalledExactlyOnceWith(true);
});

it('等待加载时移除后重新加入同一路径，旧完成不能冒充新资源或触发重绘', async () => {
  const { pool, changed } = setup();
  pool.sync(['same']);
  pool.sync([]);
  pool.sync(['same']);
  pending[0]!.resolve();
  await Promise.resolve();
  expect(Texture.from).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  pending[1]!.resolve();
  await Promise.resolve();
  expect(Texture.from).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(1);
  pool.destroy();
});

it('坏资源不会阻塞其他立绘或在每次对局重绘时重复请求，离开后允许重试', async () => {
  const { pool, changed } = setup();
  pool.sync(['bad', 'good']);
  pending[0]!.reject();
  pending[1]!.resolve();
  await Promise.resolve();
  pool.sync(['bad', 'good']);
  expect(pending).toHaveLength(2);
  expect(pool.get('bad')).toBeUndefined();
  expect(pool.get('good')).toBeDefined();
  expect(changed).toHaveBeenCalledTimes(1);
  pool.sync([]);
  pool.sync(['bad']);
  expect(pending).toHaveLength(3);
  pool.destroy();
  pending[2]!.resolve();
  await Promise.resolve();
  expect(Texture.from).toHaveBeenCalledTimes(1);
});
