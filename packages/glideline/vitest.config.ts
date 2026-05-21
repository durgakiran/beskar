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
  },
});
