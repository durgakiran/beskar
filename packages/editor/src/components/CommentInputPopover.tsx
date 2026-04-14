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
import type { AttachmentAPIHandler, CommentAPIHandler, CommentReplyAttachment } from '../types';
import {
  findPositioningParent,
  getAnchorRectForRange,
  computePlacementInParent,
} from '../utils/commentAnchorPositioning';
import { extractAnchor } from '../utils/anchorResolution';
import {
  buildReplyAttachments,
  readFilesFromInputEvent,
  uploadCommentAttachments,
} from './comment-ui';
import './CommentInputPopover.css';

const POPOVER_WIDTH_PX = 320;
const POPOVER_APPROX_HEIGHT_PX = 270;

export interface CommentInputPopoverProps {
  editor: Editor;
  commentHandler: CommentAPIHandler;
  attachmentHandler?: AttachmentAPIHandler;
  documentId: string;
  onClose: () => void;
  onThreadCreated?: (threadId: string) => void;
}

export function CommentInputPopover({
  editor,
  commentHandler,
  attachmentHandler,
  documentId,
  onClose,
  onThreadCreated,
}: CommentInputPopoverProps) {
  const [body, setBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Multiple attachments
  const [attachedFiles, setAttachedFiles] = useState<CommentReplyAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
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
      const elementHeight = popoverRef.current?.offsetHeight ?? POPOVER_APPROX_HEIGHT_PX;
      const nextPlacement = computePlacementInParent(parent, rect, {
        elementWidth: POPOVER_WIDTH_PX,
        elementHeight,
      });
      setPlacement((prev) =>
        prev.left === nextPlacement.left && prev.top === nextPlacement.top ? prev : nextPlacement,
      );
    };

    applyPlacement();
    window.addEventListener('resize', applyPlacement);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && popoverRef.current
        ? new ResizeObserver(() => applyPlacement())
        : null;
    if (resizeObserver && popoverRef.current) {
      resizeObserver.observe(popoverRef.current);
    }

    return () => {
      if (madeRelative) {
        parent.style.position = '';
      }
      window.removeEventListener('resize', applyPlacement);
      resizeObserver?.disconnect();
    };
  }, [editor, positioningParent]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = readFilesFromInputEvent(e);
    e.target.value = ''; // Reset so the same file can be re-selected
    if (files.length === 0) return;

    setError(null);
    if (files.length > 0) {
      if (attachmentHandler) {
        setIsUploadingAttachments(true);
        setUploadingFiles((prev) => [...prev, ...files]);
        try {
          const { uploaded, failedFiles } = await uploadCommentAttachments(attachmentHandler, files);
          if (uploaded.length > 0) {
            setAttachedFiles((prev) => [...prev, ...uploaded]);
          }
          if (failedFiles.length > 0) {
            setError(`Failed to upload: ${failedFiles.join(', ')}`);
          }
        } finally {
          setUploadingFiles((prev) => prev.filter((file) => !files.includes(file)));
          setIsUploadingAttachments(false);
        }
      } else {
        setAttachedFiles((prev) => [...prev, ...buildReplyAttachments(files)]);
      }
    }
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if ((!body.trim() && attachedFiles.length === 0) || isSubmitting || isUploadingAttachments) return;

    const anchor = extractAnchor(editor);
    if (!anchor) {
      setError('Could not find a valid anchor for the selection.');
      return;
    }

    const attachments = attachedFiles.length > 0 ? attachedFiles : undefined;

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
      {(attachedFiles.length > 0 || uploadingFiles.length > 0) && (
        <div className="comment-input-attachment-row">
          {attachedFiles.map((file, i) => (
            <span key={`${file.attachmentId}-${i}`} className="comment-input-attachment-pill">
              <FiPaperclip size={11} />
              {file.fileName}
              <button
                type="button"
                className="comment-input-attachment-remove"
                onClick={() => handleRemoveFile(i)}
                title={`Remove ${file.fileName}`}
                disabled={isSubmitting}
              >
                <FiX size={11} />
              </button>
            </span>
          ))}
          {uploadingFiles.map((file, i) => (
            <span key={`uploading-${file.name}-${i}`} className="comment-input-attachment-pill">
              <FiPaperclip size={11} />
              {file.name}
            </span>
          ))}
        </div>
      )}

      {error && <p className="comment-input-error">{error}</p>}
      {isUploadingAttachments && <p className="comment-input-error">Uploading attachment…</p>}

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
          disabled={isSubmitting || isUploadingAttachments}
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
          disabled={(!body.trim() && attachedFiles.length === 0) || isSubmitting || isUploadingAttachments}
          title="Submit (Cmd+Enter)"
        >
          {isSubmitting ? 'Saving…' : 'Comment'}
        </Button>
      </div>
    </div>,
    positioningParent,
  );
}
