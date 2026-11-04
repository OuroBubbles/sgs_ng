import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createContent } from '../../src/content/catalog';
import standard from '../../src/content/standard';
import harbor from '../../examples/content/harbor';
import gallery from '../../examples/content/gallery';
import { createRoomOptions } from '../../src/host/setup';
import { createGameServer } from '../../src/server/server';

// 真实普通源码和二进制资源，只在主持端组合；客户端仍是原来的构建产物。
const bytes = await readFile('examples/content/harbor/guest.jpg');
const resource = {
  url: 'sgs-resource:portrait',
  type: 'image/jpeg',
  data: bytes.toString('base64'),
};
const withPortrait = (definition: typeof harbor | typeof gallery) => ({
  ...definition,
  generalViews: definition.generalViews.map((view) => ({ ...view, portrait: resource.url })),
});
const content = createContent(standard, withPortrait(harbor), withPortrait(gallery));
const setup = {
  seed: 2,
  preset: 'harbor:crossing',
  humans: 2,
  lineup: ['gallery:guest', 'standard:guanyu'],
};
const server = createGameServer(createRoomOptions(setup, content), {
  staticRoot: resolve('dist'),
  assets: [resource],
});
const host = process.env.SGS_HOST ?? '127.0.0.1';
const port = await server.listen(Number(process.env.SGS_PORT ?? 0), host);
console.log(`2人联机：http://${host}:${port}/?online=1`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
