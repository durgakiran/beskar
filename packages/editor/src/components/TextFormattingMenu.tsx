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
      setTextColor(editor.schema.marks.textStyle ? editor.getAttributes('textStyle').color : undefined);
      setHighlightColor(editor.schema.marks.highlight ? editor.getAttributes('highlight').color : undefined);
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

  const canComment = Boolean(commentHandler && editor.schema.marks.comment);

  const hasFormattingActions = Boolean(
    editor.schema.marks.bold || editor.schema.marks.italic || editor.schema.marks.underline ||
    editor.schema.marks.code || editor.commands.setColor || editor.commands.setHighlight ||
    editor.schema.nodes.inlineMath,
  );
  if (!(isFormattingEnabled && hasFormattingActions) && !canComment) return null;

  return (
    <BubbleMenu editor={editor}>
      {isFormattingEnabled && (
        <>
          {/* Bold */}
          {Boolean(editor.schema.marks.bold) && (
            <BubbleMenuButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive('bold')}
              title="Bold (Cmd+B)"
            >
              <FiBold />
            </BubbleMenuButton>
          )}

          {/* Italic */}
          {Boolean(editor.schema.marks.italic) && (
            <BubbleMenuButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive('italic')}
              title="Italic (Cmd+I)"
            >
              <FiItalic />
            </BubbleMenuButton>
          )}

          {/* Underline */}
          {Boolean(editor.schema.marks.underline) && (
            <BubbleMenuButton
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              isActive={editor.isActive('underline')}
              title="Underline (Cmd+U)"
            >
              <FiUnderline />
            </BubbleMenuButton>
          )}

          {/* Inline Code */}
          {Boolean(editor.schema.marks.code) && (
            <BubbleMenuButton
              onClick={() => editor.chain().focus().toggleCode().run()}
              isActive={editor.isActive('code')}
              title="Inline Code (Cmd+E)"
            >
              <FiCode />
            </BubbleMenuButton>
          )}

          {/* Separator */}
          <div className="bubble-menu-separator" />

          {/* Text Color */}
          {Boolean(editor.commands.setColor) && (
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
          )}

          {/* Highlight Color */}
          {Boolean(editor.commands.setHighlight) && (
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
          )}

          {/* Separator */}
          <div className="bubble-menu-separator" />

          {/* Inline Math */}
          {Boolean(editor.schema.nodes.inlineMath) && (
            <BubbleMenuButton
              onClick={() => editor.chain().focus().insertInlineMath().run()}
              isActive={editor.isActive('inlineMath')}
              title="Convert to Math Formula (Cmd+Shift+M)"
            >
              <span style={{ fontWeight: 'bold', fontSize: '18px' }}>∑</span>
            </BubbleMenuButton>
          )}
        </>
      )}

      {/* Comment */}
      {canComment && (
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
