// 宿主冒烟：用 Bun 直接跑 src/server/main.ts（源码，不打包），连一次 /game 完成 hello 并入座。
// Bun 缺失或版本不符 engines.bun、未监听、哈希不符或握手失败均以非零退出。
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { protocolHash, contentHash } from './network-build.mjs';

const pinned = JSON.parse(readFileSync('package.json', 'utf8')).engines.bun;
let version;
try {
  version = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim();
} catch {
  console.error(`smoke-bun-host: FAIL — bun not found on PATH; install Bun ${pinned}.`);
  process.exit(1);
}
if (version !== pinned) {
  console.error(`smoke-bun-host: FAIL — Bun ${version} on PATH, project pins ${pinned}.`);
  process.exit(1);
}

const protocol = protocolHash();
const content = contentHash();
const host = spawn('bun', ['src/server/main.ts'], {
  env: { ...process.env, SGS_HOST: '127.0.0.1', SGS_PORT: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
});
const fail = (error) => {
  console.error(`smoke-bun-host: FAIL — ${error instanceof Error ? error.message : error}`);
  host.kill();
  process.exit(1);
};
host.once('error', fail);
host.once('exit', (code) => fail(`host exited before handshake (${code})`));
const timer = setTimeout(() => fail('timeout'), 15_000);

let output = '';
const port = await new Promise((resolve) =>
  host.stdout.on('data', (data) => {
    output += data;
    const found = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?online=1/);
    if (found) resolve(found[1]);
  }),
);
const seat = await new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/game`);
  socket.on('error', reject);
  socket.on('message', (data) => {
    const message = JSON.parse(String(data));
    if (message.kind === 'hello') {
      if (message.protocol !== protocol) reject(new Error(`protocol ${message.protocol}`));
      else if (message.content !== content) reject(new Error(`content ${message.content}`));
      else socket.send(JSON.stringify({ kind: 'hello', protocol, content, build: protocol }));
    } else if (message.kind === 'seat') {
      socket.close();
      resolve(message.seat);
    } else if (message.kind === 'error') reject(new Error(message.message));
  });
}).catch(fail);
clearTimeout(timer);
host.removeAllListeners('exit');
host.kill();
console.log(`smoke-bun-host: PASS — Bun ${version}, hello ok, seat ${seat}`);
process.exit(0);
