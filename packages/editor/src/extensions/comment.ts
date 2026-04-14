import { Mark, mergeAttributes } from '@tiptap/core';

export interface CommentOptions {
  HTMLAttributes: Record<string, any>;
  onAddCommentShortcut?: () => void;
  onNextCommentShortcut?: () => void;
  onPrevCommentShortcut?: () => void;
}


declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /**
       * Add a comment mark to the selection
       */
      addComment: (commentId: string) => ReturnType;
      /**
       * Remove a specific comment mark by ID from the document
       */
      removeComment: (commentId: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create<CommentOptions>({
  name: 'comment',

  addOptions() {
    return {
      // Note: CommentMark renders as a plain span with NO visual styling.
      // The CommentDecoration plugin (anchor-based) is the sole source of
      // highlight rendering. Keeping this mark as a no-op span preserves
      // backward-compat for documents that were saved before the anchor
      // migration — the mark data is still round-tripped through Yjs but
      // produces no visible highlights. All visual output comes from decorations.
      HTMLAttributes: {},
      onAddCommentShortcut: undefined,
      onNextCommentShortcut: undefined,
      onPrevCommentShortcut: undefined,
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attributes => {
          if (!attributes.commentId) {
            return {};
          }
          return {
            'data-comment-id': attributes.commentId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      addComment: (commentId: string) => ({ commands }) => {
        return commands.setMark(this.name, { commentId });
      },
      removeComment: (commentId: string) => ({ tr, dispatch }) => {
        let modified = false;
        tr.doc.descendants((node, pos) => {
          node.marks.forEach(mark => {
            if (mark.type.name === this.name && mark.attrs.commentId === commentId) {
              tr.removeMark(pos, pos + node.nodeSize, mark.type);
              modified = true;
            }
          });
        });
        if (modified && dispatch) {
          dispatch(tr);
        }
        return modified;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-m': () => {
        if (this.options.onAddCommentShortcut) {
          this.options.onAddCommentShortcut();
          return true;
        }
        return false;
      },
      'Alt-]': () => {
        if (this.options.onNextCommentShortcut) {
          this.options.onNextCommentShortcut();
          return true;
        }
        return false;
      },
      'Alt-[': () => {
        if (this.options.onPrevCommentShortcut) {
          this.options.onPrevCommentShortcut();
          return true;
        }
        return false;
      },
    };
  },

});
