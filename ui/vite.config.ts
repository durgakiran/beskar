import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@http/hooks':        path.resolve(__dirname, 'app/core/http/hooks'),
      '@http':              path.resolve(__dirname, 'app/core/http'),
      '@editor':            path.resolve(__dirname, 'app/core/editor'),
      '@components':        path.resolve(__dirname, 'app/components'),
      '@queries/space':     path.resolve(__dirname, 'app/core/queries/space'),
      '@/lib/utils':        path.resolve(__dirname, 'app/lib/utils/index.ts'),
      'app':                path.resolve(__dirname, 'app'),
    },
  },
  server: {
    proxy: {
      '/auth': { target: 'http://localhost:9095', changeOrigin: true },
      '/api':  { target: 'http://localhost:9095', changeOrigin: true },
      '/ws':   { target: 'ws://localhost:8086',  ws: true, changeOrigin: true },
    },
  },
});
