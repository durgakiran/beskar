/**
 * TextFormattingMenu - Bubble menu for text formatting (bold, italic, etc.)
 * Includes inline math button for converting text to LaTeX formulas
 */

import React from 'react';
import { Editor } from '@tiptap/core';
import { BubbleMenu, BubbleMenuButton } from './BubbleMenu';
import {
  FiBold,
  FiItalic,
  FiUnderline,
  FiCode,
  FiType,
} from 'react-icons/fi';

export interface TextFormattingMenuProps {
  editor: Editor;
}

/**
 * Text Formatting Bubble Menu
 * Shows formatting options when text is selected
 */
export function TextFormattingMenu({ editor }: TextFormattingMenuProps) {
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

      {/* Inline Math - Convert selected text to formula */}
      <BubbleMenuButton
        onClick={() => editor.chain().focus().insertInlineMath().run()}
        isActive={editor.isActive('inlineMath')}
        title="Convert to Math Formula (Cmd+Shift+M)"
      >
        <span style={{ fontWeight: 'bold', fontSize: '18px' }}>∑</span>
      </BubbleMenuButton>
    </BubbleMenu>
  );
}

