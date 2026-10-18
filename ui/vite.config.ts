import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { existsSync } from 'node:fs';

// Docker's /packages/editor contains the PDF-only build. Its main editor and
// styles come from node_modules (optionally overlaid by builder-local-packages).
// Use workspace outputs together, so a partial build cannot split the package.
const workspaceEditorDist = path.resolve(__dirname, '../packages/editor/dist');
const hasWorkspaceEditor = ['index.mjs', 'styles.css', 'index.css']
  .every(file => existsSync(path.join(workspaceEditorDist, file)));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@durgakiran/editor/pdf': path.resolve(__dirname, '../packages/editor/dist/pdf.mjs'),
      ...(hasWorkspaceEditor ? {
        '@durgakiran/editor/styles.css': path.join(workspaceEditorDist, 'styles.css'),
        '@durgakiran/editor/index.css': path.join(workspaceEditorDist, 'index.css'),
        '@durgakiran/editor': path.join(workspaceEditorDist, 'index.mjs'),
      } : {}),
      '@http/hooks':        path.resolve(__dirname, 'app/core/http/hooks'),
      '@http':              path.resolve(__dirname, 'app/core/http'),
      '@editor':            path.resolve(__dirname, 'app/core/editor'),
      '@components':        path.resolve(__dirname, 'app/components'),
      '@queries/space':     path.resolve(__dirname, 'app/core/queries/space'),
      '@/lib/utils':        path.resolve(__dirname, 'app/lib/utils/index.ts'),
      'app':                path.resolve(__dirname, 'app'),
    },
    dedupe: [
      '@tiptap/core',
      '@tiptap/pm',
      '@tiptap/react',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-model',
      'prosemirror-transform',
      'y-prosemirror',
      'react',
      'react-dom'
    ],
  },
  server: {
    proxy: {
      '/auth': { target: 'http://localhost:9095', changeOrigin: true },
      '/api/v1/media': { target: 'http://localhost:9245', changeOrigin: true },
      '/api':  { target: 'http://localhost:9095', changeOrigin: true },
      '/ws':   { target: 'ws://localhost:8086',  ws: true, changeOrigin: true },
    },
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /packages\/glideline\/dist/],
    },
    rollupOptions: {
      input: mode === 'desktop'
        ? { desktop: 'index.desktop.html' }
        : { main: 'index.html' },
    },
  },
}));
