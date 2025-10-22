import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Separator from '@radix-ui/react-separator';
import { Editor } from '@tiptap/react';
import {
  FiArrowUp,
  FiArrowDown,
  FiTrash2,
  FiPlus,
  FiX,
  FiChevronUp,
  FiChevronDown,
  FiDroplet,
  FiToggleRight,
  FiToggleLeft,
} from 'react-icons/fi';
import { ColorPicker } from './ColorPicker';
import {
  getRowIndex,
  moveRowUp,
  moveRowDown,
  clearCells,
  sortTableByColumn,
  selectRow,
  toggleHeaderRow,
  findTable,
} from '../../nodes/table/utils';
import { TableMap } from '@tiptap/pm/tables';

interface RowDragHandleProps {
  editor: Editor;
  rowIndex: number;
  isFirst: boolean;
  isLast: boolean;
  onHighlight?: () => void; // Callback to trigger row highlighting
}

export const RowDragHandle: React.FC<RowDragHandleProps> = ({
  editor,
  rowIndex,
  isFirst,
  isLast,
  onHighlight,
}) => {
  // Actions operate on the currently selected row (already selected by button)
  // Use setTimeout to ensure selection is stable before executing
  const addRowAbove = () => {
    setTimeout(() => {
      try {
        editor.chain().focus().addRowBefore().run();
      } catch (e) {
        console.error('Failed to add row above:', e);
      }
    }, 10);
  };

  const addRowBelow = () => {
    setTimeout(() => {
      try {
        editor.chain().focus().addRowAfter().run();
      } catch (e) {
        console.error('Failed to add row below:', e);
      }
    }, 10);
  };

  const deleteRow = () => {
    setTimeout(() => {
      try {
        editor.chain().focus().deleteRow().run();
      } catch (e) {
        console.error('Failed to delete row:', e);
      }
    }, 10);
  };

  const clearRow = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        const tr = clearCells(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to clear row:', e);
      }
    }, 10);
  };

  const handleMoveUp = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        const tr = moveRowUp(rowIndex)(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to move row up:', e);
      }
    }, 10);
  };

  const handleMoveDown = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        const tr = moveRowDown(rowIndex)(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to move row down:', e);
      }
    }, 10);
  };

  const handleSortAscending = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        // Sort by first column
        const tr = sortTableByColumn(0, true)(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to sort ascending:', e);
      }
    }, 10);
  };

  const handleSortDescending = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        // Sort by first column
        const tr = sortTableByColumn(0, false)(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to sort descending:', e);
      }
    }, 10);
  };

  const handleToggleHeaderRow = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        const tr = toggleHeaderRow(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to toggle header row:', e);
      }
    }, 10);
  };

  // Track header state dynamically
  const [isFirstRowHeader, setIsFirstRowHeader] = React.useState(false);

  const handleOpenChange = React.useCallback((open: boolean) => {
    if (open) {
      // Update header state when menu opens
      const { state } = editor;
      const table = findTable(state.selection);
      if (table) {
        const map = TableMap.get(table.node);
        if (map.width > 0) {
          // Check cell at row 0, col 1 if exists (not col 0, as that might be header due to header column)
          const checkCol = map.width > 1 ? 1 : 0;
          const cellPos = map.positionAt(0, checkCol, table.node);
          const cell = table.node.nodeAt(cellPos);
          setIsFirstRowHeader(cell?.type.name === 'tableHeader');
        }
      }
      
      // Trigger highlight when menu opens
      if (onHighlight) {
        onHighlight();
      }
    }
  }, [onHighlight, editor]);

  return (
    <DropdownMenu.Root onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          className="row-drag-handle-trigger"
          aria-label="Row menu"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <circle cx="3" cy="3" r="1" />
            <circle cx="9" cy="3" r="1" />
            <circle cx="3" cy="6" r="1" />
            <circle cx="9" cy="6" r="1" />
            <circle cx="3" cy="9" r="1" />
            <circle cx="9" cy="9" r="1" />
          </svg>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content className="table-dropdown-content" sideOffset={5}>
          <DropdownMenu.Item className="table-dropdown-item" onSelect={handleSortAscending}>
            <FiArrowUp />
            <span>Sort increasing</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item className="table-dropdown-item" onSelect={handleSortDescending}>
            <FiArrowDown />
            <span>Sort decreasing</span>
          </DropdownMenu.Item>

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="table-dropdown-item">
              <FiDroplet />
              <span>Background color</span>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="submenu-arrow">
                <path d="M2 2 L6 4 L2 6 Z" />
              </svg>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="table-dropdown-content" sideOffset={2} alignOffset={-5}>
                <ColorPicker editor={editor} />
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          {/* Show toggle header row only on first row */}
          {rowIndex === 0 && (
            <DropdownMenu.Item className="table-dropdown-item" onSelect={handleToggleHeaderRow}>
              {isFirstRowHeader ? <FiToggleRight /> : <FiToggleLeft />}
              <span>Header row: {isFirstRowHeader ? 'ON' : 'OFF'}</span>
            </DropdownMenu.Item>
          )}

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Item className="table-dropdown-item" onSelect={addRowAbove}>
            <FiPlus />
            <FiChevronUp />
            <span>Add row above</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item className="table-dropdown-item" onSelect={addRowBelow}>
            <FiPlus />
            <FiChevronDown />
            <span>Add row below</span>
          </DropdownMenu.Item>

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Item
            className="table-dropdown-item"
            onSelect={handleMoveUp}
            disabled={isFirst}
          >
            <FiChevronUp />
            <span>Move row up</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className="table-dropdown-item"
            onSelect={handleMoveDown}
            disabled={isLast}
          >
            <FiChevronDown />
            <span>Move row down</span>
          </DropdownMenu.Item>

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Item className="table-dropdown-item" onSelect={clearRow}>
            <FiX />
            <span>Clear cells</span>
          </DropdownMenu.Item>

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Item className="table-dropdown-item danger" onSelect={deleteRow}>
            <FiTrash2 />
            <span>Delete row</span>
          </DropdownMenu.Item>

          <DropdownMenu.Arrow className="table-dropdown-arrow" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

