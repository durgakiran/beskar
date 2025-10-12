import { findParentNode } from '@tiptap/core';
import { Selection, Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { Node, ResolvedPos } from '@tiptap/pm/model';

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
  (tr: Transaction) => {
    const table = findTable(tr.selection);
    const isRowSelection = type === 'row';

    if (table) {
      const map = TableMap.get(table.node);

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

        return tr.setSelection(new CellSelection($anchor, $head));
      }
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

