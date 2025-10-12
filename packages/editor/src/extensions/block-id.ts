import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface BlockIdOptions {
  types: string[];
}

/**
 * Extension that adds unique IDs to block nodes
 * Essential for block-based editor functionality
 */
export const BlockId = Extension.create<BlockIdOptions>({
  name: 'blockId',

  addOptions() {
    return {
      types: [
        'heading',
        'paragraph',
        'bulletList',
        'orderedList',
        'blockquote',
        'codeBlock',
        'table',
        'horizontalRule',
      ],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => {
              if (!attributes.blockId) {
                return {};
              }
              return {
                'data-block-id': attributes.blockId,
                class: 'block-node',
                draggable: 'false', // Only draggable via handle
              };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    
    return [
      new Plugin({
        key: new PluginKey('blockId'),
        
        view: () => {
          return {
            update: (view) => {
              // Run on initial load and whenever document changes
              let modified = false;
              const tr = view.state.tr;
              
              view.state.doc.descendants((node, pos) => {
                // Only process block-level nodes that are in our types list
                if (!this.options.types.includes(node.type.name)) {
                  return;
                }

                // Skip if already has blockId
                if (node.attrs.blockId) {
                  return;
                }

                // Generate unique block ID
                const blockId = `block-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  blockId,
                });

                modified = true;
              });

              if (modified) {
                view.dispatch(tr);
              }
            },
          };
        },
        
        appendTransaction: (transactions, oldState, newState) => {
          // Only run if document changed
          const docChanged = transactions.some((transaction) => transaction.docChanged);
          if (!docChanged) {
            return null;
          }

          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            // Only process block-level nodes that are in our types list
            if (!this.options.types.includes(node.type.name)) {
              return;
            }

            // Skip if already has blockId
            if (node.attrs.blockId) {
              return;
            }

            // Generate unique block ID
            const blockId = `block-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              blockId,
            });

            modified = true;
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

export default BlockId;

