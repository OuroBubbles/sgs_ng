import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
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
  },
});
