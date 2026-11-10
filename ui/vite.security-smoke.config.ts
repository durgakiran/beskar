import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';
import path from 'node:path';
export default defineConfig(env => mergeConfig(base(env), {
    build: { outDir: path.resolve(__dirname, '../output/security-smoke'), rollupOptions: { input: { smoke: 'tests/security-smoke/index.html' } } },
}));
