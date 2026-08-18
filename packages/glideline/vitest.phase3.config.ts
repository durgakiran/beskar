import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    include: ['src/**/*.test.ts'],
    exclude: [
      'src/spikes/**',
      'src/math.test.ts',
      'src/stress.test.ts',
      'src/rbush.test.ts',
      'src/smart-router.test.ts',
    ],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: [
        'src/content-ingress.ts',
        'src/editor.ts',
        'src/store.ts',
        'src/shapes/RasterImageUtil.ts',
        'src/shapes/SanitizedSvgUtil.ts',
        'src/tools/AssetPlacementTool.ts',
        'src/tools/SelectTool.ts',
      ],
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: '/tmp/beskar-phase3-glideline-coverage',
    },
  },
});
