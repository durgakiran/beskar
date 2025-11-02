import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { blockDragDropKey } from './block-drag-drop';
import { Fragment, Slice } from '@tiptap/pm/model';

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
        'taskList',
        'blockquote',
        'codeBlock', // CodeBlockLowlight extends CodeBlock, so it uses 'codeBlock' as node type
        'table',
        'horizontalRule',
        'details', // Only details should be a block, not detailsSummary/detailsContent
        'noteBlock',
        'imageBlock',
        'mathBlock',
        'tableOfContents',
      ],
    };
  },

  addGlobalAttributes() {
    return [
      {
        // Exclude 'table' and 'codeBlock' from global rendering - codeBlock handles its own wrapper rendering
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
    
    // Helper to check if a position is inside a list
    const isInsideList = (doc: any, pos: number): boolean => {
      const $pos = doc.resolve(pos);
      for (let i = $pos.depth; i > 0; i--) {
        const node = $pos.node(i);
        if (node.type.name === 'bulletList' || node.type.name === 'orderedList' || node.type.name === 'taskList' || node.type.name === 'listItem' || node.type.name === 'taskItem') {
          return true;
        }
      }
      return false;
    };
    
    return [
      new Plugin({
        key: new PluginKey('blockId'),

        props: {
          transformPasted: (slice: Slice) => {
            if (!slice || !slice.content) {
              return slice;
            }
        
            // Recursively remove blockId from nodes
            const removeBlockIds = (node: any): any => {
              if (node.attrs?.blockId && this.options.types.includes(node.type.name)) {
                const newAttrs = { ...node.attrs, blockId: null };
                
                let newContent = node.content;
                console.log("node in removeBlockIds", node);
                if (node.content && node.content.content) {
                  newContent = node.content.content.map((child: any) => removeBlockIds(child));
                }
                
                return node.type.create(newAttrs, Fragment.from(newContent), node.marks);
              }
              console.log('node in removeBlockIds', node);
              if (node.content && node.content.content) {
                const newContent = node.content.content.map((child: any) => removeBlockIds(child));
                if (newContent !== node.content) {
                  return node.type.create(node.attrs, Fragment.from(newContent), node.marks);
                }
              }
              
              return node;
            };
        
            const processedNodes = slice.content.content.map((node: any) => removeBlockIds(node));
            const processedFragment = Fragment.from(processedNodes);
            return new Slice(processedFragment, slice.openStart, slice.openEnd);
          },
        },
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

                // Check if node is inside a table or list (but not if it IS a table or list)
                const isInTable = node.type.name !== 'table' && isInsideTable(view.state.doc, pos);
                const isInList = node.type.name !== 'bulletList' && node.type.name !== 'orderedList' && node.type.name !== 'taskList' && isInsideList(view.state.doc, pos);

                // If node is inside a table/list and has a blockId, remove it
                if ((isInTable || isInList) && node.attrs.blockId) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    blockId: null,
                  });
                  modified = true;
                  return;
                }

                // Skip if already has blockId or is inside table/list
                if (node.attrs.blockId || isInTable || isInList) {
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
            const nodeType = node.type.name;
            
            // Only process block-level nodes that are in our types list
            if (!this.options.types.includes(nodeType)) {
              return;
            }

            // Check if node is inside a table or list (but not if it IS a table or list)
            const isInTable = nodeType !== 'table' && isInsideTable(newState.doc, pos);
            const isInList = nodeType !== 'bulletList' && nodeType !== 'orderedList' && nodeType !== 'taskList' && isInsideList(newState.doc, pos);

            // If node is inside a table/list and has a blockId, remove it
            if ((isInTable || isInList) && node.attrs.blockId) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                blockId: null,
              });
              modified = true;
              return;
            }

            // Skip if already has blockId or is inside table/list
            if (node.attrs.blockId || isInTable || isInList) {
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

