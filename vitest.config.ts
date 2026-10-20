import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/scenarios/**/*.test.ts'],
    environment: 'node',
    // Bound CPU contention when other projects or agents are active.
    maxWorkers: 4,
  },
});
