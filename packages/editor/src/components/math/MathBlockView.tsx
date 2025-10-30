/**
 * MathBlockView - React component for rendering LaTeX math formulas
 * Uses KaTeX for fast, high-quality math rendering
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export const MathBlockView: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
  selected,
  editor,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [latex, setLatex] = useState(node.attrs.latex || '');
  const [error, setError] = useState<string | null>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Render the LaTeX formula (live updates while editing)
  useEffect(() => {
    if (renderRef.current && latex) {
      try {
        katex.render(latex, renderRef.current, {
          displayMode: node.attrs.displayMode,
          throwOnError: false,
          errorColor: '#ef4444',
          strict: 'warn',
          trust: false,
          macros: {
            '\\f': '#1f(#2)',
          },
        });
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    }
  }, [latex, node.attrs.displayMode]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditing]);

  const handleDoubleClick = useCallback(() => {
    if (!editor.isEditable) return;
    setIsEditing(true);
  }, [editor.isEditable]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    updateAttributes({ latex });
  }, [latex, updateAttributes]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Save on Escape
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsEditing(false);
        updateAttributes({ latex });
      }
      // Save on Cmd/Ctrl + Enter
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        setIsEditing(false);
        updateAttributes({ latex });
      }
      // Stop propagation to prevent editor shortcuts
      e.stopPropagation();
    },
    [latex, updateAttributes]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLatex(e.target.value);
  }, []);

  return (
    <NodeViewWrapper
      className={`math-block ${selected ? 'ProseMirror-selectednode' : ''}`}
      data-drag-handle
    >
      <div
        className={`math-block-content ${node.attrs.displayMode ? 'display-mode' : 'inline-mode'}`}
        onDoubleClick={handleDoubleClick}
      >
        {/* Live-updating formula render (always visible) */}
        <div
          ref={renderRef}
          className="math-block-render"
          onClick={!isEditing ? handleDoubleClick : undefined}
          title={!isEditing ? "Double-click to edit" : ""}
        />
        {error && <div className="math-block-error">{error}</div>}

        {/* Editor controls */}
        {isEditing && (
          <div className="math-block-editor">
            <textarea
              ref={textareaRef}
              value={latex}
              onChange={handleChange}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="math-block-textarea"
              placeholder="Enter LaTeX formula... (e.g., c = \pm\sqrt{a^2 + b^2})"
              spellCheck={false}
            />
            <div className="math-block-hint">
              Esc or Cmd+Enter to save
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

