import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', 'yjs', 'tldraw', '@tldraw/editor'],
    treeshake: true,
    minify: false,
    tsconfig: './tsconfig.json',
    onSuccess: async () => {
        try {
            const tldrawCss = readFileSync(
                resolve(__dirname, 'node_modules/tldraw/tldraw.css'),
                'utf-8',
            );
            const whiteboardCss = readFileSync(resolve(__dirname, 'src/styles/whiteboard.css'), 'utf-8');
            const toolbarCss = readFileSync(resolve(__dirname, 'src/styles/toolbar.css'), 'utf-8');
            const shapeLibCss = readFileSync(resolve(__dirname, 'src/styles/shape-library.css'), 'utf-8');

            const combinedCss = [
                '/* tldraw base styles */',
                tldrawCss,
                '/* Whiteboard theme */',
                whiteboardCss,
                '/* Toolbar + Overlay styles */',
                toolbarCss,
                '/* Shape Library Panel */',
                shapeLibCss,
            ].join('\n\n');

            writeFileSync(resolve(__dirname, 'dist/styles.css'), combinedCss);
            console.log('✓ CSS files combined successfully (tldraw + whiteboard + toolbar + shape-library)');
        } catch (error) {
            console.error('✗ Failed to combine CSS files:', error);
        }
    },
});
