/**
 * ImageFloatingMenu - Floating toolbar for image blocks
 */

import React from 'react';
import type { Editor } from '@tiptap/core';
import { FiCopy, FiTrash2, FiAlignLeft, FiAlignCenter, FiAlignRight } from 'react-icons/fi';
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
    <div className="image-block-toolbar-floating">
      <div className="image-toolbar-buttons">
        {/* Alignment buttons */}
        <div className="image-toolbar-group">
          <button
            className={`image-toolbar-button ${currentAlign === 'left' ? 'active' : ''}`}
            type="button"
            onClick={() => handleAlignChange('left')}
            aria-label="Align left"
            title="Align left"
          >
            <FiAlignLeft size={16} />
          </button>
          <button
            className={`image-toolbar-button ${currentAlign === 'center' ? 'active' : ''}`}
            type="button"
            onClick={() => handleAlignChange('center')}
            aria-label="Align center"
            title="Align center"
          >
            <FiAlignCenter size={16} />
          </button>
          <button
            className={`image-toolbar-button ${currentAlign === 'right' ? 'active' : ''}`}
            type="button"
            onClick={() => handleAlignChange('right')}
            aria-label="Align right"
            title="Align right"
          >
            <FiAlignRight size={16} />
          </button>
        </div>
        
        {/* Divider */}
        <div className="image-toolbar-divider" />
        
        {/* Copy and Delete buttons */}
        <button
          className="image-toolbar-button"
          type="button"
          onClick={handleCopy}
          aria-label="Copy image"
        >
          <FiCopy size={16} />
          <span>Copy</span>
        </button>
        <button
          className="image-toolbar-button image-toolbar-button-danger"
          type="button"
          onClick={handleDelete}
          aria-label="Delete image"
        >
          <FiTrash2 size={16} />
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
}

