import { TableHeader as TiptapTableHeader } from '@tiptap/extension-table-header';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createRoot, Root } from 'react-dom/client';
import React from 'react';

import { getCellsInRow, isColumnSelected, selectColumn, isCellSelection, findTable } from './utils';
import { TableMap } from '@tiptap/pm/tables';
import { ColumnDragHandle } from '../../components/table/ColumnDragHandle';

/**
 * Custom TableHeader extension
 * Adds column grip handles for selection
 */
export const TableHeader = TiptapTableHeader.extend({
  addAttributes() {
    return {
      colspan: {
        default: 1,
      },
      rowspan: {
        default: 1,
      },
      colwidth: {
        default: null,
        parseHTML: (element) => {
          const colwidth = element.getAttribute('colwidth');
          const value = colwidth
            ? colwidth.split(',').map((item) => parseInt(item, 10))
            : null;

          return value;
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
    
    // Store the currently selected column index
    let selectedColumnIndex: number | null = null;

    return [
      // Plugin to add selectedCell class to selected header cells
      new Plugin({
        state: {
          init(): number | null {
            return null;
          },
          apply(tr, value): number | null {
            // Check if we should clear column selection (row was selected)
            if (tr.getMeta('clearColumnSelection')) {
              selectedColumnIndex = null;
              return null;
            }
            // Check if column selection was set
            if (tr.getMeta('highlightColumn') !== undefined) {
              selectedColumnIndex = tr.getMeta('highlightColumn');
              return selectedColumnIndex;
            }
            // Clear highlight if selection changed but not via grip
            if (tr.selectionSet && !tr.getMeta('highlightColumn') && !tr.getMeta('highlightRow')) {
              if (selectedColumnIndex !== null && !isCellSelection(tr.selection)) {
                selectedColumnIndex = null;
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

            // Highlight cells based on selected column index
            if (selectedColumnIndex !== null) {
              // Find all cells in the selected column
              const cells = getCellsInRow(0)(selection);
              if (cells && cells.length > selectedColumnIndex) {
                // Get the position of the header cell in the selected column
                const headerCell = cells[selectedColumnIndex];
                const headerNode = doc.nodeAt(headerCell.pos);
                
                if (headerNode && headerNode.type.name === 'tableHeader') {
                  decorations.push(
                    Decoration.node(headerCell.pos, headerCell.pos + headerNode.nodeSize, {
                      class: 'selectedCell',
                    })
                  );
                }
                
                // Also highlight all cells in this column in other rows
                const table = findTable(selection);
                if (table) {
                  const map = TableMap.get(table.node);
                  for (let row = 0; row < map.height; row++) {
                    const cellPos = map.positionAt(row, selectedColumnIndex, table.node);
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
            }
            
            // Also support standard CellSelection for compatibility
            if (isCellSelection(selection)) {
              const cellSelection = selection as any;
              cellSelection.forEachCell((node: any, pos: number) => {
                if (node.type.name === 'tableHeader') {
                  decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, {
                      class: 'selectedCell',
                    })
                  );
                }
              });
            }

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
      // Plugin for column grip handles
      new Plugin({
        props: {
          decorations: (state) => {
            if (!isEditable) {
              return DecorationSet.empty;
            }

            const { doc, selection } = state;
            const decorations: Decoration[] = [];
            const cells = getCellsInRow(0)(selection);

            if (cells) {
              cells.forEach(({ pos }: { pos: number }, index: number) => {
                const cellPos = pos; // Capture cell position for this column
                
                decorations.push(
                  Decoration.widget(
                    pos + 1,
                    () => {
                    const colSelected = isColumnSelected(index)(selection);
                    let className = 'grip-column';

                    if (colSelected) {
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
                      React.createElement(ColumnDragHandle, {
                        editor: this.editor,
                        columnIndex: index,
                        isFirst: index === 0,
                        isLast: index === cells.length - 1,
                        onHighlight: () => {
                          // Set the selected column index to trigger highlighting
                          selectedColumnIndex = index;
                          
                          // Actually select the column in the editor (not just decorations)
                          const view = this.editor.view;
                          const tr = selectColumn(index)(view.state.tr, cellPos);
                          // Add metadata to coordinate with row selection
                          tr.setMeta('highlightColumn', index);
                          tr.setMeta('clearRowSelection', true);
                          view.dispatch(tr);
                        },
                      })
                    );

                    return grip;
                  },
                    {
                      key: `column-grip-${index}`,
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

export default TableHeader;

