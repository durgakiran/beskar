/**
 * TextFormattingMenu - Bubble menu for text formatting (bold, italic, etc.)
 * Includes inline math button for converting text to LaTeX formulas
 * Includes comment button for adding inline comments (when commentHandler provided).
 * When not editable, only the comment control is shown if commentHandler is set.
 */

import React, { useState, useEffect } from 'react';
import { Editor } from '@tiptap/core';
import { BubbleMenu, BubbleMenuButton } from './BubbleMenu';
import { TextColorPicker } from './TextColorPicker';
import type { CommentAPIHandler } from '../types';
import {
  FiBold,
  FiItalic,
  FiUnderline,
  FiCode,
  FiMessageSquare,
} from 'react-icons/fi';

export interface TextFormattingMenuProps {
  editor: Editor;
  commentHandler?: CommentAPIHandler;
  onCommentClick?: () => void;
  /**
   * When false, only the comment action is shown (if `commentHandler` is set).
   * Omit to use `editor.isEditable` (subscribes to editor `update` so toggling
   * editable mode re-renders).
   */
  editable?: boolean;
}

/**
 * Text Formatting Bubble Menu
 * Shows formatting options when text is selected
 */
export function TextFormattingMenu({
  editor,
  commentHandler,
  onCommentClick,
  editable: editableProp,
}: TextFormattingMenuProps) {
  const [textColor, setTextColor] = useState<string | undefined>(undefined);
  const [highlightColor, setHighlightColor] = useState<string | undefined>(undefined);
  const [commentDisabled, setCommentDisabled] = useState(true);
  const [editableFromEditor, setEditableFromEditor] = useState(() => editor.isEditable);

  useEffect(() => {
    if (editableProp !== undefined) return;
    const sync = () => setEditableFromEditor(editor.isEditable);
    editor.on('update', sync);
    sync();
    return () => {
      editor.off('update', sync);
    };
  }, [editor, editableProp]);

  const isFormattingEnabled = editableProp ?? editableFromEditor;

  useEffect(() => {
    const updateColors = () => {
      setTextColor(editor.getAttributes('textStyle').color);
      setHighlightColor(editor.getAttributes('highlight').color);
    };

    const updateCommentState = () => {
      const { selection, doc } = editor.state;
      if (selection.empty) {
        setCommentDisabled(true);
        return;
      }
      const selectedText = doc.textBetween(selection.from, selection.to, ' ');
      setCommentDisabled(!selectedText.trim());
    };

    editor.on('selectionUpdate', updateColors);
    editor.on('selectionUpdate', updateCommentState);
    editor.on('transaction', updateColors);
    editor.on('transaction', updateCommentState);

    updateColors();
    updateCommentState();

    return () => {
      editor.off('selectionUpdate', updateColors);
      editor.off('selectionUpdate', updateCommentState);
      editor.off('transaction', updateColors);
      editor.off('transaction', updateCommentState);
    };
  }, [editor]);

  if (!isFormattingEnabled) {
    if (!commentHandler) {
      return null;
    }
  }

  return (
    <BubbleMenu editor={editor}>
      {isFormattingEnabled && (
        <>
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

          {/* Inline Math */}
          <BubbleMenuButton
            onClick={() => editor.chain().focus().insertInlineMath().run()}
            isActive={editor.isActive('inlineMath')}
            title="Convert to Math Formula (Cmd+Shift+M)"
          >
            <span style={{ fontWeight: 'bold', fontSize: '18px' }}>∑</span>
          </BubbleMenuButton>
        </>
      )}

      {/* Comment */}
      {commentHandler && (
        <>
          <div className="bubble-menu-separator" />
          <BubbleMenuButton
            className="bubble-menu-button--with-label"
            onClick={() => onCommentClick?.()}
            isActive={false}
            disabled={commentDisabled}
            title={commentDisabled ? 'Select text to comment' : 'Add comment (Cmd+Alt+M)'}
          >
            <FiMessageSquare />
            <span className="bubble-menu-button__label">Comment</span>
          </BubbleMenuButton>
        </>
      )}
    </BubbleMenu>
  );
}
