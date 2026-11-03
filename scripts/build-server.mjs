import { build } from 'vite';
import { networkBuild } from './network-build.mjs';
import { resolve, sep } from 'node:path';

const artifactRoot = resolve('.artifacts');
const output = resolve(process.argv[3] ?? '.artifacts/server');
if (!output.startsWith(artifactRoot + sep))
  throw new Error('SSR build output must stay inside the project .artifacts directory.');

// 常规 Vite SSR 构建：开发者可指定普通入口，测试使用同一构建方式。
await build({
  configFile: false,
  define: { __SGS_NETWORK_BUILD__: JSON.stringify(networkBuild()) },
  build: {
    ssr: process.argv[2] ?? 'src/server/main.ts',
    target: 'node24',
    outDir: output,
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: { output: { entryFileNames: 'main.mjs' } },
  },
});
