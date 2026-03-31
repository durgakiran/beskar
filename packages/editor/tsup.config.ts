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
  external: [
    // React
    'react',
    'react-dom',
    // Radix
    '@radix-ui/themes',
    // Core TipTap singletons — must be the exact same instance as the host app.
    '@tiptap/core',
    '@tiptap/react',
    '@tiptap/pm',
    '@tiptap/y-tiptap',
    '@tiptap/extension-collaboration',
    '@tiptap/extension-collaboration-caret',
    // All ProseMirror packages — EditorView / Schema / Plugin are compared by reference
    /^prosemirror-/,
    // Yjs ecosystem
    'yjs',
    'y-protocols',
    'y-prosemirror',
    '@hocuspocus/provider',
  ],
  // Force-bundle all TipTap extension packages and other deps so they are inlined
  // into this dist rather than left as external imports pointing at
  // /opt/packages/editor/node_modules/ (which has its own @tiptap/pm copy).
  // Bundled code still imports @tiptap/pm / @tiptap/core externally above,
  // so the singleton constraint is preserved.
  noExternal: [
    /^@tiptap\/extension-(?!collaboration)/,
    '@tiptap/starter-kit',
    '@tiptap/suggestion',
  ],
  treeshake: true,
  minify: false,
  tsconfig: './tsconfig.json',
  onSuccess: async () => {
    // Copy CSS files to dist
    try {
      // Read theme.css first since editor.css imports it
      const themeCss = readFileSync(resolve(__dirname, 'src/styles/theme.css'), 'utf-8');
      const editorCss = readFileSync(resolve(__dirname, 'src/styles/editor.css'), 'utf-8');
      const bubbleMenuCss = readFileSync(resolve(__dirname, 'src/components/BubbleMenu.css'), 'utf-8');
      const slashCommandCss = readFileSync(resolve(__dirname, 'src/extensions/slash-command/SlashCommand.css'), 'utf-8');
      const mathBlockCss = readFileSync(resolve(__dirname, 'src/components/math/MathBlock.css'), 'utf-8');
      const tocCss = readFileSync(resolve(__dirname, 'src/components/toc/TableOfContents.css'), 'utf-8');
      const textColorPickerCss = readFileSync(resolve(__dirname, 'src/components/TextColorPicker.css'), 'utf-8');

      // Combine and write to dist - theme.css must come first
      const combinedCss = `${themeCss}\n\n${editorCss}\n\n/* Bubble Menu Styles */\n${bubbleMenuCss}\n\n/* Slash Command Styles */\n${slashCommandCss}\n\n/* Math Block Styles */\n${mathBlockCss}\n\n/* Table of Contents Styles */\n${tocCss}\n\n/* Text Color Picker Styles */\n${textColorPickerCss}`;
      writeFileSync(resolve(__dirname, 'dist/styles.css'), combinedCss);
      console.log('✓ CSS files combined successfully');
    } catch (error) {
      console.error('✗ Failed to combine CSS files:', error);
    }
  },
});

