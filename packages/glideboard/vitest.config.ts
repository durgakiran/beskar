import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
      yjs: resolve(__dirname, 'node_modules/yjs'),
    },
    dedupe: ['react', 'react-dom', 'yjs', 'y-protocols', '@tiptap/core', '@tiptap/pm'],
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    server: {
      deps: {
        inline: [/@durgakiran\/canvas-text-editor/, /@tiptap\//, /y-protocols/],
      },
    },
  },
});
