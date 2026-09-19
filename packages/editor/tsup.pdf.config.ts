import { defineConfig } from 'tsup';

// Separate entry keeps PDF/font/math payloads out of the editor's initial bundle.
export default defineConfig({
  entry: { pdf: 'src/pdf/index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: false,
  external: ['@tiptap/core'],
  noExternal: [/^pdfmake\//, /^mathjax-full\//],
  target: 'es2020',
});
