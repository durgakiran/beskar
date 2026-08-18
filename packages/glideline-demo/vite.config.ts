import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path';


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@durgakiran\/glideboard$/, replacement: resolve(__dirname, '../glideboard/dist/index.js') },
      { find: /^@durgakiran\/glideboard\/styles\.css$/, replacement: resolve(__dirname, '../glideboard/dist/styles.css') },
      { find: '@preact/signals', replacement: resolve(__dirname, 'node_modules/@preact/signals') },
      { find: 'react-dom', replacement: resolve(__dirname, 'node_modules/react-dom') },
      { find: 'react', replacement: resolve(__dirname, 'node_modules/react') },
      { find: 'yjs', replacement: resolve(__dirname, 'node_modules/yjs') },
      { find: 'y-protocols', replacement: resolve(__dirname, 'node_modules/y-protocols') },
    ],
    dedupe: ['react', 'react-dom', 'yjs', 'y-protocols'],
  },
  optimizeDeps: {
    include: ['@durgakiran/glideline', '@durgakiran/glideboard'],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /packages\/glideline\/dist/],
    },
  },
})
