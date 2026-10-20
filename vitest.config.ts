import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/scenarios/**/*.test.ts'],
    environment: 'node',
  },
});
