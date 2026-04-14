/**
 * CommentThreadCard
 *
 * Floating card to the right of the block that contains the comment mark
 * (same anchoring strategy as CommentInputPopover: portal + position:absolute
 * in the editor scroll parent). Backdrop is portaled alongside so it stacks
 * above the editor while the card tracks the document on scroll.
 *
 * Features:
 *  - Prev / Next navigation, reply, resolve, kebab (edit / delete / copy link)
 *  - Optional fallbackAnchorRect when the mark is missing from the doc (e.g. gutter)
 */
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { FiCheckCircle, FiCornerDownLeft, FiEdit2, FiFile, FiMessageSquare, FiPaperclip, FiRotateCcw, FiTrash2, FiX } from 'react-icons/fi';
import type { CommentAPIHandler, CommentThread, CommentReply, CommentReplyAttachment } from '../types';
import {
  findPositioningParent,
  getAnchorRectForCommentId,
  computePlacementInParent,
} from '../utils/commentAnchorPositioning';
import './CommentThreadCard.css';

export interface CommentThreadCardProps {
  editor: Editor;
  threads: CommentThread[];
  activeIndex: number;
  /** When the comment span is not in the DOM, use this rect (viewport coords). */
  fallbackAnchorRect?: DOMRect | null;
  commentHandler: CommentAPIHandler;
  presentation?: 'popover' | 'bottom-sheet';
  onClose: () => void;
  onNavigate: (index: number) => void;
  onThreadUpdated: (thread: CommentThread) => void;
  onThreadDeleted: (threadId: string) => void;
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 10) return 'just now';
  if (s < 60) return 'less than a minute ago';
  if (m < 60) return `${m} minute${m > 1 ? 's' : ''} ago`;
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

function getInitials(name: string | null): string {
  if (!name) return '?';
  return name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
}

/**
 * API stores the opening message as the first reply when it matches the thread author.
 * Split it out so we render one author row + quote + body, not a duplicate "reply".
 */
function splitOpeningReply(thread: CommentThread): {
  opening: CommentReply | null;
  followUps: CommentReply[];
} {
  const [first, ...rest] = thread.replies;
  if (!first) return { opening: null, followUps: [] };
  if (first.authorId === thread.createdBy) {
    return { opening: first, followUps: rest };
  }
  return { opening: null, followUps: thread.replies };
}

function Avatar({ name, size = 'default' }: { name: string | null; size?: 'default' | 'small' }) {
  return (
    <div
      className={`ctc-avatar ${size === 'small' ? 'ctc-avatar--small' : ''}`}
      title={name ?? 'Deleted user'}
    >
      {getInitials(name)}
    </div>
  );
}

// KebabMenu removed in favor of inline actions.

// ─── Reply Item ───────────────────────────────────────────────────────────────

interface ReplyItemProps {
  reply: CommentReply;
  /** Called with new body text AND the final attachment list after edit. */
  onEdit: (body: string, attachments: CommentReplyAttachment[]) => void;
  onDelete: () => void;
  /** Opening message: no second avatar row; sits under the thread quote. */
  variant?: 'default' | 'embedded';
  /** Increment (e.g. from primary Edit btn) to open the embedded editor. */
  externalEditNonce?: number;
}

function ReplyItem({
  reply,
  onEdit,
  onDelete,
  variant = 'default',
  externalEditNonce = 0,
}: ReplyItemProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(reply.body);
  const prevExternalEdit = useRef(0);

  // Attachments during edit: existing ones the user keeps, plus new files to add
  const [editAttachments, setEditAttachments] = useState<CommentReplyAttachment[]>(reply.attachments ?? []);
  const [editNewFiles, setEditNewFiles] = useState<File[]>([]);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditBody(reply.body);
  }, [reply.body]);

  useEffect(() => {
    if (variant !== 'embedded' || !externalEditNonce) return;
    if (externalEditNonce > prevExternalEdit.current) {
      prevExternalEdit.current = externalEditNonce;
      // Reset attachment state to current reply when edit is opened externally
      setEditAttachments(reply.attachments ?? []);
      setEditNewFiles([]);
      setEditing(true);
    }
  }, [externalEditNonce, variant, reply.attachments]);

  const startEditing = () => {
    setEditAttachments(reply.attachments ?? []);
    setEditNewFiles([]);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditNewFiles([]);
    setEditAttachments(reply.attachments ?? []);
  };

  const handleEditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setEditNewFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
    e.target.value = '';
  };

  const removeExistingAttachment = (attachmentId: string) => {
    setEditAttachments((prev) => prev.filter((a) => a.attachmentId !== attachmentId));
  };

  const removeNewFile = (index: number) => {
    setEditNewFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const submitEdit = () => {
    if (!editBody.trim() && editAttachments.length === 0 && editNewFiles.length === 0) return;
    // Convert new files to CommentReplyAttachment using blob URLs
    const newAtts: CommentReplyAttachment[] = editNewFiles.map((f) => ({
      attachmentId: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileName: f.name,
      fileSize: f.size,
      mimeType: f.type,
      url: URL.createObjectURL(f),
    }));
    onEdit(editBody.trim(), [...editAttachments, ...newAtts]);
    setEditing(false);
    setEditNewFiles([]);
  };

  const hasEditAttachments = editAttachments.length > 0 || editNewFiles.length > 0;

  const editArea = (
    <div className="ctc-edit-area">
      <textarea
        className="ctc-reply-input-textarea"
        value={editBody}
        onChange={(e) => setEditBody(e.target.value)}
        autoFocus
        rows={2}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitEdit();
          if (e.key === 'Escape') cancelEditing();
        }}
      />

      {/* Existing retained attachments + new file pills */}
      {hasEditAttachments && (
        <div className="ctc-attachments">
          {editAttachments.map((att) => (
            <span key={att.attachmentId} className="ctc-attachment-pill ctc-attachment-pill--editable">
              <FiFile size={11} />
              {att.fileName}
              <button
                type="button"
                className="ctc-attachment-remove-btn"
                onClick={() => removeExistingAttachment(att.attachmentId)}
                title={`Remove ${att.fileName}`}
              >
                <FiX size={11} />
              </button>
            </span>
          ))}
          {editNewFiles.map((file, i) => (
            <span key={`new-${i}`} className="ctc-attachment-pill ctc-attachment-pill--new">
              <FiPaperclip size={11} />
              {file.name}
              <button
                type="button"
                className="ctc-attachment-remove-btn"
                onClick={() => removeNewFile(i)}
                title={`Remove ${file.name}`}
              >
                <FiX size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Hidden multi-file input for edit mode */}
      <input
        type="file"
        multiple
        ref={editFileInputRef}
        style={{ display: 'none' }}
        onChange={handleEditFileChange}
      />

      <div className="ctc-edit-actions">
        {/* Attach button at far left */}
        <button
          type="button"
          className="ctc-attach-btn"
          style={{ marginRight: 'auto' }}
          onClick={() => editFileInputRef.current?.click()}
          title="Attach files"
        >
          <FiPaperclip size={13} /> Attach
        </button>
        <button type="button" className="ctc-btn ctc-btn--ghost" onClick={cancelEditing}>
          Cancel
        </button>
        <button type="button" className="ctc-btn ctc-btn--primary" onClick={submitEdit}>
          Save
        </button>
      </div>
    </div>
  );

  return (
    <div className={`ctc-reply-item ${variant === 'embedded' ? 'ctc-reply-item--embedded' : ''}`}>
      {variant !== 'embedded' && <Avatar name={reply.authorName} size="small" />}
      <div className="ctc-reply-body">
        <div className="ctc-reply-header">
          {variant !== 'embedded' && (
            <div className="ctc-reply-meta">
              <span className="ctc-name">{reply.authorName ?? '👤 Deleted'}</span>
              <span className="ctc-time">{formatRelativeTime(reply.createdAt)}</span>
            </div>
          )}
          {reply.authorId && variant !== 'embedded' && (
            <div className="ctc-reply-actions">
              <button type="button" className="ctc-tiny-btn" onClick={startEditing} title="Edit">
                <FiEdit2 size={13} strokeWidth={1.5} />
              </button>
              <button type="button" className="ctc-tiny-btn ctc-tiny-btn--danger" onClick={onDelete} title="Delete reply">
                <FiTrash2 size={13} strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>
        {editing ? editArea : (
          <>
            <p className="ctc-reply-text">{reply.body}</p>
            {reply.attachments && reply.attachments.length > 0 && (
              <div className="ctc-attachments">
                {reply.attachments.map((att) => (
                  <a
                    key={att.attachmentId}
                    href={att.url}
                    download={att.fileName}
                    className="ctc-attachment-pill"
                    title={`Download ${att.fileName}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FiFile size={11} />
                    {att.fileName}
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


// ─── Main Card ────────────────────────────────────────────────────────────────

export function CommentThreadCard({
  editor,
  threads,
  activeIndex,
  fallbackAnchorRect = null,
  commentHandler,
  presentation = 'popover',
  onClose,
  onNavigate,
  onThreadUpdated,
  onThreadDeleted,
}: CommentThreadCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [replyBody, setReplyBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [externalEditNonce, setExternalEditNonce] = useState(0);
  /** true = show inline "Delete thread?" confirm row */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Multiple attachments for the reply composer
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
    e.target.value = '';
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const thread = threads[activeIndex] ?? null;

  const positioningParent = useMemo(
    () => findPositioningParent(editor.view.dom as HTMLElement),
    [editor],
  );

  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const parent = positioningParent;
    const computed = getComputedStyle(parent).position;
    const madeRelative = computed === 'static';
    if (madeRelative) {
      parent.style.position = 'relative';
    }
    return () => {
      if (madeRelative) {
        parent.style.position = '';
      }
    };
  }, [positioningParent]);

  const resolveNodeRect = useCallback((): DOMRect | null => {
    if (!thread) return null;
    if (thread.orphaned) {
      return fallbackAnchorRect;
    }
    return getAnchorRectForCommentId(editor, thread) ?? fallbackAnchorRect;
  }, [thread, editor, fallbackAnchorRect]);

  // Two-pass: measure card, then place to the right of the block (parent space).
  useEffect(() => {
    if (!thread) return;

    setVisible(false);

    const run = () => {
      if (!cardRef.current || !thread) return;
      const nodeRect = resolveNodeRect();
      if (!nodeRect || (nodeRect.width === 0 && nodeRect.height === 0)) {
        setVisible(true);
        return;
      }
      const cardW = cardRef.current.offsetWidth || 320;
      const cardH = cardRef.current.offsetHeight || 300;
      setPosition(
        computePlacementInParent(positioningParent, nodeRect, {
          elementWidth: cardW,
          elementHeight: cardH,
        }),
      );
      setVisible(true);
    };

    const raf = requestAnimationFrame(run);

    const onResize = () => run();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [thread, activeIndex, editor, positioningParent, resolveNodeRect]);

  useEffect(() => {
    setReplyBody('');
    setAttachedFiles([]);
  }, [activeIndex]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleResolve = useCallback(async () => {
    if (!thread) return;
    try {
      const updated = await commentHandler.resolveThread(thread.id);
      onThreadUpdated(updated);
    } catch (err) {
      console.error('[CommentThreadCard] resolveThread failed', err);
    }
  }, [thread, commentHandler, onThreadUpdated]);

  const handleUnresolve = useCallback(async () => {
    if (!thread) return;
    try {
      const updated = await commentHandler.unresolveThread(thread.id);
      onThreadUpdated(updated);
    } catch (err) {
      console.error('[CommentThreadCard] unresolveThread failed', err);
    }
  }, [thread, commentHandler, onThreadUpdated]);

  const handleDelete = useCallback(async () => {
    if (!thread) return;
    try {
      await commentHandler.deleteThread(thread.id);
      onThreadDeleted(thread.id);
    } catch (err) {
      console.error('[CommentThreadCard] deleteThread failed', err);
    }
  }, [thread, commentHandler, onThreadDeleted]);

  /** First click shows confirm row; second click (Confirm) actually deletes. */
  const handleDeleteWithConfirm = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true);
    } else {
      setConfirmDelete(false);
      handleDelete();
    }
  }, [confirmDelete, handleDelete]);

  const handleCopyLink = () => {
    const url = `${window.location.href}#comment-${thread?.commentId}`;
    navigator.clipboard.writeText(url).catch(() => {});
  };

  // Edit main is now inline via the ReplyItem in the PrimaryCommentBlock.

  const handleSubmitReply = async () => {
    if ((!replyBody.trim() && attachedFiles.length === 0) || !thread || isSubmitting) return;
    setIsSubmitting(true);
    try {
      let attachments: CommentReplyAttachment[] | undefined;
      if (attachedFiles.length > 0) {
        attachments = attachedFiles.map((file) => ({
          attachmentId: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          url: URL.createObjectURL(file),
        }));
      }
      const reply = await commentHandler.addReply(thread.id, replyBody.trim(), attachments);
      // If the handler mutates thread.replies in place (same ref as props), appending again duplicates.
      const alreadyPresent = thread.replies.some((r) => r.id === reply.id);
      const updated: CommentThread = {
        ...thread,
        replies: alreadyPresent ? [...thread.replies] : [...thread.replies, reply],
      };
      onThreadUpdated(updated);
      setReplyBody('');
      setAttachedFiles([]);
    } catch (err) {
      console.error('[CommentThreadCard] addReply failed', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteReply = async (replyId: string) => {
    if (!thread) return;
    try {
      await commentHandler.deleteReply(replyId);
      const updated: CommentThread = {
        ...thread,
        replies: thread.replies.filter((r) => r.id !== replyId),
      };
      onThreadUpdated(updated);
    } catch (err) {
      console.error('[CommentThreadCard] deleteReply failed', err);
    }
  };

  const handleEditReply = async (replyId: string, body: string, attachments: CommentReplyAttachment[]) => {
    if (!thread) return;
    try {
      const updated = await commentHandler.editReply(replyId, body, attachments);
      const updatedThread: CommentThread = {
        ...thread,
        replies: thread.replies.map((r) => (r.id === replyId ? updated : r)),
      };
      onThreadUpdated(updatedThread);
    } catch (err) {
      console.error('[CommentThreadCard] editReply failed', err);
    }
  };

  if (!thread) return null;

  const isResolved = !!thread.resolvedAt;
  const isOrphaned = !!thread.orphaned;

  const mainAuthor = thread.createdByName;
  const mainTime = thread.createdAt;
  const { opening: openingReply, followUps } = splitOpeningReply(thread);

  return createPortal(
    <>
      <div className="ctc-backdrop" onClick={onClose} />

      <div
        ref={cardRef}
        className={`ctc-card ${presentation === 'bottom-sheet' ? 'is-bottom-sheet' : ''} ${isResolved ? 'is-resolved' : ''} ${isOrphaned ? 'is-orphaned' : ''}`}
        style={{
          position: presentation === 'bottom-sheet' ? 'fixed' : 'absolute',
          top: presentation === 'bottom-sheet' ? 'auto' as const : position.top,
          left: presentation === 'bottom-sheet' ? '50%' : position.left,
          bottom: presentation === 'bottom-sheet' ? 0 : 'auto',
          transform: presentation === 'bottom-sheet' ? 'translateX(-50%)' : 'translate(0, -50%)',
          visibility: visible ? 'visible' : 'hidden',
          zIndex: 300,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="ctc-header">
          <div className="ctc-header-left">
            <span className="ctc-header-title">Comment thread</span>
            <span className="ctc-header-subtitle">
              1 thread · {thread.replies.length} comments
            </span>
          </div>
          <button className="ctc-close-btn" title="Close" onClick={onClose}>
            <FiX size={18} />
          </button>
        </div>

        {/* ── Thread body ── */}
        <div className="ctc-thread-body">
          <div className="primary-comment-block">
            <div className="primary-comment-header">
              <Avatar name={mainAuthor} />
              <div className="primary-comment-meta">
                <span className="ctc-name">{mainAuthor ?? '👤 Deleted'}</span>
                <span className="ctc-time">{formatRelativeTime(mainTime)}</span>
              </div>
              <div className="primary-comment-actions">
                {/* Inline delete confirmation */}
                {confirmDelete && (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--red-11)', whiteSpace: 'nowrap' }}>Delete thread?</span>
                    <button
                      className="primary-comment-action-btn primary-comment-action-btn--danger"
                      title="Confirm delete"
                      onClick={handleDeleteWithConfirm}
                    >
                      <FiTrash2 size={14} />
                    </button>
                    <button
                      className="primary-comment-action-btn"
                      title="Cancel"
                      onClick={() => setConfirmDelete(false)}
                    >
                      <FiX size={14} />
                    </button>
                  </>
                )}
                {!confirmDelete && !isResolved && !isOrphaned && (
                  <button
                    className="primary-comment-action-btn"
                    title="Resolve"
                    onClick={handleResolve}
                  >
                    <FiCheckCircle size={14} />
                  </button>
                )}
                {!confirmDelete && isResolved && (
                  <button
                    className="primary-comment-action-btn"
                    title="Unresolve"
                    onClick={handleUnresolve}
                  >
                    <FiRotateCcw size={14} />
                  </button>
                )}
                {/* Edit for main thread — hidden while confirm is showing */}
                {!confirmDelete && openingReply && !isResolved && !isOrphaned && (
                  <button
                    className="primary-comment-action-btn"
                    title="Edit"
                    onClick={() => setExternalEditNonce((n) => n + 1)}
                  >
                    <FiEdit2 size={16} />
                  </button>
                )}
                {/* Thread-level delete — first click shows confirm row */}
                {!confirmDelete && (
                  <button
                    className="primary-comment-action-btn primary-comment-action-btn--danger"
                    title="Delete thread"
                    onClick={handleDeleteWithConfirm}
                  >
                    <FiTrash2 size={16} />
                  </button>
                )}
              </div>

            </div>

            {isOrphaned ? (
              <p className="ctc-orphaned">The commented text was deleted.</p>
            ) : (
              <div className="primary-comment-quote">
                "{thread.anchor?.quotedText || (thread as any).quotedText || 'Unknown text'}"
              </div>
            )}

            {openingReply && (
              <ReplyItem
                key={openingReply.id}
                reply={openingReply}
                variant="embedded"
                externalEditNonce={externalEditNonce}
                onEdit={(body, attachments) => handleEditReply(openingReply.id, body, attachments)}
                onDelete={() => handleDeleteReply(openingReply.id)}
              />
            )}
          </div>

          {followUps.length > 0 && (
            <div className="ctc-discussion-section">
              <div className="ctc-discussion-header">
                Discussion
              </div>
              <div className="ctc-replies-list">
                <div className="ctc-discussion-dot" />
                <div className="ctc-threading-line" />
                {followUps.map((reply) => (
                  <ReplyItem
                    key={reply.id}
                    reply={reply}
                    onEdit={(body, attachments) => handleEditReply(reply.id, body, attachments)}
                    onDelete={() => handleDeleteReply(reply.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Reply composer ── */}
        {!isResolved && (
          <div className="ctc-reply-composer">
            <div className="ctc-reply-composer-label">Reply to thread</div>
            <textarea
              className="ctc-reply-textarea"
              placeholder="Write a reply..."
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              disabled={isSubmitting}
              rows={3}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmitReply();
                if (e.key === 'Escape') onClose();
              }}
            />
            <div className="ctc-reply-composer-actions">
              <input
                type="file"
                multiple
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                className="ctc-attach-btn"
                type="button"
                onClick={handleAttachClick}
              >
                <FiPaperclip size={14} /> Attach
              </button>
              <button
                className="ctc-send-btn"
                onClick={handleSubmitReply}
                disabled={(!replyBody.trim() && attachedFiles.length === 0) || isSubmitting}
                title="Send (Cmd+Enter)"
              >
                <FiCornerDownLeft size={14} /> Reply
              </button>
            </div>
            {/* File pills with individual remove buttons */}
            {attachedFiles.length > 0 && (
              <div className="ctc-attachments" style={{ marginTop: 8 }}>
                {attachedFiles.map((file, i) => (
                  <span key={`${file.name}-${i}`} className="ctc-attachment-pill ctc-attachment-pill--editable">
                    <FiPaperclip size={11} />
                    {file.name}
                    <button
                      type="button"
                      className="ctc-attachment-remove-btn"
                      onClick={() => handleRemoveFile(i)}
                      title={`Remove ${file.name}`}
                    >
                      <FiX size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>,
    positioningParent,
  );
}
