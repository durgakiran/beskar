import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/validators.test.ts',
      'src/migrations.test.ts',
      'src/store.test.ts',
      'src/schema.test.ts',
      'src/integration.test.ts',
      'src/camera.test.ts',
      'src/editor.test.ts',
      'src/shapes.test.ts',
    ],
    globals: false,
  },
});
