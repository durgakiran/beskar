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
      // Read theme.css first since editor.css imports it
      const themeCss = readFileSync(resolve(__dirname, 'src/styles/theme.css'), 'utf-8');
      const editorCss = readFileSync(resolve(__dirname, 'src/styles/editor.css'), 'utf-8');
      const bubbleMenuCss = readFileSync(resolve(__dirname, 'src/components/BubbleMenu.css'), 'utf-8');
      const slashCommandCss = readFileSync(resolve(__dirname, 'src/extensions/slash-command/SlashCommand.css'), 'utf-8');
      const mathBlockCss = readFileSync(resolve(__dirname, 'src/components/math/MathBlock.css'), 'utf-8');
      const tocCss = readFileSync(resolve(__dirname, 'src/components/toc/TableOfContents.css'), 'utf-8');
      const textColorPickerCss = readFileSync(resolve(__dirname, 'src/components/TextColorPicker.css'), 'utf-8');
      const commentPopupCss = readFileSync(resolve(__dirname, 'src/components/comments/CommentPopup.css'), 'utf-8');
      const emojiPickerCss = readFileSync(resolve(__dirname, 'src/components/comments/EmojiPicker.css'), 'utf-8');
      const deleteCommentModalCss = readFileSync(resolve(__dirname, 'src/components/comments/DeleteCommentModal.css'), 'utf-8');
      const endOfPageCommentsCss = readFileSync(resolve(__dirname, 'src/components/comments/EndOfPageComments.css'), 'utf-8');

      // Combine and write to dist - theme.css must come first
      const combinedCss = `${themeCss}\n\n${editorCss}\n\n/* Bubble Menu Styles */\n${bubbleMenuCss}\n\n/* Slash Command Styles */\n${slashCommandCss}\n\n/* Math Block Styles */\n${mathBlockCss}\n\n/* Table of Contents Styles */\n${tocCss}\n\n/* Text Color Picker Styles */\n${textColorPickerCss}\n\n/* Comment Popup Styles */\n${commentPopupCss}\n\n/* Emoji Picker Styles */\n${emojiPickerCss}\n\n/* Delete Comment Modal Styles */\n${deleteCommentModalCss}\n\n/* End of Page Comments Styles */\n${endOfPageCommentsCss}`;
      writeFileSync(resolve(__dirname, 'dist/styles.css'), combinedCss);
      console.log('✓ CSS files combined successfully');
    } catch (error) {
      console.error('✗ Failed to combine CSS files:', error);
    }
  },
});

