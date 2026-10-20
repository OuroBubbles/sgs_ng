import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default ts.config(
  {
    ignores: [
      'freekill/**',
      'noname/**',
      'dist/**',
      'node_modules/**',
      'src-tauri/**',
      '.artifacts/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.svelte'],
  })),
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.ts', '**/*.svelte'],
    languageOptions: {
      parserOptions: { projectService: true, extraFileExtensions: ['.svelte'], parser: ts.parser },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['src/core/**/*.ts', 'src/rules/**/*.ts', 'src/content/**/*.ts', 'src/sdk/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['svelte', 'pixi.js', '@tauri-apps/*', '**/client/**', '**/platform/**'] },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: '规则随机源必须显式注入。' },
        { object: 'Date', property: 'now', message: '规则不能依赖真实时间。' },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'svelte',
            'pixi.js',
            '@tauri-apps/*',
            '**/client/**',
            '**/platform/**',
            '**/rules/**',
            '**/content/**',
            '**/sdk/**',
            '**/app/**',
          ],
        },
      ],
    },
  },
  {
    files: ['src/client/**/*.ts', 'src/client/**/*.svelte'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/core/model/**',
            '**/core/state/**',
            '**/core/runtime/**',
            '**/core/history/**',
            '**/core/decisions/**',
            '**/rules/**',
            '**/content/**',
          ],
        },
      ],
    },
  },
  prettier,
);
