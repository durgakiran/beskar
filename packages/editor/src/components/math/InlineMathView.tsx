/**
 * InlineMathView - React component for rendering inline LaTeX math formulas
 * Compact, editable inline math that fits within text
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export const InlineMathView: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
  selected,
  editor,
  deleteNode,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [latex, setLatex] = useState(node.attrs.latex || 'x^2');
  const [error, setError] = useState<string | null>(null);
  const renderRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Render the LaTeX formula
  useEffect(() => {
    if (!isEditing && renderRef.current && latex) {
      try {
        katex.render(latex, renderRef.current, {
          displayMode: false,
          throwOnError: false,
          errorColor: '#ef4444',
          strict: 'warn',
          trust: false,
        });
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    }
  }, [latex, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = useCallback(() => {
    if (!editor.isEditable) return;
    setIsEditing(true);
  }, [editor.isEditable]);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    if (latex.trim()) {
      updateAttributes({ latex: latex.trim() });
    } else {
      // If empty, delete the node
      deleteNode();
    }
  }, [latex, updateAttributes, deleteNode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Save on Enter or Escape
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        setIsEditing(false);
        if (latex.trim()) {
          updateAttributes({ latex: latex.trim() });
        } else {
          deleteNode();
        }
        return;
      }
      
      // Delete node on Backspace when empty
      if (e.key === 'Backspace' && !latex) {
        e.preventDefault();
        deleteNode();
        return;
      }

      // Stop propagation to prevent editor shortcuts
      e.stopPropagation();
    },
    [latex, updateAttributes, deleteNode]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLatex(e.target.value);
  }, []);

  return (
    <NodeViewWrapper
      as="span"
      className={`inline-math-wrapper ${selected ? 'ProseMirror-selectednode' : ''} ${error ? 'inline-math-error' : ''}`}
    >
      {isEditing ? (
        <span className="inline-math-editor-wrapper">
          <input
            ref={inputRef}
            type="text"
            value={latex}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="inline-math-input"
            placeholder="LaTeX formula"
            spellCheck={false}
          />
        </span>
      ) : (
        <span
          className="inline-math-display"
          onClick={handleClick}
          title={error ? `Error: ${error}` : `LaTeX: ${latex} (click to edit)`}
        >
          <span ref={renderRef} className="inline-math-katex" />
          {error && <span className="inline-math-error-icon">⚠</span>}
        </span>
      )}
    </NodeViewWrapper>
  );
};

