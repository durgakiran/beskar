/**
 * InlineMath - An inline node for LaTeX math formulas within text
 * Allows users to add math formulas inside paragraphs
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { inlineMathInputRules } from './math-input-rules';
import { NodeSelection } from '@tiptap/pm/state';
import { InlineMathView } from '../components/math/InlineMathView';

export interface InlineMathOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineMath: {
      /**
       * Insert inline math node with LaTeX formula
       */
      setInlineMath: (latex?: string) => ReturnType;
      /**
       * Insert inline math with selected text as latex
       */
      insertInlineMath: () => ReturnType;
    };
  }
}

export const InlineMath = Node.create<InlineMathOptions>({
  name: 'inlineMath',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  inline: true,

  group: 'inline',

  atom: true, // Treat as a single unit

  addAttributes() {
    return {
      latex: {
        default: 'x^2',
        parseHTML: (element) => element.getAttribute('data-latex') ?? 'x^2',
        renderHTML: (attributes) => {
          return {
            'data-latex': attributes.latex,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="inline-math"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'inline-math',
        class: 'inline-math',
      }),
      node.attrs.latex,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView);
  },

  addCommands() {
    return {
      setInlineMath:
        (latex?: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { latex: latex ?? 'x^2' },
          });
        },
      
      insertInlineMath:
        () =>
        ({ state, tr, dispatch }) => {
          const { from, to, $from, $to } = state.selection;
          // Inline equations may only replace a selection in one text block.
          if (!$from.sameParent($to) || !$from.parent.inlineContent) return false;
          const latex = state.doc.textBetween(from, to, '').trim();
          if (dispatch) {
            tr.replaceSelectionWith(this.type.create({ latex }));
            tr.setSelection(NodeSelection.create(tr.doc, from));
          }
          return true;
        },
    };
  },

  renderText({ node }) { return `$$${node.attrs.latex}$$`; },

  addInputRules() { return inlineMathInputRules(this.type); },

  addKeyboardShortcuts() {
    return {
      // Mod-Shift-M to insert inline math
      'Mod-Shift-m': () => {
        return this.editor.commands.insertInlineMath();
      },
    };
  },
});

