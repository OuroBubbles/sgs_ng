import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative as nativeRelative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const relative = (from: string, to: string) => nativeRelative(from, to).split(sep).join('/');

// 样式与 Pixi 的 CSP 适配只以裸 import 生效；没有任何符号引用它们，类型检查、
// lint 与逻辑测试都不会因删除而失败，只有浏览器里布局才会坏掉。
const root = resolve(__dirname, '../../src');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const sources = files(root);
const text = (file: string) => readFileSync(file, 'utf8');
const imported = (file: string) =>
  [...text(file).matchAll(/@?import\s+(?:url\()?['"]([^'"]+\.css)['"]/g)].map((match) =>
    resolve(dirname(file), match[1]!),
  );

describe('side-effect imports', () => {
  it('every stylesheet is reachable from the app entry', () => {
    const reached = new Set<string>();
    const visit = (file: string) => {
      for (const next of imported(file))
        if (!reached.has(next)) {
          reached.add(next);
          visit(next);
        }
    };
    for (const file of sources.filter((file) => /\.(ts|svelte)$/.test(file))) visit(file);
    const sheets = sources.filter((file) => file.endsWith('.css'));
    expect(sheets.filter((file) => !reached.has(file)).map((file) => relative(root, file))).toEqual(
      [],
    );
    expect(imported(join(root, 'main.ts')).map((file) => relative(root, file))).toEqual([
      'client/style.css',
      'client/refinements.css',
      'client/table/surface.css',
    ]);
  });

  it('every Pixi application installs the no-eval adapter for the production CSP', () => {
    const apps = sources.filter(
      (file) =>
        file.endsWith('.ts') && !file.endsWith('.test.ts') && /new Application\(/.test(text(file)),
    );
    expect(apps.length).toBeGreaterThan(0);
    for (const file of apps)
      expect(text(file), relative(root, file)).toMatch(/^import 'pixi\.js\/unsafe-eval';$/m);
  });
});
