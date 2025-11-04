/**
 * TextFormattingMenu - Bubble menu for text formatting (bold, italic, etc.)
 * Includes inline math button for converting text to LaTeX formulas
 */

import React, { useState, useEffect } from 'react';
import { Editor } from '@tiptap/core';
import { BubbleMenu, BubbleMenuButton } from './BubbleMenu';
import { TextColorPicker } from './TextColorPicker';
import {
  FiBold,
  FiItalic,
  FiUnderline,
  FiCode,
  FiMessageCircle,
} from 'react-icons/fi';

export interface TextFormattingMenuProps {
  editor: Editor;
  onAddComment?: () => void;
  canComment?: boolean;
}

/**
 * Text Formatting Bubble Menu
 * Shows formatting options when text is selected
 */
export function TextFormattingMenu({ editor, onAddComment, canComment = false }: TextFormattingMenuProps) {
  // Track current colors to trigger re-renders
  const [textColor, setTextColor] = useState<string | undefined>(undefined);
  const [highlightColor, setHighlightColor] = useState<string | undefined>(undefined);

  // Update colors when editor state changes
  useEffect(() => {
    const updateColors = () => {
      setTextColor(editor.getAttributes('textStyle').color);
      setHighlightColor(editor.getAttributes('highlight').color);
    };

    // Update on selection change
    editor.on('selectionUpdate', updateColors);
    editor.on('transaction', updateColors);
    
    // Initial update
    updateColors();

    return () => {
      editor.off('selectionUpdate', updateColors);
      editor.off('transaction', updateColors);
    };
  }, [editor]);

  return (
    <BubbleMenu editor={editor}>
      {/* Bold */}
      <BubbleMenuButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold (Cmd+B)"
      >
        <FiBold />
      </BubbleMenuButton>

      {/* Italic */}
      <BubbleMenuButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic (Cmd+I)"
      >
        <FiItalic />
      </BubbleMenuButton>

      {/* Underline */}
      <BubbleMenuButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="Underline (Cmd+U)"
      >
        <FiUnderline />
      </BubbleMenuButton>

      {/* Inline Code */}
      <BubbleMenuButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive('code')}
        title="Inline Code (Cmd+E)"
      >
        <FiCode />
      </BubbleMenuButton>

      {/* Separator */}
      <div className="bubble-menu-separator" />

      {/* Text Color */}
      <TextColorPicker
        onColorSelect={(color) => {
          if (color === '') {
            editor.chain().focus().unsetColor().run();
          } else {
            editor.chain().focus().setColor(color).run();
          }
        }}
        currentColor={textColor}
        label="Text Color"
      />

      {/* Highlight Color */}
      <TextColorPicker
        onColorSelect={(color) => {
          if (color === '' || color === 'transparent') {
            editor.chain().focus().unsetHighlight().run();
          } else {
            editor.chain().focus().setHighlight({ color }).run();
          }
        }}
        currentColor={highlightColor}
        label="Highlight"
      />

      {/* Separator */}
      <div className="bubble-menu-separator" />

      {/* Inline Math - Convert selected text to formula */}
      <BubbleMenuButton
        onClick={() => editor.chain().focus().insertInlineMath().run()}
        isActive={editor.isActive('inlineMath')}
        title="Convert to Math Formula (Cmd+Shift+M)"
      >
        <span style={{ fontWeight: 'bold', fontSize: '18px' }}>∑</span>
      </BubbleMenuButton>

      {/* Separator */}
      {canComment && onAddComment && (
        <>
          <div className="bubble-menu-separator" />
          {/* Add Comment */}
          <BubbleMenuButton
            onClick={onAddComment}
            title="Add comment"
          >
            <FiMessageCircle />
          </BubbleMenuButton>
        </>
      )}
    </BubbleMenu>
  );
}

