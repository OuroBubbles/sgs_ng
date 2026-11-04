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
            {
              group: [
                '**/core/model/**',
                '**/core/state/**',
                '**/core/runtime/**',
                '**/core/history/**',
                '**/core/decisions/**',
                '**/core/view/**',
              ],
              message: 'client 只消费 src/protocol 展示契约，不直连 core。',
            },
            {
              group: ['**/rules/**', '**/content/**', '**/sdk/**'],
              message: 'client 禁止导入规则或内容模块。',
            },
            {
              group: [
                '**/app/offline/**',
                '**/offline/**',
                '**/role-match*',
                '**/app/network/room*',
                '**/server/**',
              ],
              message: 'client 禁止导入 offline/host/server；联机只走 RemoteSession。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/protocol/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/rules/**',
                '**/content/**',
                '**/sdk/**',
                '**/client/**',
                '**/app/**',
                '**/server/**',
                '**/platform/**',
                'svelte',
                'pixi.js',
                '@tauri-apps/*',
              ],
              message: 'protocol 仅为纯数据契约，不得依赖规则、内容或 UI。',
            },
            {
              group: ['**/core/**'],
              message: 'protocol 不得依赖 core 实现；视图类型以本目录为准。',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
