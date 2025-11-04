import { Mark, mergeAttributes } from '@tiptap/core';

export interface CommentOptions {
  HTMLAttributes: Record<string, any>;
}

export interface CommentAttributes {
  commentId: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /**
       * Set a comment mark
       */
      setComment: (attributes: CommentAttributes) => ReturnType;
      /**
       * Toggle a comment mark
       */
      toggleComment: (attributes: CommentAttributes) => ReturnType;
      /**
       * Unset a comment mark
       */
      unsetComment: () => ReturnType;
    };
  }
}

/**
 * Comment mark extension for inline comments
 * Similar to Highlight, but stores commentId instead of color
 */
export const Comment = Mark.create<CommentOptions>({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'comment-mark',
      },
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) => {
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
        tag: 'mark[data-comment-id]',
        getAttrs: (node) => {
          if (typeof node === 'string') return false;
          const element = node as HTMLElement;
          const commentId = element.getAttribute('data-comment-id');
          return commentId ? { commentId } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (attributes: CommentAttributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      toggleComment:
        (attributes: CommentAttributes) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attributes);
        },
      unsetComment:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },
});

