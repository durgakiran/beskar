import { mergeAttributes, Node } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createRoot, Root } from 'react-dom/client';
import React from 'react';

import { getCellsInColumn, isRowSelected, selectRow, isCellSelection, selectColumn, findTable } from './utils';
import { TableMap } from '@tiptap/pm/tables';
import { RowDragHandle } from '../../components/table/RowDragHandle';

export interface TableCellOptions {
  HTMLAttributes: Record<string, any>;
}

/**
 * Custom TableCell extension
 * Adds row grip handles for selection
 */
export const TableCell = Node.create<TableCellOptions>({
  name: 'tableCell',

  content: 'block+',

  tableRole: 'cell',

  isolating: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'td' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'td',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: HTMLAttributes.class || '',
      }),
      0,
    ];
  },

  addAttributes() {
    return {
      colspan: {
        default: 1,
        parseHTML: (element) => {
          const colspan = element.getAttribute('colspan');
          const value = colspan ? parseInt(colspan, 10) : 1;

          return value;
        },
      },
      rowspan: {
        default: 1,
        parseHTML: (element) => {
          const rowspan = element.getAttribute('rowspan');
          const value = rowspan ? parseInt(rowspan, 10) : 1;

          return value;
        },
      },
      colwidth: {
        default: null,
        parseHTML: (element) => {
          const colwidth = element.getAttribute('colwidth');
          const value = colwidth ? colwidth.split(',').map((w) => parseInt(w, 10)) : null;

          return value;
        },
        renderHTML: (attributes) => {
          if (!attributes.colwidth) {
            return {};
          }

          return {
            colwidth: attributes.colwidth.join(','),
            style: `width: ${attributes.colwidth[0]}px`,
          };
        },
      },
      style: {
        default: null,
      },
    };
  },

  addProseMirrorPlugins() {
    const { isEditable } = this.editor;
    const reactRoots = new Map<HTMLElement, Root>();
    
    // Store the currently selected row index
    let selectedRowIndex: number | null = null;

    return [
      // Plugin to add selectedCell class to selected cells
      new Plugin({
        state: {
          init(): number | null {
            return null;
          },
          apply(tr, value): number | null {
            // Check if we should clear row selection (column was selected)
            if (tr.getMeta('clearRowSelection')) {
              selectedRowIndex = null;
              return null;
            }
            // Check if row selection was set
            if (tr.getMeta('highlightRow') !== undefined) {
              selectedRowIndex = tr.getMeta('highlightRow');
              return selectedRowIndex;
            }
            // Clear highlight if selection changed but not via grip
            if (tr.selectionSet && !tr.getMeta('highlightRow') && !tr.getMeta('highlightColumn')) {
              if (selectedRowIndex !== null && !isCellSelection(tr.selection)) {
                selectedRowIndex = null;
                return null;
              }
            }
            return value;
          },
        },
        props: {
          decorations: (state) => {
            if (!isEditable) {
              return DecorationSet.empty;
            }

            const { doc, selection } = state;
            const decorations: Decoration[] = [];

            // Highlight cells based on selected row index
            if (selectedRowIndex !== null) {
              // Find the table
              const table = findTable(selection);
              if (table) {
                const map = TableMap.get(table.node);
                
                // Highlight all cells in the selected row
                for (let col = 0; col < map.width; col++) {
                  const cellPos = map.positionAt(selectedRowIndex, col, table.node);
                  const cellNode = table.node.nodeAt(cellPos);
                  if (cellNode) {
                    const absolutePos = table.start + cellPos;
                    decorations.push(
                      Decoration.node(absolutePos, absolutePos + cellNode.nodeSize, {
                        class: 'selectedCell',
                      })
                    );
                  }
                }
              }
            }
            
            // Also support standard CellSelection for compatibility
            if (isCellSelection(selection)) {
              const cellSelection = selection as any;
              cellSelection.forEachCell((node: any, pos: number) => {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: 'selectedCell',
                  })
                );
              });
            }

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
      // Plugin for row grip handles
      new Plugin({
        props: {
          decorations: (state) => {
            if (!isEditable) {
              return DecorationSet.empty;
            }

            const { doc, selection } = state;
            const decorations: Decoration[] = [];
            const cells = getCellsInColumn(0)(selection);

            if (cells) {
              cells.forEach(({ pos }: { pos: number }, index: number) => {
                const cellPos = pos; // Capture cell position for this row
                
                decorations.push(
                  Decoration.widget(
                    pos + 1,
                    () => {
                    const rowSelected = isRowSelected(index)(selection);
                    let className = 'grip-row';

                    if (rowSelected) {
                      className += ' selected';
                    }

                    if (index === 0) {
                      className += ' first';
                    }

                    if (index === cells.length - 1) {
                      className += ' last';
                    }

                    const grip = document.createElement('div');
                    grip.className = className;
                    grip.contentEditable = 'false';

                    // Render React component with highlight callback
                    const root = createRoot(grip);
                    reactRoots.set(grip, root);

                    root.render(
                      React.createElement(RowDragHandle, {
                        editor: this.editor,
                        rowIndex: index,
                        isFirst: index === 0,
                        isLast: index === cells.length - 1,
                        onHighlight: () => {
                          // Set the selected row index to trigger highlighting
                          selectedRowIndex = index;
                          
                          // Actually select the row in the editor (not just decorations)
                          const view = this.editor.view;
                          const tr = selectRow(index)(view.state.tr, cellPos);
                          // Add metadata to coordinate with column selection
                          tr.setMeta('highlightRow', index);
                          tr.setMeta('clearColumnSelection', true);
                          view.dispatch(tr);
                        },
                      })
                    );

                    return grip;
                  },
                    {
                      key: `row-grip-${index}`,
                      destroy: (node) => {
                        const root = reactRoots.get(node as HTMLElement);
                        if (root) {
                          // Defer unmounting to avoid race condition with React rendering
                          queueMicrotask(() => {
                            root.unmount();
                          });
                          reactRoots.delete(node as HTMLElement);
                        }
                      },
                    }
                  )
                );
              });
            }

            return DecorationSet.create(doc, decorations);
          },
        },
        view() {
          return {
            destroy() {
              // Clean up all React roots when plugin is destroyed
              // Defer to avoid race conditions
              queueMicrotask(() => {
                reactRoots.forEach((root) => root.unmount());
                reactRoots.clear();
              });
            },
          };
        },
      }),
    ];
  },
});

export default TableCell;

