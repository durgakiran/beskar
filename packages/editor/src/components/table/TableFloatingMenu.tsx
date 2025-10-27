/**
 * TableFloatingMenu - Floating menu for table operations
 * Shows when a table is active/selected
 */

import React, { useEffect, useState, useRef } from 'react';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Toggle from '@radix-ui/react-toggle';
import * as Separator from '@radix-ui/react-separator';
import { Editor } from '@tiptap/core';
import { FiPlus, FiTrash2, FiGrid, FiCopy } from 'react-icons/fi';
import { findTable, toggleRowNumbers as toggleRowNumbersUtil, copyTable, deleteTable as deleteTableUtil } from '../../nodes/table/utils';

interface TableFloatingMenuProps {
  editor: Editor;
}

export const TableFloatingMenu: React.FC<TableFloatingMenuProps> = ({ editor }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [showRowNumbers, setShowRowNumbers] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const addRow = () => {
    editor.chain().focus().addRowAfter().run();
  };

  const addColumn = () => {
    editor.chain().focus().addColumnAfter().run();
  };

  const handleDeleteTable = () => {
    console.log('[TableFloatingMenu] Delete button clicked');
    deleteTableUtil(editor);
  };

  const handleCopyTable = () => {
    console.log('[TableFloatingMenu] Copy button clicked');
    copyTable(editor);
  };

  const mergeCells = () => {
    editor.chain().focus().mergeCells().run();
  };

  const splitCell = () => {
    editor.chain().focus().splitCell().run();
  };

  const toggleRowNumbers = () => {
    console.log('[TableFloatingMenu] toggleRowNumbers called');
    console.log('[TableFloatingMenu] Current showRowNumbers state:', showRowNumbers);
    
    const { state, view } = editor;
    const table = findTable(state.selection);
    
    if (!table) {
      console.error('[TableFloatingMenu] No table found in selection');
      return;
    }
    
    console.log('[TableFloatingMenu] Table before toggle:', {
      showRowNumbers: table.node.attrs.showRowNumbers,
      attrs: table.node.attrs,
    });
    
    const tr = toggleRowNumbersUtil(state.tr);
    console.log('[TableFloatingMenu] Transaction created, dispatching...');
    view.dispatch(tr);
    
    // Update local state after a brief delay to allow the transaction to complete
    setTimeout(() => {
      const { selection } = editor.state;
      const updatedTable = findTable(selection);
      
      if (updatedTable) {
        const newValue = updatedTable.node.attrs.showRowNumbers || false;
        console.log('[TableFloatingMenu] Table after toggle:', {
          showRowNumbers: newValue,
          attrs: updatedTable.node.attrs,
        });
        setShowRowNumbers(newValue);
      }
    }, 10);
  };

  const canMergeCells = () => {
    return editor.can().mergeCells();
  };

  const canSplitCell = () => {
    return editor.can().splitCell();
  };

  useEffect(() => {
    const updateMenu = () => {
      const { state, view } = editor;
      const { selection } = state;
      
      // Check if we're inside a table
      const table = findTable(selection);
      
      if (!table || !editor.isEditable) {
        setIsVisible(false);
        return;
      }

      // Table is active, show menu
      setIsVisible(true);
      
      // Update row numbers state
      const currentRowNumbers = table.node.attrs.showRowNumbers || false;
      console.log('[TableFloatingMenu] updateMenu - showRowNumbers:', currentRowNumbers);
      setShowRowNumbers(currentRowNumbers);

      // Get the table DOM element for positioning
      const tablePos = table.pos;
      const tableDom = view.nodeDOM(tablePos);
      
      if (tableDom) {
        // Find the wrapper element
        const tableElement = tableDom instanceof HTMLElement && tableDom.classList?.contains('tableWrapper')
          ? tableDom
          : (tableDom as HTMLElement).closest?.('.tableWrapper');
          
        if (tableElement) {
          const tableRect = tableElement.getBoundingClientRect();
          
          // Position below the table, centered (like note block)
          setPosition({
            x: tableRect.left + tableRect.width / 2,
            y: tableRect.bottom + 10,
          });
        }
      }
    };

    // Update on selection/transaction changes
    editor.on('selectionUpdate', updateMenu);
    editor.on('transaction', updateMenu);
    editor.on('focus', updateMenu);
    editor.on('blur', () => setIsVisible(false));

    // Initial update
    updateMenu();

    return () => {
      editor.off('selectionUpdate', updateMenu);
      editor.off('transaction', updateMenu);
      editor.off('focus', updateMenu);
      editor.off('blur', () => setIsVisible(false));
    };
  }, [editor]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="table-floating-menu-container"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translateX(-50%)',
        zIndex: 50,
      }}
      onMouseDown={(e) => {
        // Prevent editor from losing focus
        e.preventDefault();
      }}
    >
      <Toolbar.Root className="table-toolbar table-toolbar-floating-menu">
        {/* Copy and Delete - Prominently displayed */}
        <Toolbar.Button className="table-toolbar-button" onClick={handleCopyTable} aria-label="Copy table">
          <FiCopy />
          <span>Copy</span>
        </Toolbar.Button>

        <Toolbar.Button className="table-toolbar-button danger" onClick={handleDeleteTable} aria-label="Delete table">
          <FiTrash2 />
          <span>Delete</span>
        </Toolbar.Button>

        <Separator.Root className="table-toolbar-separator" orientation="vertical" />

        {/* Additional table operations */}
        <Toolbar.Button className="table-toolbar-button" onClick={addRow}>
          <FiPlus />
          <span>Add row</span>
        </Toolbar.Button>

        <Toolbar.Button className="table-toolbar-button" onClick={addColumn}>
          <FiPlus />
          <span>Add column</span>
        </Toolbar.Button>

        <Separator.Root className="table-toolbar-separator" orientation="vertical" />

        <Toggle.Root
          className="table-toolbar-toggle"
          pressed={showRowNumbers}
          onPressedChange={toggleRowNumbers}
          aria-label="Toggle row numbers"
        >
          <FiGrid />
          <span>Row numbers</span>
        </Toggle.Root>

        {(canMergeCells() || canSplitCell()) && (
          <Separator.Root className="table-toolbar-separator" orientation="vertical" />
        )}

        {canMergeCells() && (
          <Toolbar.Button className="table-toolbar-button" onClick={mergeCells}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="12" height="12" stroke="currentColor" fill="none" />
              <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeDasharray="2,2" />
            </svg>
            <span>Merge cells</span>
          </Toolbar.Button>
        )}

        {canSplitCell() && (
          <Toolbar.Button className="table-toolbar-button" onClick={splitCell}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="12" height="12" stroke="currentColor" fill="none" />
              <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" />
            </svg>
            <span>Split cell</span>
          </Toolbar.Button>
        )}
      </Toolbar.Root>
    </div>
  );
};

