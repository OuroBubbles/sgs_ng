import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const mediaTypes = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.atlas': 'text/plain',
  '.skel': 'application/octet-stream',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** 打包普通 TS 模块，SDK 保持为宿主参数，避免复制 Window/Class 身份。 */
async function compileContent(entry, externalAssets) {
  const entryPath = resolve(entry);
  const virtualEntry = '\0sgs-content-entry';
  const resourcePrefix = '\0sgs-resource:';
  const assets = new Map();
  const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
  const sdkRoot = resolve(sourceRoot, 'sdk');
  const sdkPaths = new Set([
    sdkRoot,
    resolve(sdkRoot, 'index'),
    resolve(sdkRoot, 'index.ts'),
    resolve(sdkRoot, 'index.js'),
  ]);
  const inside = (parent, file) => {
    const path = relative(parent, file);
    return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  };
  const result = await build({
    root: externalAssets ? dirname(entryPath) : undefined,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    plugins: [
      {
        name: 'sgs-content-sdk',
        enforce: 'pre',
        async resolveId(source, importer) {
          if (source === virtualEntry) return virtualEntry;
          if (!importer || (!source.startsWith('.') && !isAbsolute(source))) return;
          const file = resolve(dirname(importer), source);
          if (sdkPaths.has(file)) return { id: '@sgs/sdk', external: true };
          if (externalAssets) {
            const [path, query] = source.split('?');
            const extension = extname(path).toLowerCase();
            if (query === 'url' || (!query && extension !== '.json' && mediaTypes[extension])) {
              const resource = resolve(dirname(importer), path);
              const bytes = await readFile(resource);
              const local = inside(dirname(entryPath), resource)
                ? relative(dirname(entryPath), resource).split(sep).join('/')
                : `_shared/${createHash('sha256').update(bytes).digest('hex')}/${basename(resource)}`;
              const assetPath = `assets/${local}`;
              assets.set(assetPath, {
                bytes,
                type: mediaTypes[extension] ?? 'application/octet-stream',
              });
              return resourcePrefix + assetPath;
            }
          }
        },
        async load(id) {
          if (id === virtualEntry)
            return `export { default } from ${JSON.stringify(entryPath.replaceAll('\\', '/'))};`;
          if (id.startsWith(resourcePrefix)) {
            const path = id.slice(resourcePrefix.length);
            return `import { url } from '@sgs/assets'; export default url(${JSON.stringify(path)});`;
          }
        },
        moduleParsed(info) {
          const file = info.id.split('?')[0];
          if (isAbsolute(file) && inside(sourceRoot, file) && !inside(dirname(entryPath), file))
            this.error(
              `Content modules must import host APIs through @sgs/sdk: ${relative(sourceRoot, file)}`,
            );
        },
      },
    ],
    build: {
      target: 'es2022',
      write: false,
      minify: false,
      sourcemap: false,
      lib: { entry: entryPath, name: '__sgs_content__', formats: ['iife'] },
      rolldownOptions: {
        cwd: externalAssets ? dirname(entryPath) : undefined,
        input: virtualEntry,
        external: ['@sgs/sdk', '@sgs/assets'],
        output: {
          globals: { '@sgs/sdk': 'sdk', '@sgs/assets': 'assets' },
          exports: 'default',
          codeSplitting: false,
        },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output ?? []);
  if (outputs.length !== 1 || outputs[0].type !== 'chunk')
    throw new Error('A content module must produce one JavaScript chunk. Inline its resources.');
  const code = `// Built by sgs_ng; ordinary trusted content code.\nexport const format = 'sgs-content/1';\nexport default function createContent(sdk${externalAssets ? ', assets' : ''}) {\n${outputs[0].code}\nreturn __sgs_content__;\n}\n`;
  return { code, assets };
}

/** 单文件仍内联资源；独立资源包使用相同的普通 TS 入口。 */
export async function bundleContent(entry) {
  return (await compileContent(entry, false)).code;
}

export async function bundleContentArchive(entry) {
  const { code, assets } = await compileContent(entry, true);
  const ordered = [...assets].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const manifest = {
    format: 'sgs-bundle/1',
    module: 'content.sgs.mjs',
    assets: ordered.map(([path, asset]) => ({ path, type: asset.type })),
  };
  // 固定 ZIP 时间与文件顺序，原始资源字节不转换、不嵌入源码。
  const files = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'content.sgs.mjs': strToU8(code),
    ...Object.fromEntries(ordered.map(([path, asset]) => [path, asset.bytes])),
  };
  return zipSync(files, { level: 6, mtime: new Date(2000, 0, 1) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [entry, destination] = process.argv.slice(2);
  if (!entry || !destination)
    throw new Error('Usage: pnpm content:build <entry.ts> <output.sgs.mjs | output.sgs>');
  const code = destination.endsWith('.sgs')
    ? await bundleContentArchive(entry)
    : await bundleContent(entry);
  await mkdir(dirname(resolve(destination)), { recursive: true });
  await writeFile(destination, code, typeof code === 'string' ? 'utf8' : undefined);
  console.log(`Content module: ${resolve(destination)} (${Buffer.byteLength(code)} bytes)`);
}
