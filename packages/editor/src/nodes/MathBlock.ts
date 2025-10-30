/**
 * MathBlock - A custom block node for LaTeX math formulas
 * Supports both inline and display (block) mode using KaTeX
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { MathBlockView } from '../components/math/MathBlockView';

export interface MathBlockAttributes {
  latex: string;
  displayMode: boolean; // true for block (display) mode, false for inline
}

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  draggable: true,
  
  addAttributes() {
    return {
      latex: {
        default: 'c = \\pm\\sqrt{a^2 + b^2}',
        parseHTML: (element) => element.getAttribute('data-latex') || '',
        renderHTML: (attributes) => {
          return { 'data-latex': attributes.latex };
        },
      },
      displayMode: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-display-mode') === 'true',
        renderHTML: (attributes) => {
          return { 'data-display-mode': attributes.displayMode };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="math-block"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Exclude blockId from serialization (it should be unique per block)
    const { blockId, ...attributesWithoutBlockId } = HTMLAttributes as any;
    
    return [
      'div',
      mergeAttributes(
        attributesWithoutBlockId,
        {
          'data-type': 'math-block',
          'data-latex': node.attrs.latex,
          'data-display-mode': node.attrs.displayMode,
        }
      ),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView);
  },

  addCommands() {
    return {
      setMathBlock:
        (attributes?: Partial<MathBlockAttributes>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              latex: attributes?.latex || 'c = \\pm\\sqrt{a^2 + b^2}',
              displayMode: attributes?.displayMode ?? true,
            },
          });
        },
    };
  },

  addProseMirrorPlugins() {
    const { isEditable } = this.editor;

    if (!isEditable) {
      return [];
    }

    return [
      // Plugin to sync blockId attribute to the React wrapper DOM
      new Plugin({
        view: (view) => {
          const updateMathBlockWrappers = () => {
            // Find all mathBlock nodes and update their wrapper DOM elements
            view.state.doc.descendants((node, pos) => {
              if (node.type.name === 'mathBlock') {
                const blockId = node.attrs.blockId;
                const dom = view.nodeDOM(pos);
                
                if (dom) {
                  // For React NodeViews, the wrapper is .react-renderer
                  const htmlDom = dom as HTMLElement;
                  const wrapper = htmlDom.classList?.contains('react-renderer') 
                    ? htmlDom 
                    : htmlDom.closest?.('.react-renderer');
                  
                  if (wrapper) {
                    if (blockId) {
                      wrapper.setAttribute('data-block-id', blockId);
                      wrapper.classList.add('block-node');
                      wrapper.setAttribute('draggable', 'false');
                    } else {
                      wrapper.removeAttribute('data-block-id');
                      wrapper.classList.remove('block-node');
                      wrapper.removeAttribute('draggable');
                    }
                  }
                }
              }
            });
          };
          
          // Update on initial mount
          setTimeout(updateMathBlockWrappers, 0);
          
          return {
            update: () => {
              updateMathBlockWrappers();
            },
          };
        },
      }),
    ];
  },
});

// Extend the editor commands
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      setMathBlock: (attributes?: Partial<MathBlockAttributes>) => ReturnType;
    };
  }
}

