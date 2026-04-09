/**
 * CommentInputPopover
 *
 * Anchored to the block for the selection captured at open. Rendered with
 * createPortal into the nearest scroll parent (or .beskar-editor) and
 * position:absolute using offsets in that parent’s coordinate space, so
 * browser scrolling moves the popover with the document. Placement is computed
 * once at open; window resize updates it in case the layout width changes.
 */
import React, { useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@radix-ui/themes';
import { Editor } from '@tiptap/core';
import type { CommentAPIHandler } from '../types';
import {
  findPositioningParent,
  getAnchorRectForRange,
  computePlacementInParent,
} from '../utils/commentAnchorPositioning';
import { extractAnchor } from '../utils/anchorResolution';
import './CommentInputPopover.css';

const POPOVER_WIDTH_PX = 320;
const POPOVER_APPROX_HEIGHT_PX = 220;

export interface CommentInputPopoverProps {
  editor: Editor;
  commentHandler: CommentAPIHandler;
  documentId: string;
  onClose: () => void;
  onThreadCreated?: (threadId: string) => void;
}

export function CommentInputPopover({
  editor,
  commentHandler,
  documentId,
  onClose,
  onThreadCreated,
}: CommentInputPopoverProps) {
  const [body, setBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const selectionRef = useRef<{ from: number; to: number; quotedText: string } | null>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
  }>({ left: 0, top: 0 });

  const positioningParent = useMemo(
    () => findPositioningParent(editor.view.dom as HTMLElement),
    [editor],
  );

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [editor]);

  useLayoutEffect(() => {
    const { state } = editor;
    const { from, to } = state.selection;
    selectionRef.current = {
      from,
      to,
      quotedText: state.doc.textBetween(from, to, ' '),
    };

    const parent = positioningParent;
    const computed = getComputedStyle(parent).position;
    const madeRelative = computed === 'static';
    if (madeRelative) {
      parent.style.position = 'relative';
    }

    const applyPlacement = () => {
      const captured = selectionRef.current;
      if (!captured) return;
      const rect = getAnchorRectForRange(editor, captured.from, captured.to);
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      setPlacement(
        computePlacementInParent(parent, rect, {
          elementWidth: POPOVER_WIDTH_PX,
          elementHeight: POPOVER_APPROX_HEIGHT_PX,
        }),
      );
    };

    applyPlacement();
    window.addEventListener('resize', applyPlacement);

    return () => {
      if (madeRelative) {
        parent.style.position = '';
      }
      window.removeEventListener('resize', applyPlacement);
    };
  }, [editor, positioningParent]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  const handleSubmit = async () => {
    if (!body.trim() || isSubmitting) return;

    const anchor = extractAnchor(editor);
    if (!anchor) {
      setError('Could not find a valid anchor for the selection.');
      return;
    }

    const commentId = crypto.randomUUID();
    setIsSubmitting(true);
    setError(null);

    const withMarkWrites = (fn: () => void) => {
      const wasEditable = editor.isEditable;
      if (!wasEditable) editor.setEditable(true);
      try {
        fn();
      } finally {
        if (!wasEditable) editor.setEditable(false);
      }
    };

    withMarkWrites(() => {
      editor.commands.addComment(commentId);
    });

    try {
      const thread = await commentHandler.createThread(
        documentId,
        commentId,
        anchor,
        body.trim(),
      );
      onClose();
      onThreadCreated?.(thread.id);
    } catch (err) {
      console.error('[CommentInputPopover] createThread failed:', err);
      // Rollback mark
      withMarkWrites(() => {
        editor.commands.removeComment(commentId);
      });
      setError('Failed to save comment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body, onClose, isSubmitting],
  );

  return createPortal(
    <div
      ref={popoverRef}
      className="comment-input-popover"
      style={{
        position: 'absolute',
        left: `${placement.left}px`,
        top: `${placement.top}px`,
        transform: 'translate(0, -50%)',
        zIndex: 1000,
      }}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        className="comment-input-textarea"
        placeholder="Add a comment…"
        value={body}
        onChange={handleTextareaChange}
        rows={2}
        disabled={isSubmitting}
      />

      {error && <p className="comment-input-error">{error}</p>}

      <div className="comment-input-actions">
        <Button type="button" variant="outline" color="gray" size="2" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="solid"
          color="plum"
          size="2"
          onClick={handleSubmit}
          disabled={!body.trim() || isSubmitting}
          title="Submit (Cmd+Enter)"
        >
          {isSubmitting ? 'Saving…' : 'Comment'}
        </Button>
      </div>
    </div>,
    positioningParent,
  );
}
