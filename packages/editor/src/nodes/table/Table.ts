import { Table as TiptapTable } from '@tiptap/extension-table';
import { Plugin } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { mergeAttributes } from '@tiptap/core';
import { blockDragDropKey } from '../../extensions/block-drag-drop';

/**
 * Custom Table extension
 * Extends Tiptap's table with custom rendering and interaction handling
 */
export const Table = TiptapTable.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element) => {
          // blockId is on the wrapper div
          const wrapper = element.closest('.tableWrapper');
          return wrapper?.getAttribute('data-block-id') || element.getAttribute('data-block-id');
        },
        renderHTML: (attributes) => {
          if (!attributes.blockId) return {};
          return { 'data-block-id': attributes.blockId };
        },
      },
      showRowNumbers: {
        default: false,
        parseHTML: (element) => {
          const wrapper = element.closest('.tableWrapper');
          return wrapper?.getAttribute('data-row-numbers') === 'true';
        },
        renderHTML: (attributes) => {
          if (!attributes.showRowNumbers) return {};
          return { 'data-row-numbers': 'true' };
        },
      },
    };
  },

  renderHTML({ node, HTMLAttributes }: { node: any; HTMLAttributes: Record<string, any> }) {
    // Extract blockId and showRowNumbers for the wrapper, don't pass them to the table element
    const { blockId, showRowNumbers, ...tableAttributes } = node.attrs;
    
    let wrapperClass = 'tableWrapper';
    // Don't serialize blockId (it should be unique per table)
    // if (blockId) {
    //   wrapperClass += ' block-node';
    // }
    if (showRowNumbers) {
      wrapperClass += ' show-row-numbers';
    }

    const wrapperAttrs: Record<string, any> = {
      class: wrapperClass,
    };

    // Don't serialize blockId when copying - it should be unique per table
    // if (blockId) {
    //   wrapperAttrs['data-block-id'] = blockId;
    //   wrapperAttrs['draggable'] = 'false'; // Only draggable via handle
    // }

    if (showRowNumbers) {
      wrapperAttrs['data-row-numbers'] = 'true';
    }

    // Merge HTMLAttributes but exclude wrapper-specific attributes
    const cleanTableAttrs = { ...HTMLAttributes };
    delete cleanTableAttrs['data-block-id'];
    delete cleanTableAttrs['data-row-numbers'];
    delete cleanTableAttrs['draggable'];
    delete cleanTableAttrs['class']; // Don't apply wrapper classes to inner table

    return [
      'div',
      wrapperAttrs,
      ['table', mergeAttributes(this.options.HTMLAttributes, cleanTableAttrs), 0]
    ];
  },


  addProseMirrorPlugins() {
    const { isEditable } = this.editor;

    if (!isEditable) {
      return [];
    }

    // Get parent plugins (includes fixTables)
    const parentPlugins = this.parent?.() || [];
    // Wrap parent plugins to skip fixTables during ANY drag operation
    const wrappedParentPlugins = parentPlugins.map((plugin: any, index: number) => {
      // If this plugin has appendTransaction, wrap it
      if (plugin.spec.appendTransaction) {
        const originalAppendTransaction = plugin.spec.appendTransaction;
        return new Plugin({
          ...plugin.spec,
          appendTransaction: (transactions, oldState, newState) => {
            // Skip if any transaction has skipFixTables meta
            const hasSkipMeta = transactions.some(tr => tr.getMeta('skipFixTables'));
            if (hasSkipMeta) {
              return null;
            }
            
            // Skip fixTables during ANY drag operation
            // This prevents table corruption when dragging any block (not just tables)
            const dragState = blockDragDropKey.getState(newState);
            if (dragState?.isDragging) {
              return null;
            }
            
            // Otherwise, call the original
            return originalAppendTransaction(transactions, oldState, newState);
          },
        });
      }
      return plugin;
    });

    return [
      ...wrappedParentPlugins,
      // Plugin to sync blockId and showRowNumbers attributes to DOM
      new Plugin({
        view: (view) => {
          const updateTableWrappers = () => {
            // Find all table nodes and update their wrapper DOM elements
            view.state.doc.descendants((node, pos) => {
              if (node.type.name === 'table') {
                const blockId = node.attrs.blockId;
                const showRowNumbers = node.attrs.showRowNumbers;
                const dom = view.nodeDOM(pos);
                
                console.log('[Table Plugin] Updating table wrapper at pos', pos, {
                  blockId,
                  showRowNumbers,
                });
                
                if (dom) {
                  // The dom might be the wrapper or the table itself
                  const htmlDom = dom as HTMLElement;
                  const wrapper = htmlDom.classList?.contains('tableWrapper') ? htmlDom : htmlDom.closest?.('.tableWrapper');
                  
                  if (wrapper) {
                    // Sync blockId
                    if (blockId) {
                      wrapper.setAttribute('data-block-id', blockId);
                      wrapper.classList.add('block-node');
                      wrapper.setAttribute('draggable', 'false');
                    }
                    
                    // Sync showRowNumbers
                    if (showRowNumbers) {
                      wrapper.classList.add('show-row-numbers');
                      wrapper.setAttribute('data-row-numbers', 'true');
                      console.log('[Table Plugin] Added show-row-numbers class');
                    } else {
                      wrapper.classList.remove('show-row-numbers');
                      wrapper.removeAttribute('data-row-numbers');
                      console.log('[Table Plugin] Removed show-row-numbers class');
                    }
                  }
                }
              }
            });
          };
          
          // Update on initial mount
          setTimeout(updateTableWrappers, 0);
          
          return {
            update: (view, prevState) => {
              // Update when document changes
              if (view.state.doc !== prevState.doc) {
                setTimeout(updateTableWrappers, 0);
              }
            },
          };
        },
      }),
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement;

              // Don't interfere with drag handle clicks
              if (target.closest('.block-drag-handle')) {
                return false;
              }

              // Check if the click is on the table element itself or its wrapper
              if (
                target.tagName === 'TABLE' ||
                target.closest('table') ||
                target.closest('.tableWrapper')
              ) {
                // Don't handle clicks inside table cells
                if (target.closest('td') || target.closest('th')) {
                  return false;
                }
                const tableElement =
                  target.tagName === 'TABLE' ? target : target.closest('table');
                if (tableElement) {
                  // Find the table node position
                  const pos = view.posAtDOM(tableElement, 0);
                  const $pos = view.state.doc.resolve(pos);
                  const tableNode = $pos.node();

                  if (tableNode.type.name === 'table') {
                    // Set cursor at the table start to trigger table menu
                    const tableStart = $pos.start();
                    const $tableStart = view.state.doc.resolve(tableStart);
                    const textSelection = TextSelection.near($tableStart);
                    const tr = view.state.tr.setSelection(textSelection);
                    view.dispatch(tr);
                    return true;
                  }
                }
              }

              return false;
            },
          },
        },
      }),
    ];
  },
}).configure({ resizable: true, lastColumnResizable: false });

export default Table;

