import React from 'react';
import type { Editor } from '@tiptap/core';
import { FiCopy, FiTrash2 } from 'react-icons/fi';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import { copyColumnsBlock, deleteColumnsBlock } from './utils';

interface ColumnsFloatingMenuProps {
  editor: Editor;
  getPos: (() => number | undefined) | boolean;
}

export function ColumnsFloatingMenu({ editor, getPos }: ColumnsFloatingMenuProps) {
  const handleCopy = () => {
    if (typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined && pos >= 0) {
        editor.chain().focus().setNodeSelection(pos).run();
      }
    }
    
    copyColumnsBlock(editor);
  };

  const handleDelete = () => {
    if (typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined && pos >= 0) {
        editor.chain().focus().setNodeSelection(pos).run();
        
        setTimeout(() => {
          deleteColumnsBlock(editor);
        }, 10);
        return;
      }
    }
    
    deleteColumnsBlock(editor);
  };

  return (
    <Toolbar.Root className="editor-floating-toolbar">
      <Toolbar.Button
        className="editor-floating-toolbar-button"
        onClick={handleCopy}
        title="Copy layout"
        aria-label="Copy layout"
      >
        <FiCopy size={16} />
        <span>Copy</span>
      </Toolbar.Button>
      <Toolbar.Button
        className="editor-floating-toolbar-button"
        onClick={handleDelete}
        title="Delete layout"
        aria-label="Delete layout"
      >
        <FiTrash2 size={16} />
        <span>Delete</span>
      </Toolbar.Button>
    </Toolbar.Root>
  );
}
