import { build } from 'vite';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { protocolHash, contentHash } from './network-build.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64' || !process.version.startsWith('v24.'))
  throw new Error('Desktop host delivery requires the project Windows x64 Node.js 24 runtime.');
const root = resolve('.artifacts/desktop-host');
await mkdir(root, { recursive: true });
await build({
  configFile: false,
  define: {
    __SGS_PROTOCOL_HASH__: JSON.stringify(protocolHash()),
    __SGS_CONTENT_HASH__: JSON.stringify(contentHash()),
  },
  ssr: { noExternal: ['ws'] },
  build: {
    ssr: 'src/server/desktop-host.ts',
    target: 'node24',
    outDir: root,
    emptyOutDir: false,
    sourcemap: false,
    rolldownOptions: { output: { entryFileNames: 'main.mjs', codeSplitting: false } },
  },
});
await copyFile(process.execPath, join(root, 'node.exe'));
const require = createRequire(import.meta.url);
const licenses = await Promise.all([
  readFile(join(dirname(process.execPath), 'LICENSE'), 'utf8'),
  readFile(join(dirname(require.resolve('ws/package.json')), 'LICENSE'), 'utf8'),
]);
await writeFile(
  join(root, 'LICENSE.txt'),
  `Node.js ${process.version}\n\n${licenses[0]}\n\nws\n\n${licenses[1]}`,
);
console.log(`Desktop host: ${root}; Node.js ${process.version}, bundled ws and existing rules.`);
