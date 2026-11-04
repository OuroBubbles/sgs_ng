import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';

/**
 * 网页端只含界面与素材（P2）。从 src/main.ts 出发沿运行时导入走一遍，
 * 任何规则、内容、主持端或服务端模块被拉进浏览器包都会在这里失败。
 * 仅类型导入会被擦除，不计入；它们由 eslint 的网页端禁令约束。
 */
const root = resolve(import.meta.dirname, '../..');
const forbidden = /^src\/(core|rules|content|sdk|host|server)\/|assets\.json$/;

function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  const statement = /\b(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(statement)) if (!match[2]) found.push(match[3]!);
  for (const match of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1]!);
  return found;
}
function scripts(file: string, source: string): string {
  if (!file.endsWith('.svelte')) return source;
  return [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}
function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier.replace(/\?.*$/, ''));
  for (const candidate of [
    base,
    `${base}.ts`,
    base.replace(/\.js$/, '.ts'),
    join(base, 'index.ts'),
  ])
    if (existsSync(candidate) && !candidate.endsWith('/') && /\.\w+$/.test(candidate))
      return candidate;
  throw new Error(`无法解析 ${specifier}（来自 ${relative(root, from)}）`);
}
function webGraph(): Set<string> {
  const seen = new Set<string>();
  const queue = [join(root, 'src/main.ts')];
  while (queue.length) {
    const file = queue.pop()!;
    const name = relative(root, file).split(sep).join('/');
    if (seen.has(name)) continue;
    seen.add(name);
    if (!/\.(ts|svelte)$/.test(file)) continue;
    for (const specifier of specifiers(scripts(file, readFileSync(file, 'utf8')))) {
      const target = resolveImport(file, specifier);
      if (target) queue.push(target);
    }
  }
  return seen;
}

it('浏览器入口的运行时导入图不含规则、内容、主持端与服务端', () => {
  const graph = webGraph();
  expect(graph.has('src/app/App.svelte')).toBe(true);
  expect(graph.has('src/app/session.ts')).toBe(true);
  expect([...graph].filter((file) => forbidden.test(file))).toEqual([]);
  // 走查本身要覆盖整个界面，而不是停在入口。
  expect([...graph].filter((file) => file.startsWith('src/client/')).length).toBeGreaterThan(20);
});

it('导入扫描能识别禁区模块（防止检查本身失效）', () => {
  expect(
    specifiers(
      `import { a } from '../core/x';\nimport type { B } from '../rules/y';\nexport * from './z';\nconst m = import('../host/solo');`,
    ),
  ).toEqual(['../core/x', './z', '../host/solo']);
  expect(forbidden.test('src/host/solo.ts')).toBe(true);
  expect(forbidden.test('src/content/standard/assets.json')).toBe(true);
  expect(forbidden.test('src/protocol/wire.ts')).toBe(false);
});
