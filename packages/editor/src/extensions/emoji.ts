import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface EmojiOptions {
  suggestion?: {
    char?: string;
    allowSpaces?: boolean;
    startOfLine?: boolean;
  };
}

/**
 * Simple emoji extension that provides emoji shortcuts
 * Converts common emoji shortcuts like :) to 😊
 */
export const Emoji = Extension.create<EmojiOptions>({
  name: 'emoji',

  addOptions() {
    return {
      suggestion: {
        char: ':',
        allowSpaces: false,
        startOfLine: false,
      },
    };
  },

  addProseMirrorPlugins() {
    const emojiMap: Record<string, string> = {
      // Smileys
      ':)': '😊',
      ':-)': '😊',
      ':D': '😃',
      ':-D': '😃',
      ';)': '😉',
      ';-)': '😉',
      ':(': '😞',
      ':-(': '😞',
      ':p': '😛',
      ':-p': '😛',
      ':P': '😛',
      ':-P': '😛',
      ':o': '😮',
      ':-o': '😮',
      ':O': '😮',
      ':-O': '😮',
      // Hearts
      '<3': '❤️',
      // Hands
      ':thumbsup:': '👍',
      ':thumbsdown:': '👎',
      ':clap:': '👏',
      ':wave:': '👋',
      // Common
      ':fire:': '🔥',
      ':star:': '⭐',
      ':check:': '✅',
      ':cross:': '❌',
      ':warning:': '⚠️',
      ':bulb:': '💡',
      ':rocket:': '🚀',
      ':tada:': '🎉',
      ':sparkles:': '✨',
      ':eyes:': '👀',
      ':thinking:': '🤔',
    };

    return [
      new Plugin({
        key: new PluginKey('emoji'),
        
        appendTransaction: (transactions, oldState, newState) => {
          const docChanged = transactions.some((transaction) => transaction.docChanged);
          if (!docChanged) {
            return null;
          }

          const tr = newState.tr;
          let modified = false;

          // Check for emoji shortcuts in the document
          newState.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) {
              return;
            }

            const text = node.text;
            
            // Check for each emoji shortcut
            for (const [shortcut, emoji] of Object.entries(emojiMap)) {
              let index = text.indexOf(shortcut);
              
              while (index !== -1) {
                // Replace the shortcut with the emoji
                const from = pos + index;
                const to = from + shortcut.length;
                
                tr.replaceWith(from, to, newState.schema.text(emoji));
                modified = true;
                
                // Find next occurrence
                index = text.indexOf(shortcut, index + shortcut.length);
              }
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

export default Emoji;

