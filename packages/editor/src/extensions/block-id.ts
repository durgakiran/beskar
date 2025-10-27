import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { blockDragDropKey } from './block-drag-drop';

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
        'listItem',
        'blockquote',
        'codeBlock',
        'codeBlockLowlight',
        'table',
        'horizontalRule',
        'details',
        'detailsSummary',
        'detailsContent',
        'noteBlock',
      ],
    };
  },

  addGlobalAttributes() {
    return [
      {
        // Exclude 'table' from global rendering - it handles its own wrapper rendering
        types: this.options.types.filter(type => type !== 'table'),
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => {
              // Only render block attributes if blockId exists
              // This prevents table cell content from being treated as blocks
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
    
    // Helper to check if a position is inside a table
    const isInsideTable = (doc: any, pos: number): boolean => {
      const $pos = doc.resolve(pos);
      for (let i = $pos.depth; i > 0; i--) {
        const node = $pos.node(i);
        if (node.type.name === 'table' || node.type.name === 'tableRow' || node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          return true;
        }
      }
      return false;
    };
    
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

                const isInTable = node.type.name !== 'table' && isInsideTable(view.state.doc, pos);

                // If node is inside a table and has a blockId, remove it
                if (isInTable && node.attrs.blockId) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    blockId: null,
                  });
                  modified = true;
                  return;
                }

                // Skip if already has blockId or is inside table
                if (node.attrs.blockId || isInTable) {
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
          // Skip during drag operations to prevent table corruption
          const dragState = blockDragDropKey.getState(newState);
          if (dragState?.isDragging) {
            return null;
          }
          
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

            const isInTable = node.type.name !== 'table' && isInsideTable(newState.doc, pos);

            // If node is inside a table and has a blockId, remove it
            if (isInTable && node.attrs.blockId) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                blockId: null,
              });
              modified = true;
              return;
            }

            // Skip if already has blockId or is inside table
            if (node.attrs.blockId || isInTable) {
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

