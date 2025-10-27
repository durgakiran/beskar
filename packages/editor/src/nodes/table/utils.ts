import { findParentNode } from '@tiptap/core';
import { Selection, Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { Node, ResolvedPos, Fragment } from '@tiptap/pm/model';

/**
 * Debug function to log complete table structure
 */
export const inspectTableStructure = (node: Node, label: string = 'Table') => {
  console.group(`[inspectTableStructure] ${label}`);
  
  if (node.type.name !== 'table') {
    console.error('Node is not a table, type:', node.type.name);
    console.groupEnd();
    return;
  }
  
  console.log('Table node:', {
    type: node.type.name,
    childCount: node.childCount,
    attrs: node.attrs,
  });
  
  node.forEach((rowNode, rowOffset, rowIndex) => {
    console.group(`Row ${rowIndex} (type: ${rowNode.type.name})`);
    console.log('Row node:', {
      type: rowNode.type.name,
      childCount: rowNode.childCount,
      attrs: rowNode.attrs,
    });
    
    rowNode.forEach((cellNode, cellOffset, cellIndex) => {
      console.log(`  Cell ${cellIndex}:`, {
        type: cellNode.type.name,
        attrs: cellNode.attrs,
        content: cellNode.textContent || '(empty)',
        nodeSize: cellNode.nodeSize,
      });
    });
    
    console.groupEnd();
  });
  
  // Check validity
  try {
    node.check();
    console.log('✅ Table structure is VALID');
  } catch (e) {
    console.error('❌ Table structure is INVALID:', e);
  }
  
  console.groupEnd();
};

/**
 * Debug function to inspect table at current selection
 */
export const inspectTableAtSelection = (selection: Selection) => {
  const table = findTable(selection);
  if (table) {
    inspectTableStructure(table.node, 'Table at Selection');
    return table;
  } else {
    console.log('[inspectTableAtSelection] No table found at selection');
    return null;
  }
};

/**
 * Check if a specific rectangle in the table is selected
 */
export const isRectSelected = (rect: any) => (selection: CellSelection) => {
  const map = TableMap.get(selection.$anchorCell.node(-1));
  const start = selection.$anchorCell.start(-1);
  const cells = map.cellsInRect(rect);
  const selectedCells = map.cellsInRect(
    map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start)
  );

  for (let i = 0, count = cells.length; i < count; i += 1) {
    if (selectedCells.indexOf(cells[i]) === -1) {
      return false;
    }
  }

  return true;
};

/**
 * Find the table node in the current selection
 */
export const findTable = (selection: Selection) =>
  findParentNode((node) => node.type.spec.tableRole && node.type.spec.tableRole === 'table')(
    selection
  );

/**
 * Check if the selection is a CellSelection
 */
export const isCellSelection = (selection: any): selection is CellSelection =>
  selection instanceof CellSelection;

/**
 * Check if a specific column is selected
 */
export const isColumnSelected = (columnIndex: number) => (selection: any) => {
  if (isCellSelection(selection)) {
    const map = TableMap.get(selection.$anchorCell.node(-1));

    return isRectSelected({
      left: columnIndex,
      right: columnIndex + 1,
      top: 0,
      bottom: map.height,
    })(selection);
  }

  return false;
};

/**
 * Check if a specific row is selected
 */
export const isRowSelected = (rowIndex: number) => (selection: any) => {
  if (isCellSelection(selection)) {
    const map = TableMap.get(selection.$anchorCell.node(-1));

    return isRectSelected({
      left: 0,
      right: map.width,
      top: rowIndex,
      bottom: rowIndex + 1,
    })(selection);
  }

  return false;
};

/**
 * Check if the entire table is selected
 */
export const isTableSelected = (selection: any) => {
  if (isCellSelection(selection)) {
    const map = TableMap.get(selection.$anchorCell.node(-1));

    return isRectSelected({
      left: 0,
      right: map.width,
      top: 0,
      bottom: map.height,
    })(selection);
  }

  return false;
};

/**
 * Get all cells in a specific column or columns
 */
export const getCellsInColumn =
  (columnIndex: number | number[]) => (selection: Selection) => {
    const table = findTable(selection);
    if (table) {
      const map = TableMap.get(table.node);
      const indexes = Array.isArray(columnIndex) ? columnIndex : Array.from([columnIndex]);

      return indexes.reduce(
        (acc, index) => {
          if (index >= 0 && index <= map.width - 1) {
            const cells = map.cellsInRect({
              left: index,
              right: index + 1,
              top: 0,
              bottom: map.height,
            });

            return acc.concat(
              cells.map((nodePos) => {
                const node = table.node.nodeAt(nodePos);
                const pos = nodePos + table.start;

                return { pos, start: pos + 1, node };
              })
            );
          }

          return acc;
        },
        [] as { pos: number; start: number; node: Node | null | undefined }[]
      );
    }
    return null;
  };

/**
 * Get all cells in a specific row or rows
 */
export const getCellsInRow = (rowIndex: number | number[]) => (selection: Selection) => {
  const table = findTable(selection);

  if (table) {
    const map = TableMap.get(table.node);
    const indexes = Array.isArray(rowIndex) ? rowIndex : Array.from([rowIndex]);

    return indexes.reduce(
      (acc, index) => {
        if (index >= 0 && index <= map.height - 1) {
          const cells = map.cellsInRect({
            left: 0,
            right: map.width,
            top: index,
            bottom: index + 1,
          });

          return acc.concat(
            cells.map((nodePos) => {
              const node = table.node.nodeAt(nodePos);
              const pos = nodePos + table.start;
              return { pos, start: pos + 1, node };
            })
          );
        }

        return acc;
      },
      [] as { pos: number; start: number; node: Node | null | undefined }[]
    );
  }

  return null;
};

/**
 * Get all cells in the table
 */
export const getCellsInTable = (selection: Selection) => {
  const table = findTable(selection);

  if (table) {
    const map = TableMap.get(table.node);
    const cells = map.cellsInRect({
      left: 0,
      right: map.width,
      top: 0,
      bottom: map.height,
    });

    return cells.map((nodePos) => {
      const node = table.node.nodeAt(nodePos);
      const pos = nodePos + table.start;

      return { pos, start: pos + 1, node };
    });
  }

  return null;
};

/**
 * Find the closest parent node to a position that matches a predicate
 */
export const findParentNodeClosestToPos = (
  $pos: ResolvedPos,
  predicate: (node: Node) => boolean
) => {
  for (let i = $pos.depth; i > 0; i -= 1) {
    const node = $pos.node(i);

    if (predicate(node)) {
      return {
        pos: i > 0 ? $pos.before(i) : 0,
        start: $pos.start(i),
        depth: i,
        node,
      };
    }
  }

  return null;
};

/**
 * Find the cell closest to a position
 */
export const findCellClosestToPos = ($pos: ResolvedPos) => {
  const predicate = (node: Node) =>
    node.type.spec.tableRole && /cell/i.test(node.type.spec.tableRole as string);

  return findParentNodeClosestToPos($pos, predicate);
};

/**
 * Generic select function for rows or columns
 */
const select =
  (type: 'row' | 'column') =>
  (index: number) =>
  (tr: Transaction, tablePos?: number) => {
    // Try to find table from provided position first, fallback to selection
    let table: ReturnType<typeof findTable>;
    if (tablePos !== undefined) {
      const $pos = tr.doc.resolve(tablePos);
      // Create a temporary selection at this position to find the table
      const tempSelection = Selection.near($pos);
      table = findTable(tempSelection);
    } else {
      table = findTable(tr.selection);
    }
    
    const isRowSelection = type === 'row';
    console.log(`[select ${type}] index: ${index}, tablePos: ${tablePos}, table found:`, !!table);
    
    if (table) {
      const map = TableMap.get(table.node);
      console.log(`[select ${type}] map dimensions:`, { width: map.width, height: map.height });

      // Check if the index is valid
      if (index >= 0 && index < (isRowSelection ? map.height : map.width)) {
        const left = isRowSelection ? 0 : index;
        const top = isRowSelection ? index : 0;
        const right = isRowSelection ? map.width : index + 1;
        const bottom = isRowSelection ? index + 1 : map.height;

        const cellsInFirstRow = map.cellsInRect({
          left,
          top,
          right: isRowSelection ? right : left + 1,
          bottom: isRowSelection ? top + 1 : bottom,
        });

        const cellsInLastRow =
          bottom - top === 1
            ? cellsInFirstRow
            : map.cellsInRect({
                left: isRowSelection ? left : right - 1,
                top: isRowSelection ? bottom - 1 : top,
                right,
                bottom,
              });

        const head = table.start + cellsInFirstRow[0];
        const anchor = table.start + cellsInLastRow[cellsInLastRow.length - 1];
        const $head = tr.doc.resolve(head);
        const $anchor = tr.doc.resolve(anchor);

        console.log(`[select ${type}] Creating CellSelection from ${anchor} to ${head}`);
        return tr.setSelection(new CellSelection($anchor, $head));
      } else {
        console.warn(`[select ${type}] Invalid index ${index}`);
      }
    } else {
      console.warn(`[select ${type}] No table found!`);
    }
    return tr;
  };

/**
 * Select a specific column in the table
 */
export const selectColumn = select('column');

/**
 * Select a specific row in the table
 */
export const selectRow = select('row');

/**
 * Select the entire table
 */
export const selectTable = (tr: Transaction) => {
  const table = findTable(tr.selection);

  if (table) {
    const { map } = TableMap.get(table.node);

    if (map && map.length) {
      const head = table.start + map[0];
      const anchor = table.start + map[map.length - 1];
      const $head = tr.doc.resolve(head);
      const $anchor = tr.doc.resolve(anchor);

      return tr.setSelection(new CellSelection($anchor, $head));
    }
  }

  return tr;
};

/**
 * Get the row index of a cell at a given position
 */
export const getRowIndex = ($pos: ResolvedPos): number | null => {
  const cell = findCellClosestToPos($pos);
  if (!cell) return null;

  const table = findParentNodeClosestToPos($pos, (node) => node.type.spec.tableRole === 'table');
  if (!table) return null;

  const map = TableMap.get(table.node);
  const cellPos = cell.pos - table.start;
  const rect = map.findCell(cellPos);
  
  return rect ? rect.top : null;
};

/**
 * Get the column index of a cell at a given position
 */
export const getColumnIndex = ($pos: ResolvedPos): number | null => {
  const cell = findCellClosestToPos($pos);
  if (!cell) return null;

  const table = findParentNodeClosestToPos($pos, (node) => node.type.spec.tableRole === 'table');
  if (!table) return null;

  const map = TableMap.get(table.node);
  const cellPos = cell.pos - table.start;
  const rect = map.findCell(cellPos);
  
  return rect ? rect.left : null;
};

/**
 * Move a row up (swap with previous row)
 */
export const moveRowUp = (rowIndex: number) => (tr: Transaction) => {
  if (rowIndex <= 0) return tr;

  const table = findTable(tr.selection);
  if (!table) return tr;

  const map = TableMap.get(table.node);
  if (rowIndex >= map.height) return tr;

  // Collect all rows
  const rows: Node[] = [];
  table.node.forEach((row) => {
    rows.push(row);
  });

  // Swap the rows
  const temp = rows[rowIndex - 1];
  rows[rowIndex - 1] = rows[rowIndex];
  rows[rowIndex] = temp;

  // Create new table with swapped rows
  const newTable = table.node.type.create(table.node.attrs, rows, table.node.marks);
  
  // Replace the entire table
  tr.replaceWith(table.start, table.start + table.node.nodeSize, newTable);

  return tr;
};

/**
 * Move a row down (swap with next row)
 */
export const moveRowDown = (rowIndex: number) => (tr: Transaction) => {
  const table = findTable(tr.selection);
  if (!table) return tr;

  const map = TableMap.get(table.node);
  if (rowIndex >= map.height - 1) return tr;

  return moveRowUp(rowIndex + 1)(tr);
};

/**
 * Move a column left (swap with previous column)
 */
export const moveColumnLeft = (columnIndex: number) => (tr: Transaction) => {
  console.log('[moveColumnLeft] Starting, columnIndex:', columnIndex);
  
  if (columnIndex <= 0) {
    console.log('[moveColumnLeft] Column is already first, skipping');
    return tr;
  }

  const table = findTable(tr.selection);
  if (!table) {
    console.log('[moveColumnLeft] No table found');
    return tr;
  }

  console.log('[moveColumnLeft] Table found, validating structure...');
  
  // Validate table structure before proceeding
  try {
    table.node.check();
    console.log('[moveColumnLeft] Table structure valid ✓');
  } catch (e) {
    console.error('[moveColumnLeft] Table structure INVALID before operation:', e);
    return tr;
  }

  const map = TableMap.get(table.node);
  console.log('[moveColumnLeft] Table dimensions:', { width: map.width, height: map.height });
  
  if (columnIndex >= map.width) {
    console.log('[moveColumnLeft] Column index out of bounds');
    return tr;
  }

  // Collect all cell data first
  const cellSwaps: Array<{
    row: number;
    currentPos: number;
    prevPos: number;
    currentContent: Fragment;
    prevContent: Fragment;
    currentAttrs: Record<string, any>;
    prevAttrs: Record<string, any>;
  }> = [];

  console.log('[moveColumnLeft] Collecting cell data...');
  for (let row = 0; row < map.height; row++) {
    const currentCellPos = map.positionAt(row, columnIndex, table.node);
    const prevCellPos = map.positionAt(row, columnIndex - 1, table.node);
    
    const currentCell = table.node.nodeAt(currentCellPos);
    const prevCell = table.node.nodeAt(prevCellPos);

    if (!currentCell || !prevCell) {
      console.warn(`[moveColumnLeft] Missing cell at row ${row}`);
      continue;
    }

    console.log(`[moveColumnLeft] Row ${row}:`, {
      currentPos: table.start + currentCellPos,
      prevPos: table.start + prevCellPos,
      currentSize: currentCell.nodeSize,
      prevSize: prevCell.nodeSize,
    });

    cellSwaps.push({
      row,
      currentPos: table.start + currentCellPos,
      prevPos: table.start + prevCellPos,
      currentContent: currentCell.content,
      prevContent: prevCell.content,
      currentAttrs: currentCell.attrs,
      prevAttrs: prevCell.attrs,
    });
  }

  console.log(`[moveColumnLeft] Collected ${cellSwaps.length} cell pairs`);

  // IMPORTANT: We must preserve cell node types (tableHeader vs tableCell)
  // We can't just swap content - we need to swap entire cells by recreating them
  
  // Process from bottom to top to maintain positions
  for (let i = cellSwaps.length - 1; i >= 0; i--) {
    const swap = cellSwaps[i];
    console.log(`[moveColumnLeft] Processing row ${swap.row}...`);
    
    try {
      // Get fresh cell references from current document state
      const currentCell = tr.doc.nodeAt(swap.currentPos);
      const prevCell = tr.doc.nodeAt(swap.prevPos);
      
      if (!currentCell || !prevCell) {
        console.error(`[moveColumnLeft] Lost cell reference at row ${swap.row}`);
        continue;
      }

      console.log(`[moveColumnLeft] Row ${swap.row} cell types:`, {
        currentType: currentCell.type.name,
        prevType: prevCell.type.name,
      });

      // Create new cells with swapped content BUT PRESERVE CELL TYPE
      // This is critical - we must not change tableHeader to tableCell or vice versa
      const schema = tr.doc.type.schema;
      
      // Recreate currentCell with prev content but KEEP current cell type
      const newCurrentCell = currentCell.type.create(
        swap.prevAttrs,
        swap.prevContent,
        currentCell.marks
      );
      
      // Recreate prevCell with current content but KEEP prev cell type
      const newPrevCell = prevCell.type.create(
        swap.currentAttrs,
        swap.currentContent,
        prevCell.marks
      );
      
      console.log(`[moveColumnLeft] Row ${swap.row} - replacing cells with preserved types`);
      
      // Replace from right to left to maintain positions
      if (swap.currentPos > swap.prevPos) {
        tr.replaceWith(swap.currentPos, swap.currentPos + currentCell.nodeSize, newCurrentCell);
        tr.replaceWith(swap.prevPos, swap.prevPos + prevCell.nodeSize, newPrevCell);
      } else {
        tr.replaceWith(swap.prevPos, swap.prevPos + prevCell.nodeSize, newPrevCell);
        tr.replaceWith(swap.currentPos, swap.currentPos + currentCell.nodeSize, newCurrentCell);
      }
      
      console.log(`[moveColumnLeft] Row ${swap.row} - cells swapped ✓`);
      
    } catch (e) {
      console.error(`[moveColumnLeft] Error processing row ${swap.row}:`, e);
      throw e;
    }
  }

  // Validate table structure after operation
  try {
    const updatedTable = findTable(tr.selection);
    if (updatedTable) {
      updatedTable.node.check();
      console.log('[moveColumnLeft] Table structure valid after operation ✓');
    }
  } catch (e) {
    console.error('[moveColumnLeft] Table structure INVALID after operation:', e);
    throw e;
  }

  console.log('[moveColumnLeft] Complete');
  return tr;
};

/**
 * Move a column right (swap with next column)
 */
export const moveColumnRight = (columnIndex: number) => (tr: Transaction) => {
  console.log('[moveColumnRight] Starting, columnIndex:', columnIndex);
  
  const table = findTable(tr.selection);
  if (!table) {
    console.log('[moveColumnRight] No table found');
    return tr;
  }

  const map = TableMap.get(table.node);
  console.log('[moveColumnRight] Table dimensions:', { width: map.width, height: map.height });
  
  if (columnIndex >= map.width - 1) {
    console.log('[moveColumnRight] Column is already last, skipping');
    return tr;
  }

  // Just call moveColumnLeft on the next column (simpler and safer)
  console.log('[moveColumnRight] Delegating to moveColumnLeft for column', columnIndex + 1);
  return moveColumnLeft(columnIndex + 1)(tr);
};

/**
 * Clear all content in selected cells
 */
export const clearCells = (tr: Transaction) => {
  if (isCellSelection(tr.selection)) {
    const selection = tr.selection as CellSelection;
    const cells: { pos: number; node: Node }[] = [];

    selection.forEachCell((node, pos) => {
      cells.push({ pos, node });
    });

    // Process cells in reverse order to avoid position shifts
    cells.sort((a, b) => b.pos - a.pos).forEach(({ pos, node }) => {
      // Clear cell content but keep the cell structure
      const cellStart = pos + 1;
      const cellEnd = pos + node.nodeSize - 1;
      
      if (cellStart < cellEnd) {
        tr.delete(cellStart, cellEnd);
      }
    });
  }

  return tr;
};

/**
 * Set background color for selected cells
 */
export const setCellBackgroundColor = (color: string | null) => (tr: Transaction) => {
  if (isCellSelection(tr.selection)) {
    const selection = tr.selection as CellSelection;
    
    selection.forEachCell((node, pos) => {
      const currentStyle = node.attrs.style || '';
      let newStyle = currentStyle;

      if (color) {
        // Remove existing background-color if any
        newStyle = newStyle.replace(/background-color:\s*[^;]+;?/gi, '').trim();
        // Add new background-color
        newStyle = newStyle ? `${newStyle}; background-color: ${color}` : `background-color: ${color}`;
      } else {
        // Remove background-color
        newStyle = newStyle.replace(/background-color:\s*[^;]+;?/gi, '').trim();
        newStyle = newStyle.replace(/;\s*;/g, ';').replace(/^;|;$/g, '');
      }

      tr.setNodeMarkup(pos, null, { ...node.attrs, style: newStyle || null });
    });
  }

  return tr;
};

/**
 * Sort table rows by a column (ascending or descending)
 */
export const sortTableByColumn = (columnIndex: number, ascending = true) => (tr: Transaction) => {
  const table = findTable(tr.selection);
  if (!table) return tr;

  const map = TableMap.get(table.node);
  if (columnIndex < 0 || columnIndex >= map.width) return tr;

  // Extract row data
  const rows: { node: Node; text: string }[] = [];
  
  table.node.forEach((rowNode, offset, index) => {
    let cellIndex = 0;
    let text = '';
    
    rowNode.forEach((cellNode) => {
      if (cellIndex === columnIndex) {
        cellNode.forEach((blockNode) => {
          blockNode.forEach((textNode) => {
            if (textNode.text) text += textNode.text;
          });
        });
      }
      cellIndex++;
    });
    
    rows.push({ node: rowNode, text });
  });

  // Sort rows (keep header row in place if it exists)
  const hasHeaderRow = rows[0]?.node.firstChild?.type.name === 'tableHeader';
  const headerRow = hasHeaderRow ? rows[0] : null;
  const dataRows = hasHeaderRow ? rows.slice(1) : rows;

  dataRows.sort((a, b) => {
    const comparison = a.text.localeCompare(b.text);
    return ascending ? comparison : -comparison;
  });

  const sortedRows = headerRow ? [headerRow, ...dataRows] : dataRows;

  // Replace table content with sorted rows
  const tableStart = table.start;
  const tableEnd = table.start + table.node.nodeSize;
  
  const schema = tr.doc.type.schema;
  const newTable = schema.nodes.table.create(
    table.node.attrs,
    sortedRows.map((r) => r.node)
  );

  tr.replaceWith(tableStart, tableEnd, newTable);

  return tr;
};

/**
 * Distribute column widths evenly
 */
export const distributeColumns = (tr: Transaction) => {
  const table = findTable(tr.selection);
  if (!table) return tr;

  const map = TableMap.get(table.node);
  
  // Clear colwidth from all cells
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const cellPos = map.positionAt(row, col, table.node);
      const cell = table.node.nodeAt(cellPos);
      
      if (cell) {
        const absPos = table.start + cellPos;
        tr.setNodeMarkup(absPos, null, { ...cell.attrs, colwidth: null });
      }
    }
  }

  return tr;
};

/**
 * Toggle row numbers display by adding/removing an actual column
 */
export const toggleRowNumbers = (tr: Transaction) => {
  console.log('[toggleRowNumbers] Function called');
  
  const table = findTable(tr.selection);
  if (!table) {
    console.error('[toggleRowNumbers] No table found in selection');
    return tr;
  }

  const currentValue = table.node.attrs.showRowNumbers;
  const map = TableMap.get(table.node);
  const schema = tr.doc.type.schema;
  
  console.log('[toggleRowNumbers] Current value:', currentValue);
  console.log('[toggleRowNumbers] Table has', map.height, 'rows and', map.width, 'columns');
  
  if (!currentValue) {
    // ADDING ROW NUMBERS COLUMN
    console.log('[toggleRowNumbers] Adding row numbers column');
    
    // Build new table structure with row numbers column
    const newRows: any[] = [];
    let rowIndex = 0;
    
    table.node.forEach((row) => {
      rowIndex++;
      
      // Create row number cell with proper paragraph structure
      const paragraph = schema.nodes.paragraph.create(
        null,
        schema.text(rowIndex.toString())
      );
      
      const rowNumberCell = schema.nodes.tableCell.create(
        { 
          colspan: 1, 
          rowspan: 1,
          colwidth: [50],
        },
        paragraph
      );
      
      // Collect existing cells
      const existingCells: any[] = [];
      row.forEach((cell) => {
        existingCells.push(cell);
      });
      
      // Create new row with row number cell first
      const newRow = schema.nodes.tableRow.create(
        row.attrs,
        [rowNumberCell, ...existingCells]
      );
      
      newRows.push(newRow);
    });
    
    // Create new table with row numbers
    const newTable = schema.nodes.table.create(
      {
        ...table.node.attrs,
        showRowNumbers: true,
      },
      newRows
    );
    
    // Replace the entire table
    tr.replaceWith(table.pos, table.pos + table.node.nodeSize, newTable);
    
    console.log('[toggleRowNumbers] Rebuilt table with row numbers column');
    
  } else {
    // REMOVING ROW NUMBERS COLUMN
    console.log('[toggleRowNumbers] Removing row numbers column');
    
    // Build new table structure without row numbers column
    const newRows: any[] = [];
    
    table.node.forEach((row) => {
      // Collect all cells except the first one (row number)
      const cellsWithoutRowNumber: any[] = [];
      let cellIndex = 0;
      
      row.forEach((cell) => {
        if (cellIndex > 0) {
          cellsWithoutRowNumber.push(cell);
        }
        cellIndex++;
      });
      
      // Create new row without row number cell
      const newRow = schema.nodes.tableRow.create(
        row.attrs,
        cellsWithoutRowNumber
      );
      
      newRows.push(newRow);
    });
    
    // Create new table without row numbers
    const newTable = schema.nodes.table.create(
      {
        ...table.node.attrs,
        showRowNumbers: false,
      },
      newRows
    );
    
    // Replace the entire table
    tr.replaceWith(table.pos, table.pos + table.node.nodeSize, newTable);
    
    console.log('[toggleRowNumbers] Rebuilt table without row numbers column');
  }

  console.log('[toggleRowNumbers] Transaction updated');
  return tr;
};

/**
 * Toggle first row as header row (convert between tableCell and tableHeader)
 */
export const toggleHeaderRow = (tr: Transaction) => {
  const table = findTable(tr.selection);
  if (!table) return tr;

  const map = TableMap.get(table.node);
  const schema = tr.doc.type.schema;
  
  // Get cells in first row
  const firstRowCells: { pos: number; node: Node; col: number }[] = [];
  for (let col = 0; col < map.width; col++) {
    const cellPos = map.positionAt(0, col, table.node);
    const cell = table.node.nodeAt(cellPos);
    if (cell) {
      firstRowCells.push({ pos: table.start + cellPos, node: cell, col });
    }
  }

  if (firstRowCells.length === 0) return tr;

  // Check if first row is already headers (check col 1 if exists, not col 0)
  // Col 0 might be header due to header column, so check a cell to the right
  const checkCell = map.width > 1 ? firstRowCells[1].node : firstRowCells[0].node;
  const isHeader = checkCell.type.name === 'tableHeader';
  
  // Check if first column is header (by checking cell at row 1, col 0 if exists)
  let firstColumnIsHeader = false;
  if (map.height > 1) {
    const cellPos = map.positionAt(1, 0, table.node);
    const cell = table.node.nodeAt(cellPos);
    if (cell && cell.type.name === 'tableHeader') {
      firstColumnIsHeader = true;
    }
  }

  // Convert each cell in first row
  firstRowCells.forEach(({ pos, node, col }) => {
    // Header precedence: cell (0,0) stays header if first column is header
    if (isHeader && col === 0 && firstColumnIsHeader) {
      // Keep as header - don't change
      return;
    }
    
    const targetType = isHeader ? schema.nodes.tableCell : schema.nodes.tableHeader;
    tr.setNodeMarkup(pos, targetType, node.attrs, node.marks);
  });

  return tr;
};

/**
 * Toggle first column as header column (convert between tableCell and tableHeader)
 */
export const toggleHeaderColumn = (tr: Transaction) => {
  console.log('[toggleHeaderColumn] Starting...');
  const table = findTable(tr.selection);
  if (!table) {
    console.log('[toggleHeaderColumn] No table found');
    return tr;
  }

  const map = TableMap.get(table.node);
  const schema = tr.doc.type.schema;
  console.log('[toggleHeaderColumn] Table dimensions:', { width: map.width, height: map.height });
  
  // Get cells in first column
  const firstColumnCells: { pos: number; node: Node; row: number }[] = [];
  for (let row = 0; row < map.height; row++) {
    const cellPos = map.positionAt(row, 0, table.node);
    const cell = table.node.nodeAt(cellPos);
    if (cell) {
      console.log(`[toggleHeaderColumn] Row ${row}, cell type: ${cell.type.name}`);
      firstColumnCells.push({ pos: table.start + cellPos, node: cell, row });
    }
  }

  if (firstColumnCells.length === 0) {
    console.log('[toggleHeaderColumn] No cells in first column');
    return tr;
  }

  // Check if first column is already headers (check row 1 if exists, not row 0)
  // Row 0 might be header due to header row, so check a cell below
  const checkCell = map.height > 1 ? firstColumnCells[1].node : firstColumnCells[0].node;
  const isHeader = checkCell.type.name === 'tableHeader';
  console.log('[toggleHeaderColumn] First column is currently header:', isHeader, '(checked cell type:', checkCell.type.name, ')');
  
  // Check if first row is header (by checking cell at row 0, col 1 if exists)
  let firstRowIsHeader = false;
  if (map.width > 1) {
    const cellPos = map.positionAt(0, 1, table.node);
    const cell = table.node.nodeAt(cellPos);
    if (cell && cell.type.name === 'tableHeader') {
      firstRowIsHeader = true;
    }
  }
  console.log('[toggleHeaderColumn] First row is header:', firstRowIsHeader);

  // Convert each cell in first column
  firstColumnCells.forEach(({ pos, node, row }) => {
    // Header precedence: cell (0,0) stays header if first row is header
    if (isHeader && row === 0 && firstRowIsHeader) {
      console.log(`[toggleHeaderColumn] Keeping cell (0,0) as header due to header row`);
      return;
    }
    
    const targetType = isHeader ? schema.nodes.tableCell : schema.nodes.tableHeader;
    console.log(`[toggleHeaderColumn] Converting row ${row} from ${node.type.name} to ${targetType.name}`);
    tr.setNodeMarkup(pos, targetType, node.attrs, node.marks);
  });

  console.log('[toggleHeaderColumn] Done');
  return tr;
};

/**
 * Copy the entire table (with styling and attributes) to clipboard
 */
export function copyTable(editor: any): boolean {
  try {
    const { state } = editor;
    const { selection } = state;
    
    console.log('[copyTable] Called');
    
    // Find the table node
    const table = findTable(selection);
    
    if (!table) {
      console.warn('[copyTable] Not inside a table');
      return false;
    }
    
    const tablePos = table.pos;
    const tableNode = table.node;
    const tableEndPos = tablePos + tableNode.nodeSize;
    
    console.log('[copyTable] Selecting entire table', {
      from: tablePos,
      to: tableEndPos,
      nodeSize: tableNode.nodeSize,
      attrs: tableNode.attrs,
    });
    
    // Select the entire table node
    editor.chain()
      .focus()
      .setNodeSelection(tablePos)
      .run();
    
    // Give the selection a moment to update, then trigger copy
    setTimeout(() => {
      try {
        // Trigger the browser's copy command
        document.execCommand('copy');
        console.log('[copyTable] Copy command executed');
        
        // Restore focus
        editor.commands.focus();
      } catch (err) {
        console.error('[copyTable] Failed to execute copy command:', err);
      }
    }, 10);
    
    return true;
  } catch (error) {
    console.error('[copyTable] Failed to copy table:', error);
    return false;
  }
}

/**
 * Delete the entire table
 */
export function deleteTable(editor: any): boolean {
  try {
    console.log('[deleteTable] Called');
    return editor.chain().focus().deleteTable().run();
  } catch (error) {
    console.error('[deleteTable] Failed to delete table:', error);
    return false;
  }
}

