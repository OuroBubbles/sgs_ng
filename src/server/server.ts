import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { NetworkRoom, type NetworkRoomOptions } from '../host/room';
import type { ClientMessage, RemoteAsset } from '../protocol';
import { protocolHash, buildMismatch, helloPayload } from '../protocol/build';

/** 一个 HTTP / WebSocket 入口；房间跨局保留，规则实例由房间工厂按局创建。 */
export function createGameServer(
  setup: NetworkRoomOptions,
  options: {
    readonly staticRoot?: string;
    readonly aiDelayMs?: number;
    readonly assets?: readonly RemoteAsset[];
  } = {},
) {
  const room = new NetworkRoom(setup, options.aiDelayMs);
  const root = options.staticRoot ? resolve(options.staticRoot) : null;
  const types: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
  };
  const server = createServer((request, response) => {
    const serve = async () => {
      if (!root || request.method !== 'GET') {
        response.writeHead(404).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const file = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!file.startsWith(`${root}${sep}`)) {
        response.writeHead(404).end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-cache',
      });
      createReadStream(file)
        .on('error', () => response.destroy())
        .pipe(response);
    };
    serve().catch(() => {
      if (!response.headersSent) response.writeHead(404).end();
      else response.destroy();
    });
  });
  const sockets = new WebSocketServer({
    server,
    path: '/game',
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  sockets.on('connection', (socket) => {
    let joined: ReturnType<NetworkRoom['join']> = null;
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    // TCP 静默中断也要释放连接绑定；心跳不进入 World 或事实流。
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      alive = false;
      socket.ping();
      socket.send(JSON.stringify({ kind: 'pulse' }));
    }, 10_000);
    function reject(message: string) {
      clearTimeout(timeout);
      socket.send(JSON.stringify({ kind: 'error', message }));
      socket.close(1008);
    }
    // 未核对的连接不占席位、不接收投影，也不能因断开而中止别人的对局。
    const timeout = setTimeout(() => reject('构建核对超时，请更新客户端后重新加入。'), 10_000);
    socket.send(JSON.stringify(helloPayload({ assets: options.assets ?? [] })));
    socket.on('error', () => socket.close());
    socket.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      joined?.disconnect();
    });
    socket.on('message', (data, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        if (binary) throw new Error('Text messages required.');
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : data;
        const message = JSON.parse(bytes.toString('utf8')) as ClientMessage;
        if (!joined) {
          clearTimeout(timeout);
          if (
            !('kind' in message) ||
            message.kind !== 'hello' ||
            (message.protocol ?? message.build) !== protocolHash
          ) {
            reject(buildMismatch);
            return;
          }
          joined = room.join((message) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
          }, message.resume);
          if (!joined) {
            if (message.resume) {
              socket.send(
                JSON.stringify({
                  kind: 'error',
                  code: 'resume-expired',
                  message: '原席位已失效，请重新加入房间。',
                }),
              );
              socket.close(1008);
            } else reject('房间已满或已经开局。');
          } else socket.send(JSON.stringify({ kind: 'seat', seat: joined.seat, key: joined.key }));
          return;
        }
        if ('kind' in message) throw new Error('Unexpected hello.');
        if (
          !Number.isSafeInteger(message.sequence) ||
          !Number.isSafeInteger(message.round) ||
          !message.command
        )
          throw new Error('Invalid message.');
        const result = joined.command(message.round, message.command);
        socket.send(
          JSON.stringify({
            kind: 'response',
            sequence: message.sequence,
            round: message.round,
            result,
          }),
        );
      } catch {
        reject('消息格式错误。');
      }
    });
  });
  return {
    async listen(port = 1422, host = '127.0.0.1'): Promise<number> {
      await new Promise<void>((accept, reject) => {
        // ws 会转发 HTTP 监听错误；两侧都接住，避免端口冲突成为未处理事件。
        const failed = (error: Error) => {
          server.off('error', failed);
          sockets.off('error', failed);
          reject(error);
        };
        server.once('error', failed);
        sockets.once('error', failed);
        server.listen(port, host, () => {
          server.off('error', failed);
          sockets.off('error', failed);
          accept();
        });
      });
      return (server.address() as AddressInfo).port;
    },
    async close(): Promise<void> {
      room.dispose();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((accept) => sockets.close(() => accept()));
      await new Promise<void>((accept, reject) =>
        server.close((error) =>
          error && !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')
            ? reject(error)
            : accept(),
        ),
      );
    },
  };
}
