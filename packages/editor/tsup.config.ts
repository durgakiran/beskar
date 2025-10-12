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
  external: ['react', 'react-dom'],
  treeshake: true,
  minify: false,
  tsconfig: './tsconfig.json',
  onSuccess: async () => {
    // Copy CSS files to dist
    try {
      const editorCss = readFileSync(resolve(__dirname, 'src/styles/editor.css'), 'utf-8');
      const bubbleMenuCss = readFileSync(resolve(__dirname, 'src/components/BubbleMenu.css'), 'utf-8');
      const slashCommandCss = readFileSync(resolve(__dirname, 'src/extensions/slash-command/SlashCommand.css'), 'utf-8');

      // Combine and write to dist
      const combinedCss = `${editorCss}\n\n/* Bubble Menu Styles */\n${bubbleMenuCss}\n\n/* Slash Command Styles */\n${slashCommandCss}`;
      writeFileSync(resolve(__dirname, 'dist/styles.css'), combinedCss);
      console.log('✓ CSS files combined successfully');
    } catch (error) {
      console.error('✗ Failed to combine CSS files:', error);
    }
  },
});

