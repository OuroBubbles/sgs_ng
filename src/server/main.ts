import { resolve } from 'node:path';
import { createGameServer } from './server';
import { createRoomOptions, defaultRoomSetup, type RoomSetup } from '../app/network/setup';

const host = process.env.SGS_HOST ?? '127.0.0.1';
const port = Number(process.env.SGS_PORT ?? 1422);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid SGS_PORT.');
const setup = process.env.SGS_ROOM
  ? (JSON.parse(process.env.SGS_ROOM) as RoomSetup)
  : { ...defaultRoomSetup, seed: Number(process.env.SGS_SEED ?? defaultRoomSetup.seed) };
const server = createGameServer(
  createRoomOptions({ ...setup, practice: setup.practice ?? process.env.SGS_PRACTICE === '1' }),
  {
    staticRoot: resolve('dist'),
  },
);
const boundPort = await server.listen(port, host);
console.log(
  `${setup.humans}人联机：http://${host}:${boundPort}/?online=1（${setup.lineup.length - setup.humans} 席基础 AI）`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
