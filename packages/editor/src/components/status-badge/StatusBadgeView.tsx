/**
 * StatusBadgeView — pill + Radix popover for label and color.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import {
  STATUS_BADGE_COLORS,
  type StatusBadgeColor,
} from '../../nodes/statusBadgeConstants';

const SWATCH_COLORS: Record<StatusBadgeColor, string> = {
  gray: '#9ca3af',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};

function placeCursorAfterBadge(
  editor: NodeViewProps['editor'],
  getPos: NodeViewProps['getPos'],
  node: NodeViewProps['node']
) {
  const pos = typeof getPos === 'function' ? getPos() : null;
  if (pos == null || pos < 0) return;

  const after = pos + node.nodeSize;
  const { doc } = editor.state;

  if (after >= doc.content.size) {
    editor
      .chain()
      .focus()
      .insertContentAt(after, { type: 'paragraph' })
      .setTextSelection(after + 1)
      .run();
    return;
  }

  const tr = editor.state.tr.setSelection(TextSelection.create(doc, after));
  editor.view.dispatch(tr);
  editor.view.focus();
}

export function StatusBadgeView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const { label, color } = node.attrs as { label: string; color: StatusBadgeColor };
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(label);
  const [inputError, setInputError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInputValue(node.attrs.label);
      setInputError(false);
    }
  }, [open, node.attrs.label]);

  useEffect(() => {
    if (open && inputRef.current) {
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const tryCommit = useCallback((): boolean => {
    const v = inputValue.trim();
    if (!v) {
      setInputError(true);
      return false;
    }
    setInputError(false);
    updateAttributes({ label: v.toUpperCase() });
    return true;
  }, [inputValue, updateAttributes]);

  const finishClose = useCallback(
    (mode: 'commit' | 'discard') => {
      if (mode === 'commit' && !tryCommit()) return;
      setOpen(false);
      setInputError(false);
      requestAnimationFrame(() => {
        placeCursorAfterBadge(editor, getPos, node);
      });
    },
    [editor, getPos, node, tryCommit]
  );

  const colorClass = STATUS_BADGE_COLORS.includes(color) ? color : 'gray';
  const pillClass = `status-badge status-badge--${colorClass}${open ? ' status-badge--selected' : ''}`;

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper
        as="span"
        className="status-badge-wrapper status-badge-wrapper--readonly"
        contentEditable={false}
      >
        <span className={pillClass} role="img" aria-label={`Status: ${label}`}>
          {label}
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="status-badge-wrapper" contentEditable={false}>
      <Popover.Root open={open} onOpenChange={(next) => next && setOpen(true)} modal={false}>
        <Popover.Trigger asChild>
          <span
            className={pillClass}
            role="img"
            tabIndex={0}
            aria-label={`Status: ${label}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!open) setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(true);
              }
            }}
          >
            {label}
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="status-badge-popover"
            side="top"
            sideOffset={6}
            align="center"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              finishClose('discard');
            }}
            onInteractOutside={(e) => {
              e.preventDefault();
              finishClose('commit');
            }}
          >
            <div className="status-badge-swatches" role="group" aria-label="Badge color">
              {STATUS_BADGE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`status-badge-swatch status-badge-swatch--${c}${
                    color === c ? ' status-badge-swatch--active' : ''
                  }`}
                  style={{ backgroundColor: SWATCH_COLORS[c] }}
                  aria-label={`${c} color`}
                  aria-pressed={color === c}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => updateAttributes({ color: c })}
                />
              ))}
            </div>
            <input
              ref={inputRef}
              type="text"
              className={`status-badge-input${inputError ? ' status-badge-input--error' : ''}`}
              maxLength={40}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (inputError) setInputError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  finishClose('commit');
                }
              }}
              aria-invalid={inputError}
              aria-label="Badge label"
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </NodeViewWrapper>
  );
}
