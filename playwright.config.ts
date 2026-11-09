import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  // WebGL/Spine 与真实音频共用设备资源；串行验收，避免并发拖慢交互而错过 AI 结算间隙。
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '.artifacts/validation/browser.json' }]],
  use: { baseURL: 'http://127.0.0.1:1420', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'touch', use: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 } } },
  ],
  webServer: {
    command: 'pnpm preview',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    // 浏览器验收里 AI 用更浅的决定论预算，单次决策更快；单元测试仍用源码默认。
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      SGS_AI_MAX_DEPTH: '1',
      SGS_AI_PLAY_OPTIONS: '12',
      SGS_AI_BRANCHES: '3',
    },
  },
});
