/**
 * CommentInputPopover
 *
 * Anchored to the block for the selection captured at open. Rendered with
 * createPortal into the nearest scroll parent (or .beskar-editor) and
 * position:absolute using offsets in that parent's coordinate space, so
 * browser scrolling moves the popover with the document. Placement is computed
 * once at open; window resize updates it in case the layout width changes.
 */
import React, { useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@radix-ui/themes';
import { Editor } from '@tiptap/core';
import { FiPaperclip, FiX } from 'react-icons/fi';
import type { CommentAPIHandler, CommentReplyAttachment } from '../types';
import {
  findPositioningParent,
  getAnchorRectForRange,
  computePlacementInParent,
} from '../utils/commentAnchorPositioning';
import { extractAnchor } from '../utils/anchorResolution';
import './CommentInputPopover.css';

const POPOVER_WIDTH_PX = 320;
const POPOVER_APPROX_HEIGHT_PX = 270;

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
  // Multiple attachments
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
    e.target.value = ''; // Reset so the same file can be re-selected
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if ((!body.trim() && attachedFiles.length === 0) || isSubmitting) return;

    const anchor = extractAnchor(editor);
    if (!anchor) {
      setError('Could not find a valid anchor for the selection.');
      return;
    }

    let attachments: CommentReplyAttachment[] | undefined;
    if (attachedFiles.length > 0) {
      attachments = attachedFiles.map((file) => ({
        attachmentId: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        // Blob URL — downloadable this session. Replace with real upload URL in production.
        url: URL.createObjectURL(file),
      }));
    }

    const commentId = crypto.randomUUID();
    setIsSubmitting(true);
    setError(null);

    try {
      const thread = await commentHandler.createThread(
        documentId,
        commentId,
        anchor,
        body.trim(),
        attachments,
      );
      onClose();
      onThreadCreated?.(thread.id);
    } catch (err) {
      console.error('[CommentInputPopover] createThread failed:', err);
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
    [body, attachedFiles, onClose, isSubmitting],
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

      {/* Attached files preview — one pill per file */}
      {attachedFiles.length > 0 && (
        <div className="comment-input-attachment-row">
          {attachedFiles.map((file, i) => (
            <span key={`${file.name}-${i}`} className="comment-input-attachment-pill">
              <FiPaperclip size={11} />
              {file.name}
              <button
                type="button"
                className="comment-input-attachment-remove"
                onClick={() => handleRemoveFile(i)}
                title={`Remove ${file.name}`}
                disabled={isSubmitting}
              >
                <FiX size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="comment-input-error">{error}</p>}

      {/* Hidden multi-file input */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        multiple
      />

      <div className="comment-input-actions">
        {/* Attach button — far left */}
        <button
          type="button"
          className="comment-input-attach-btn"
          onClick={handleAttachClick}
          disabled={isSubmitting}
          title="Attach files"
        >
          <FiPaperclip size={14} />
          Attach
        </button>

        <Button type="button" variant="outline" color="gray" size="2" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="solid"
          color="plum"
          size="2"
          onClick={handleSubmit}
          disabled={(!body.trim() && attachedFiles.length === 0) || isSubmitting}
          title="Submit (Cmd+Enter)"
        >
          {isSubmitting ? 'Saving…' : 'Comment'}
        </Button>
      </div>
    </div>,
    positioningParent,
  );
}
