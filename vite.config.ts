import { spawn, type ChildProcess } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tauriConfig from './src-tauri/tauri.conf.json' with { type: 'json' };
import { protocolHash } from './scripts/network-build.mjs';

const host = process.env.TAURI_DEV_HOST;
/** 开发/预览附带的本机主持端端口；页面经同源代理访问，不直接连它。 */
const hostPort = Number(process.env.SGS_DEV_HOST_PORT ?? 1423);
const hostProxy = {
  '/game': { target: `ws://127.0.0.1:${hostPort}`, ws: true },
  '/catalog': `http://127.0.0.1:${hostPort}`,
};

/**
 * 规则只在主持端运行：`pnpm dev` 与 `pnpm preview` 各自拉起一个 Bun 主持端（源码直跑），
 * 单机与联机都经 /game 协议连接它。主持端随 stdin 管道关闭退出，不会游离；
 * 开发时规则侧源码变更（含新增、删除文件）会重启主持端（页面显示断开，重新开局即可）。
 */
function localHost(): Plugin {
  let child: ChildProcess | null = null;
  const start = () => {
    const next = spawn(process.env.SGS_BUN ?? 'bun', ['src/server/main.ts'], {
      env: { ...process.env, SGS_HOST: '127.0.0.1', SGS_PORT: String(hostPort), SGS_OWNED: '1' },
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true,
    });
    next.on('error', (error) => console.error(`[sgs] 无法启动 Bun 主持端：${error.message}`));
    child = next;
  };
  const stop = (then?: () => void) => {
    const current = child;
    child = null;
    if (!current || current.exitCode !== null || current.signalCode !== null) return then?.();
    if (then) current.once('exit', then);
    current.stdin?.end();
    current.kill();
  };
  const owned = (server: { httpServer: { once(event: 'close', fn: () => void): void } | null }) => {
    start();
    server.httpServer?.once('close', () => stop());
    process.once('exit', () => stop());
  };
  return {
    name: 'sgs-local-host',
    configureServer(server) {
      owned(server);
      // 新增/删除内容文件同样重启：主持端启动时重新扫描内容包。
      for (const event of ['add', 'change', 'unlink'] as const)
        server.watcher.on(event, (file: string) => {
          if (/[\\/]src[\\/](host|server|rules|content|core|protocol|sdk)[\\/]/.test(file))
            stop(start);
        });
    },
    configurePreviewServer(server) {
      owned(server);
    },
  };
}

export default defineConfig({
  define: {
    __SGS_PROTOCOL_HASH__: JSON.stringify(protocolHash()),
  },
  plugins: [svelte(), localHost()],
  clearScreen: false,
  preview: {
    headers: { 'Content-Security-Policy': tauriConfig.app.security.csp },
    proxy: hostProxy,
  },
  server: {
    host: host ?? '127.0.0.1',
    port: 1420,
    strictPort: true,
    proxy: hostProxy,
    ...(host ? { hmr: { protocol: 'ws', host, port: 1421 } } : {}),
    watch: { ignored: ['**/freekill/**', '**/noname/**', '**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
