import { defineConfig } from 'vitest/config';
import { protocolHash, contentHash } from './scripts/network-build.mjs';

export default defineConfig({
  define: {
    __SGS_PROTOCOL_HASH__: JSON.stringify(protocolHash()),
    __SGS_CONTENT_HASH__: JSON.stringify(contentHash()),
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/scenarios/**/*.test.ts'],
    environment: 'node',
    // 长整局场景需要稳定的 CPU 预算；保持原有断言与时限，避免并发挤占执行时间。
    maxWorkers: 2,
  },
});
