/**
 * ImageFloatingMenu - Floating toolbar for image blocks
 */

import React from 'react';
import type { Editor } from '@tiptap/core';
import { FiCopy, FiTrash2, FiAlignLeft, FiAlignCenter, FiAlignRight } from 'react-icons/fi';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import { copyImageBlock, deleteImageBlock } from './utils';

interface ImageFloatingMenuProps {
  editor: Editor;
  getPos: (() => number | undefined) | boolean;
  currentAlign: 'left' | 'center' | 'right';
  updateAttributes: (attrs: Record<string, any>) => void;
}

export function ImageFloatingMenu({ editor, getPos, currentAlign, updateAttributes }: ImageFloatingMenuProps) {
  const handleCopy = () => {
    console.log('[ImageFloatingMenu] Copy clicked');
    
    // Focus on the image node first
    if (typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined && pos >= 0) {
        editor.chain().focus().setNodeSelection(pos).run();
      }
    }
    
    const result = copyImageBlock(editor);
    console.log('[ImageFloatingMenu] Copy result:', result);
  };

  const handleDelete = () => {
    console.log('[ImageFloatingMenu] Delete clicked');
    
    // Focus on the image node first
    if (typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined && pos >= 0) {
        editor.chain().focus().setNodeSelection(pos).run();
        
        // Small delay to ensure selection is updated
        setTimeout(() => {
          deleteImageBlock(editor);
        }, 10);
        return;
      }
    }
    
    deleteImageBlock(editor);
  };

  const handleAlignChange = (align: 'left' | 'center' | 'right') => {
    console.log('[ImageFloatingMenu] Align changed to:', align);
    updateAttributes({ align });
  };

  return (
    <div className="image-block-toolbar-floating" style={{ top: '-3.5rem', bottom: 'auto' }}>
      <Toolbar.Root className="editor-floating-toolbar">
        {/* Copy and Delete buttons */}
        <Toolbar.Button
          className="editor-floating-toolbar-button"
          onClick={handleCopy}
          aria-label="Copy image"
        >
          <FiCopy size={16} />
          <span>Copy</span>
        </Toolbar.Button>
        <Toolbar.Button
          className="editor-floating-toolbar-button"
          onClick={handleDelete}
          aria-label="Delete image"
        >
          <FiTrash2 size={16} />
          <span>Delete</span>
        </Toolbar.Button>

        {/* Divider */}
        <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />

        {/* Alignment buttons */}
        <Toolbar.Button
          className={`editor-floating-toolbar-button ${currentAlign === 'left' ? 'active' : ''}`}
          onClick={() => handleAlignChange('left')}
          aria-label="Align left"
          title="Align left"
        >
          <FiAlignLeft size={16} />
        </Toolbar.Button>
        <Toolbar.Button
          className={`editor-floating-toolbar-button ${currentAlign === 'center' ? 'active' : ''}`}
          onClick={() => handleAlignChange('center')}
          aria-label="Align center"
          title="Align center"
        >
          <FiAlignCenter size={16} />
        </Toolbar.Button>
        <Toolbar.Button
          className={`editor-floating-toolbar-button ${currentAlign === 'right' ? 'active' : ''}`}
          onClick={() => handleAlignChange('right')}
          aria-label="Align right"
          title="Align right"
        >
          <FiAlignRight size={16} />
        </Toolbar.Button>
      </Toolbar.Root>
    </div>
  );
}

