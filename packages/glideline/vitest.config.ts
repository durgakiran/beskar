import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      'src/spikes/**',
      'src/math.test.ts',
      'src/stress.test.ts',
    ],
    globals: false,
    // The suite contains threshold assertions for hot routing and RBush paths.
    // Cross-file CPU contention makes those measurements describe the runner,
    // not the product code under test.
    fileParallelism: false,
  },
});
