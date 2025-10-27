/**
 * NoteBlockView - React component for rendering note blocks
 */

import React, { useState, useEffect } from 'react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/core';
import { getIconComponent } from './ThemePresets';
import { NoteBlockToolbar } from './NoteBlockToolbar';

export function NoteBlockView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const { icon, emoji, backgroundColor, theme } = node.attrs;
  const [showToolbar, setShowToolbar] = useState(false);

  // Get the appropriate icon component
  const IconComponent = icon !== 'emoji' ? getIconComponent(icon) : null;

  // Get icon color from theme or use default
  const getIconColor = () => {
    switch (icon) {
      case 'info':
        return '#0c66e4';
      case 'note':
        return '#6e5dc6';
      case 'success':
        return '#1f845a';
      case 'warning':
        return '#cf9f02';
      case 'error':
        return '#c9372c';
      default:
        return '#6e5dc6';
    }
  };

  // Check if cursor is inside this note block
  useEffect(() => {
    const checkSelection = () => {
      if (!editor.isEditable) {
        setShowToolbar(false);
        return;
      }

      if (typeof getPos !== 'function') {
        setShowToolbar(false);
        return;
      }

      const pos = getPos();
      if (pos === undefined || pos === null || pos < 0) {
        setShowToolbar(false);
        return;
      }

      const { from, to } = editor.state.selection;
      const nodeStart = pos;
      const nodeEnd = pos + node.nodeSize;

      // Show toolbar if cursor is inside this note block
      const isInside = from >= nodeStart && to <= nodeEnd;
      setShowToolbar(isInside);
    };

    checkSelection();

    // Listen to selection changes
    editor.on('selectionUpdate', checkSelection);
    editor.on('transaction', checkSelection);

    return () => {
      editor.off('selectionUpdate', checkSelection);
      editor.off('transaction', checkSelection);
    };
  }, [editor, getPos, node.nodeSize]);

  return (
    <NodeViewWrapper
      className={`note-block-wrapper ${showToolbar ? 'selected' : ''}`}
      data-theme={theme}
    >
      <div className="note-block-content-wrapper" style={{ backgroundColor }}>
        <div className="note-block-icon">
          {IconComponent ? (
            <IconComponent size={24} color={getIconColor()} />
          ) : (
            <span className="note-block-emoji">{emoji}</span>
          )}
        </div>
        <NodeViewContent className="note-block-content" />
      </div>
      {showToolbar && (
        <div className="note-block-toolbar-floating">
          <NoteBlockToolbar
            editor={editor}
            updateAttributes={updateAttributes}
            currentTheme={theme}
            currentIcon={icon}
            currentBackgroundColor={backgroundColor}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}
