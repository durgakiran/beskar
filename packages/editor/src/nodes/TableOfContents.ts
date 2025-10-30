/**
 * TableOfContents - A block node that displays a table of contents
 * Automatically generates from headings (H1-H3) in the document
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { TableOfContentsView } from '../components/toc/TableOfContentsView';

export interface TableOfContentsAttributes {
  title: string;
  maxLevel: number; // Maximum heading level to include (1-6)
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  draggable: true,
  
  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') || '',
        renderHTML: (attributes) => {
          return { 'data-title': attributes.title };
        },
      },
      maxLevel: {
        default: 3,
        parseHTML: (element) => {
          const level = element.getAttribute('data-max-level');
          return level ? parseInt(level, 10) : 3;
        },
        renderHTML: (attributes) => {
          return { 'data-max-level': attributes.maxLevel };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="table-of-contents"]',
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
          'data-type': 'table-of-contents',
          'data-title': node.attrs.title,
          'data-max-level': node.attrs.maxLevel,
        }
      ),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView);
  },

  addCommands() {
    return {
      setTableOfContents:
        (attributes?: Partial<TableOfContentsAttributes>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              title: attributes?.title !== undefined ? attributes.title : '',
              maxLevel: attributes?.maxLevel || 3,
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
          const updateTableOfContentsWrappers = () => {
            // Find all tableOfContents nodes and update their wrapper DOM elements
            view.state.doc.descendants((node, pos) => {
              if (node.type.name === 'tableOfContents') {
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
          setTimeout(updateTableOfContentsWrappers, 0);
          
          return {
            update: () => {
              updateTableOfContentsWrappers();
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
    tableOfContents: {
      setTableOfContents: (attributes?: Partial<TableOfContentsAttributes>) => ReturnType;
    };
  }
}

