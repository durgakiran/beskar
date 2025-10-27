import React from 'react';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Toggle from '@radix-ui/react-toggle';
import * as Separator from '@radix-ui/react-separator';
import { Editor } from '@tiptap/core';
import { BubbleMenu } from '../BubbleMenu';
import { FiPlus, FiTrash2, FiGrid, FiCopy } from 'react-icons/fi';
import { isTableSelected, findTable, toggleRowNumbers as toggleRowNumbersUtil, copyTable, deleteTable as deleteTableUtil } from '../../nodes/table/utils';

interface TableToolbarProps {
  editor: Editor;
}

export const TableToolbar: React.FC<TableToolbarProps> = ({ editor }) => {
  // Get current row numbers state from table node
  const getRowNumbersState = () => {
    const { selection } = editor.state;
    const table = findTable(selection);
    return table?.node.attrs.showRowNumbers || false;
  };

  const addRow = () => {
    editor.chain().focus().addRowAfter().run();
  };

  const addColumn = () => {
    editor.chain().focus().addColumnAfter().run();
  };

  const handleDeleteTable = () => {
    console.log('[TableToolbar] Delete button clicked');
    deleteTableUtil(editor);
  };

  const handleCopyTable = () => {
    console.log('[TableToolbar] Copy button clicked');
    copyTable(editor);
  };

  const mergeCells = () => {
    editor.chain().focus().mergeCells().run();
  };

  const splitCell = () => {
    editor.chain().focus().splitCell().run();
  };

  const toggleRowNumbers = () => {
    const { state, view } = editor;
    const tr = toggleRowNumbersUtil(state.tr);
    view.dispatch(tr);
  };

  const canMergeCells = () => {
    return editor.can().mergeCells();
  };

  const canSplitCell = () => {
    return editor.can().splitCell();
  };

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: ed }) => {
        const { selection } = ed.state;
        const table = findTable(selection);
        return !!table;
      }}
    >
      <Toolbar.Root className="table-toolbar table-toolbar-floating">
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
          pressed={getRowNumbersState()}
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
    </BubbleMenu>
  );
};

