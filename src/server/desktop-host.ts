import { networkInterfaces } from 'node:os';
import { createInterface } from 'node:readline';
import { createGameServer } from './server';
import { createRoomOptions } from '../host/setup';
import type { RoomSetup } from '../protocol';

// stdout 只承载一次原生就绪通知，其余日志走 stderr。
console.log = (...values: unknown[]) => console.error(...values);
const notify = (message: unknown) => process.stdout.write(JSON.stringify(message) + '\n');

/** stdin 首行传装配数据，随后保留管道；EOF 在加载中或开局后均关闭自有房间。 */
async function main() {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('房间端口应为 0–65535 的整数。');
  let closing = false;
  let listening = false;
  let server: ReturnType<typeof createGameServer> | undefined;
  async function close() {
    if (closing) return;
    closing = true;
    if (listening) await server!.close();
  }
  process.stdin.once('end', () => {
    close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
  const lines = createInterface({ input: process.stdin });
  const first = await new Promise<string>((resolve, reject) => {
    lines.once('line', (line) => {
      resolve(line);
      lines.close();
    });
    lines.once('close', () => reject(new Error('房间配置尚未传入，拥有者已退出。')));
  });
  process.stdin.resume();
  if (closing) return;
  const { setup } = JSON.parse(first) as {
    setup: RoomSetup;
  };
  try {
    server = createGameServer(createRoomOptions(setup));
    const bound = await server.listen(port, '0.0.0.0');
    listening = true;
    if (closing) {
      await server.close();
      return;
    }
    const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
      (entries ?? [])
        .filter((entry) => entry.family === 'IPv4' && !entry.internal)
        .map((entry) => ({ name, address: `${entry.address}:${bound}` })),
    );
    notify({ kind: 'ready', room: { port: bound, local: `127.0.0.1:${bound}`, addresses, setup } });
  } catch (error) {
    await server?.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
      ? '房间端口已被占用，请更换端口或使用 0 自动分配。'
      : error instanceof Error
        ? error.message
        : String(error);
  notify({ kind: 'error', message });
  process.exitCode = 1;
  process.stdin.pause();
});
