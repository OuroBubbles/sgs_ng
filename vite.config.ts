import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tauriConfig from './src-tauri/tauri.conf.json' with { type: 'json' };
import { networkBuild } from './scripts/network-build.mjs';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  define: { __SGS_NETWORK_BUILD__: JSON.stringify(networkBuild()) },
  plugins: [svelte()],
  clearScreen: false,
  preview: { headers: { 'Content-Security-Policy': tauriConfig.app.security.csp } },
  server: {
    host: host ?? '127.0.0.1',
    port: 1420,
    strictPort: true,
    ...(host ? { hmr: { protocol: 'ws', host, port: 1421 } } : {}),
    watch: { ignored: ['**/freekill/**', '**/noname/**', '**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
