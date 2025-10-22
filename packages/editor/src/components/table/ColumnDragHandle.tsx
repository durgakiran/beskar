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
  FiChevronLeft,
  FiChevronRight,
  FiDroplet,
  FiColumns,
  FiToggleLeft,
  FiToggleRight,
} from 'react-icons/fi';
import { ColorPicker } from './ColorPicker';
import {
  getColumnIndex,
  moveColumnLeft,
  moveColumnRight,
  clearCells,
  sortTableByColumn,
  distributeColumns,
  selectColumn,
  findTable,
  inspectTableAtSelection,
  toggleHeaderColumn,
} from '../../nodes/table/utils';
import { TableMap } from '@tiptap/pm/tables';

interface ColumnDragHandleProps {
  editor: Editor;
  columnIndex: number;
  isFirst: boolean;
  isLast: boolean;
  onHighlight?: () => void; // Callback to trigger column highlighting
}

export const ColumnDragHandle: React.FC<ColumnDragHandleProps> = ({
  editor,
  columnIndex,
  isFirst,
  isLast,
  onHighlight,
}) => {
  // Actions operate on the currently selected column (already selected by button)
  // Use setTimeout to ensure selection is stable before executing
  const addColumnBefore = () => {
    console.log('[ColumnDragHandle] addColumnBefore clicked, columnIndex:', columnIndex);
    setTimeout(() => {
      try {
        console.log('[ColumnDragHandle] Executing addColumnBefore...');
        console.log('[ColumnDragHandle] Current selection:', editor.state.selection);
        
        // Validate table structure before operation
        const { state } = editor;
        console.log('[ColumnDragHandle] Inspecting table structure...');
        inspectTableAtSelection(state.selection);
        
        const table = findTable(state.selection);
        if (table) {
          try {
            table.node.check();
            console.log('[ColumnDragHandle] Table structure valid before addColumnBefore ✓');
          } catch (e) {
            console.error('[ColumnDragHandle] Table structure INVALID before addColumnBefore:', e);
            alert('Table structure is corrupted. Please undo recent changes or create a new table.');
            return;
          }
        }
        
        editor.chain().focus().addColumnBefore().run();
        console.log('[ColumnDragHandle] addColumnBefore completed ✓');
      } catch (e) {
        console.error('[ColumnDragHandle] Failed to add column before:', e);
        alert('Failed to add column: ' + (e as Error).message);
      }
    }, 10);
  };

  const addColumnAfter = () => {
    console.log('[ColumnDragHandle] addColumnAfter clicked, columnIndex:', columnIndex);
    setTimeout(() => {
      try {
        console.log('[ColumnDragHandle] Executing addColumnAfter...');
        console.log('[ColumnDragHandle] Current selection:', editor.state.selection);
        
        // Validate table structure before operation
        const { state } = editor;
        console.log('[ColumnDragHandle] Inspecting table structure...');
        inspectTableAtSelection(state.selection);
        
        const table = findTable(state.selection);
        if (table) {
          try {
            table.node.check();
            console.log('table.node', table.node);
            console.log('[ColumnDragHandle] Table structure valid before addColumnAfter ✓');
          } catch (e) {
            console.error('[ColumnDragHandle] Table structure INVALID before addColumnAfter:', e);
            alert('Table structure is corrupted. Please undo recent changes or create a new table.');
            return;
          }
        }
        
        editor.chain().focus().addColumnAfter().run();
        console.log('[ColumnDragHandle] addColumnAfter completed ✓');
      } catch (e) {
        console.error('[ColumnDragHandle] Failed to add column after:', e);
        alert('Failed to add column: ' + (e as Error).message);
      }
    }, 10);
  };

  const deleteColumn = () => {
    setTimeout(() => {
      try {
        editor.chain().focus().deleteColumn().run();
      } catch (e) {
        console.error('Failed to delete column:', e);
      }
    }, 10);
  };

  const clearColumn = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        const tr = clearCells(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to clear column:', e);
      }
    }, 10);
  };

  const handleMoveLeft = () => {
    console.log('[ColumnDragHandle] handleMoveLeft clicked, columnIndex:', columnIndex);
    setTimeout(() => {
      try {
        const { state, view } = editor;
        console.log('[ColumnDragHandle] Executing moveColumnLeft...');
        const tr = moveColumnLeft(columnIndex)(state.tr);
        view.dispatch(tr);
        console.log('[ColumnDragHandle] moveColumnLeft dispatched ✓');
      } catch (e) {
        console.error('[ColumnDragHandle] Failed to move column left:', e);
        alert('Failed to move column left: ' + (e as Error).message);
      }
    }, 10);
  };

  const handleMoveRight = () => {
    console.log('[ColumnDragHandle] handleMoveRight clicked, columnIndex:', columnIndex);
    setTimeout(() => {
      try {
        const { state, view } = editor;
        console.log('[ColumnDragHandle] Executing moveColumnRight...');
        const tr = moveColumnRight(columnIndex)(state.tr);
        view.dispatch(tr);
        console.log('[ColumnDragHandle] moveColumnRight dispatched ✓');
      } catch (e) {
        console.error('[ColumnDragHandle] Failed to move column right:', e);
        alert('Failed to move column right: ' + (e as Error).message);
      }
    }, 10);
  };

  const handleSortAscending = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        const tr = sortTableByColumn(columnIndex, true)(state.tr);
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
        const tr = sortTableByColumn(columnIndex, false)(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to sort descending:', e);
      }
    }, 10);
  };

  const handleDistributeColumns = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        const tr = distributeColumns(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to distribute columns:', e);
      }
    }, 10);
  };

  const handleToggleHeaderColumn = () => {
    setTimeout(() => {
      try {
        const { state, view } = editor;
        const tr = toggleHeaderColumn(state.tr);
        view.dispatch(tr);
      } catch (e) {
        console.error('Failed to toggle header column:', e);
      }
    }, 10);
  };

  // Track header state dynamically
  const [isFirstColumnHeader, setIsFirstColumnHeader] = React.useState(false);

  const handleOpenChange = React.useCallback((open: boolean) => {
    if (open) {
      // Update header state when menu opens
      const { state } = editor;
      const table = findTable(state.selection);
      if (table) {
        const map = TableMap.get(table.node);
        if (map.height > 0) {
          // Check cell at row 1 if exists (not row 0, as that might be header due to header row)
          const checkRow = map.height > 1 ? 1 : 0;
          const cellPos = map.positionAt(checkRow, 0, table.node);
          const cell = table.node.nodeAt(cellPos);
          setIsFirstColumnHeader(cell?.type.name === 'tableHeader');
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
          className="column-drag-handle-trigger"
          aria-label="Column menu"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <circle cx="3" cy="3" r="1" />
            <circle cx="6" cy="3" r="1" />
            <circle cx="9" cy="3" r="1" />
            <circle cx="3" cy="9" r="1" />
            <circle cx="6" cy="9" r="1" />
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

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Item className="table-dropdown-item" onSelect={addColumnBefore}>
            <FiChevronLeft />
            <FiPlus />
            <span>Add column left</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item className="table-dropdown-item" onSelect={addColumnAfter}>
            <FiPlus />
            <FiChevronRight />
            <span>Add column right</span>
          </DropdownMenu.Item>

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Item
            className="table-dropdown-item"
            onSelect={handleMoveLeft}
            disabled={isFirst}
          >
            <FiChevronLeft />
            <span>Move column left</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className="table-dropdown-item"
            onSelect={handleMoveRight}
            disabled={isLast}
          >
            <FiChevronRight />
            <span>Move column right</span>
          </DropdownMenu.Item>

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Item className="table-dropdown-item" onSelect={handleDistributeColumns}>
            <FiColumns />
            <span>Distribute columns</span>
          </DropdownMenu.Item>

          {/* Show toggle header column only on first column */}
          {columnIndex === 0 && (
            <DropdownMenu.Item className="table-dropdown-item" onSelect={handleToggleHeaderColumn}>
              {isFirstColumnHeader ? <FiToggleRight /> : <FiToggleLeft />}
              <span>Header column: {isFirstColumnHeader ? 'ON' : 'OFF'}</span>
            </DropdownMenu.Item>
          )}

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Item className="table-dropdown-item" onSelect={clearColumn}>
            <FiX />
            <span>Clear cells</span>
          </DropdownMenu.Item>

          <Separator.Root className="table-dropdown-separator" />

          <DropdownMenu.Item className="table-dropdown-item danger" onSelect={deleteColumn}>
            <FiTrash2 />
            <span>Delete column</span>
          </DropdownMenu.Item>

          <DropdownMenu.Arrow className="table-dropdown-arrow" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

