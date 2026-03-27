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
import type { CommentAPIHandler, CommentThread, CommentReply } from '../types';
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

function Avatar({ name, size = 36 }: { name: string | null; size?: number }) {
  return (
    <div
      className="ctc-avatar"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      title={name ?? 'Deleted user'}
    >
      {getInitials(name)}
    </div>
  );
}

// ─── Kebab Menu ───────────────────────────────────────────────────────────────

interface KebabMenuProps {
  /** When omitted, the Edit item is hidden (e.g. no opening message to edit from menu). */
  onEdit?: (() => void) | null;
  onDelete: () => void;
  onCopyLink: () => void;
}

function KebabMenu({ onEdit, onDelete, onCopyLink }: KebabMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="ctc-kebab-wrapper" ref={ref}>
      <button
        className={`ctc-action-btn ${open ? 'is-active' : ''}`}
        title="More options"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ctc-dots">•••</span>
      </button>
      {open && (
        <div className="ctc-kebab-menu">
          <button className="ctc-menu-item" onClick={() => { onCopyLink(); setOpen(false); }}>
            Copy link
          </button>
          {onEdit && (
            <button className="ctc-menu-item" onClick={() => { onEdit(); setOpen(false); }}>
              Edit
            </button>
          )}
          <button className="ctc-menu-item ctc-menu-item--danger" onClick={() => { onDelete(); setOpen(false); }}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Reply Item ───────────────────────────────────────────────────────────────

interface ReplyItemProps {
  reply: CommentReply;
  onEdit: (body: string) => void;
  onDelete: () => void;
  /** Opening message: no second avatar row; sits under the thread quote. */
  variant?: 'default' | 'embedded';
  /** Increment (e.g. from kebab Edit) to open the embedded editor. */
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

  useEffect(() => {
    setEditBody(reply.body);
  }, [reply.body]);

  useEffect(() => {
    if (variant !== 'embedded' || !externalEditNonce) return;
    if (externalEditNonce > prevExternalEdit.current) {
      prevExternalEdit.current = externalEditNonce;
      setEditing(true);
    }
  }, [externalEditNonce, variant]);

  const submitEdit = () => {
    if (!editBody.trim()) return;
    onEdit(editBody.trim());
    setEditing(false);
  };

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
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <div className="ctc-edit-actions">
        <button type="button" className="ctc-btn ctc-btn--ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button type="button" className="ctc-btn ctc-btn--primary" onClick={submitEdit}>
          Save
        </button>
      </div>
    </div>
  );

  if (variant === 'embedded') {
    return (
      <div className="ctc-reply-item ctc-reply-item--embedded">
        <div className="ctc-reply-body ctc-reply-body--embedded">
          {editing ? (
            editArea
          ) : (
            <>
              <p className="ctc-reply-text ctc-reply-text--embedded">{reply.body}</p>
              {reply.authorId && (
                <div className="ctc-reply-actions ctc-reply-actions--embedded">
                  <button type="button" className="ctc-tiny-btn" onClick={() => setEditing(true)} title="Edit">
                    ✎
                  </button>
                  <button type="button" className="ctc-tiny-btn ctc-tiny-btn--danger" onClick={onDelete} title="Delete">
                    ✕
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ctc-reply-item">
      <Avatar name={reply.authorName} size={28} />
      <div className="ctc-reply-body">
        <div className="ctc-reply-header">
          <span className="ctc-name">{reply.authorName ?? '👤 Deleted'}</span>
          <span className="ctc-time">{formatRelativeTime(reply.createdAt)}</span>
          {reply.authorId && (
            <div className="ctc-reply-actions">
              <button type="button" className="ctc-tiny-btn" onClick={() => setEditing(true)} title="Edit">
                ✎
              </button>
              <button type="button" className="ctc-tiny-btn ctc-tiny-btn--danger" onClick={onDelete} title="Delete">
                ✕
              </button>
            </div>
          )}
        </div>
        {editing ? editArea : <p className="ctc-reply-text">{reply.body}</p>}
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
  onClose,
  onNavigate,
  onThreadUpdated,
  onThreadDeleted,
}: CommentThreadCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [replyBody, setReplyBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [openingEditNonce, setOpeningEditNonce] = useState(0);

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
    return getAnchorRectForCommentId(editor, thread.commentId) ?? fallbackAnchorRect;
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
    setOpeningEditNonce(0);
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

  const handleDelete = useCallback(async () => {
    if (!thread) return;
    try {
      await commentHandler.deleteThread(thread.id);
      onThreadDeleted(thread.id);
    } catch (err) {
      console.error('[CommentThreadCard] deleteThread failed', err);
    }
  }, [thread, commentHandler, onThreadDeleted]);

  const handleCopyLink = () => {
    const url = `${window.location.href}#comment-${thread?.commentId}`;
    navigator.clipboard.writeText(url).catch(() => {});
  };

  const handleEditMain = () => {
    if (!thread) return;
    const { opening } = splitOpeningReply(thread);
    if (opening) setOpeningEditNonce((n) => n + 1);
  };

  const handleSubmitReply = async () => {
    if (!replyBody.trim() || !thread || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const reply = await commentHandler.addReply(thread.id, replyBody.trim());
      // If the handler mutates thread.replies in place (same ref as props), appending again duplicates.
      const alreadyPresent = thread.replies.some((r) => r.id === reply.id);
      const updated: CommentThread = {
        ...thread,
        replies: alreadyPresent ? [...thread.replies] : [...thread.replies, reply],
      };
      onThreadUpdated(updated);
      setReplyBody('');
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

  const handleEditReply = async (replyId: string, body: string) => {
    if (!thread) return;
    try {
      const updated = await commentHandler.editReply(replyId, body);
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
        className={`ctc-card ${isResolved ? 'is-resolved' : ''} ${isOrphaned ? 'is-orphaned' : ''}`}
        style={{
          position: 'absolute',
          top: position.top,
          left: position.left,
          transform: 'translate(0, -50%)',
          visibility: visible ? 'visible' : 'hidden',
          zIndex: 300,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Top navigation bar ── */}
        <div className="ctc-nav-bar">
          <div className="ctc-nav-arrows">
            <button
              className="ctc-nav-btn"
              title="Previous comment"
              disabled={activeIndex === 0}
              onClick={() => onNavigate(activeIndex - 1)}
            >
              ∧
            </button>
            <button
              className="ctc-nav-btn"
              title="Next comment"
              disabled={activeIndex === threads.length - 1}
              onClick={() => onNavigate(activeIndex + 1)}
            >
              ∨
            </button>
          </div>
          <div className="ctc-nav-right">
            {/* Panel icon (decorative) */}
            <button className="ctc-nav-icon-btn" title="View in panel">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="6" y1="1" x2="6" y2="15" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </button>
            <button className="ctc-nav-icon-btn ctc-close-btn" title="Close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* ── Thread body ── */}
        <div className="ctc-thread-body">
          {/* Author row */}
          <div className="ctc-author-row">
            <Avatar name={mainAuthor} size={36} />
            <div className="ctc-author-info">
              <span className="ctc-name">{mainAuthor ?? '👤 Deleted'}</span>
              <span className="ctc-time">{formatRelativeTime(mainTime)}</span>
            </div>
            {/* Action buttons shown on hover of author row */}
            <div className="ctc-thread-actions">
              <button className="ctc-action-btn" title="Add reaction">☺</button>
              {!isResolved && (
                <button className="ctc-action-btn ctc-resolve-btn" title="Resolve comment thread" onClick={handleResolve}>
                  ✓
                </button>
              )}
              {isResolved && <span className="ctc-resolved-chip">✓ Resolved</span>}
              <KebabMenu
                onEdit={openingReply ? handleEditMain : undefined}
                onDelete={handleDelete}
                onCopyLink={handleCopyLink}
              />
            </div>
          </div>

          {/* Quoted text context */}
          {isOrphaned ? (
            <p className="ctc-orphaned">⚠ The commented text was deleted</p>
          ) : (
            <blockquote className="ctc-quote">"{thread.quotedText}"</blockquote>
          )}

          {openingReply && (
            <ReplyItem
              key={openingReply.id}
              reply={openingReply}
              variant="embedded"
              externalEditNonce={openingEditNonce}
              onEdit={(body) => handleEditReply(openingReply.id, body)}
              onDelete={() => handleDeleteReply(openingReply.id)}
            />
          )}

          {followUps.length > 0 && (
            <div className="ctc-replies-list">
              {followUps.map((r) => (
                <ReplyItem
                  key={r.id}
                  reply={r}
                  onEdit={(body) => handleEditReply(r.id, body)}
                  onDelete={() => handleDeleteReply(r.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Reply input ── */}
        {!isResolved && (
          <div className="ctc-reply-bar">
            <input
              className="ctc-reply-field"
              placeholder="Reply…"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              disabled={isSubmitting}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmitReply();
                if (e.key === 'Escape') onClose();
              }}
            />
            {replyBody.trim() && (
              <button
                className="ctc-send-btn"
                onClick={handleSubmitReply}
                disabled={isSubmitting}
                title="Send (Cmd+Enter)"
              >
                →
              </button>
            )}
          </div>
        )}
      </div>
    </>,
    positioningParent,
  );
}
