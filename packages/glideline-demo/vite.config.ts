import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path';


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@preact/signals': resolve(__dirname, 'node_modules/@preact/signals'),
      'react': resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
    }
  },
  optimizeDeps: {
    include: ['@durgakiran/glideline', '@durgakiran/glideboard'],
  },
})
