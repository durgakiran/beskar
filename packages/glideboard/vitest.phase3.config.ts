import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@durgakiran/glideline': new URL('../glideline/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    fileParallelism: false,
    maxWorkers: 1,
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/editor.ts',
        'src/GlideboardController.ts',
        'src/WhiteboardApp.tsx',
        'src/Glideboard.tsx',
        'src/Canvas.tsx',
        'src/Toolbar.tsx',
        'src/AssetPlacementStatus.tsx',
        'src/AssetsPanel.tsx',
        'src/AssetImportPanel.tsx',
        'src/StylePanel.tsx',
        'src/asset-library.ts',
      ],
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: '/tmp/beskar-phase3-glideboard-coverage',
    },
  },
});
