import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface CommentOptions {
  onCommentOrphaned?: (commentId: string) => void;
  HTMLAttributes: Record<string, any>;
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
      onCommentOrphaned: undefined,
      HTMLAttributes: {
        class: 'comment-highlight',
      },
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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('commentOrphanDetection'),
        appendTransaction: (transactions, oldState, newState) => {
          const { onCommentOrphaned } = this.options;
          if (!onCommentOrphaned) return;

          const docChanged = transactions.some(tr => tr.docChanged);
          if (!docChanged) return;

          // Find all comment UUIDs in old doc
          const oldCommentIds = new Set<string>();
          oldState.doc.descendants((node) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.commentId) {
                oldCommentIds.add(mark.attrs.commentId);
              }
            });
          });

          // Find all comment UUIDs in new doc
          const newCommentIds = new Set<string>();
          newState.doc.descendants((node) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.commentId) {
                newCommentIds.add(mark.attrs.commentId);
              }
            });
          });

          // Find difference
          oldCommentIds.forEach((id) => {
            if (!newCommentIds.has(id)) {
              // Defer callback to avoid state update loops inside transactions
              setTimeout(() => {
                onCommentOrphaned(id);
              }, 0);
            }
          });

          return undefined;
        },
      }),
    ];
  },
});
