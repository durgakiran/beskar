/**
 * CommentSidePanel
 *
 * Right-side panel showing all comment threads for a document.
 * Opens when a comment highlight span is clicked.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/core';
import { FiX, FiCheck, FiTrash2, FiSend, FiUser, FiMessageSquare } from 'react-icons/fi';
import type { CommentAPIHandler, CommentThread, CommentReply } from '../types';
import { commentDecorationKey } from '../extensions/comment-decoration';
import './CommentSidePanel.css';

export interface CommentSidePanelProps {
  editor: Editor;
  commentHandler: CommentAPIHandler;
  documentId: string;
  threads: CommentThread[];
  isOpen: boolean;
  activeThreadId?: string | null;
  onClose: () => void;
  onThreadUpdated: (thread: CommentThread) => void;
  onThreadDeleted: (threadId: string) => void;
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getInitials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ name }: { name: string | null }) {
  return (
    <div className="csp-avatar" title={name ?? 'Deleted user'}>
      {name ? getInitials(name) : <FiUser size={12} />}
    </div>
  );
}

interface ReplyItemProps {
  reply: CommentReply;
  onDelete: (replyId: string) => void;
  onEdit: (replyId: string, newBody: string) => void;
}

function ReplyItem({ reply, onDelete, onEdit }: ReplyItemProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(reply.body);

  const submitEdit = () => {
    if (!editBody.trim()) return;
    onEdit(reply.id, editBody.trim());
    setEditing(false);
  };

  return (
    <div className="csp-reply">
      <Avatar name={reply.authorName} />
      <div className="csp-reply-content">
        <div className="csp-reply-header">
          <span className="csp-author">{reply.authorName ?? '👤 Deleted User'}</span>
          <span className="csp-ts">{formatRelativeTime(reply.createdAt)}</span>
          {reply.authorId && (
            <div className="csp-reply-actions">
              <button className="csp-icon-btn" title="Edit" onClick={() => setEditing(true)}>✎</button>
              <button className="csp-icon-btn csp-icon-btn--danger" title="Delete" onClick={() => onDelete(reply.id)}>
                <FiTrash2 size={12} />
              </button>
            </div>
          )}
        </div>
        {editing ? (
          <div className="csp-reply-edit">
            <textarea
              className="csp-textarea"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={2}
              autoFocus
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <div className="csp-reply-edit-actions">
              <button className="csp-btn csp-btn--ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button className="csp-btn csp-btn--primary" onClick={submitEdit}>Save</button>
            </div>
          </div>
        ) : (
          <p className="csp-reply-body">{reply.body}</p>
        )}
      </div>
    </div>
  );
}

interface ThreadCardProps {
  thread: CommentThread;
  isActive: boolean;
  onResolve: (threadId: string) => void;
  onUnresolve: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onAddReply: (threadId: string, body: string) => void;
  onDeleteReply: (threadId: string, replyId: string) => void;
  onEditReply: (replyId: string, newBody: string) => void;
}

function ThreadCard({
  thread,
  isActive,
  onResolve,
  onUnresolve,
  onDelete,
  onAddReply,
  onDeleteReply,
  onEditReply,
}: ThreadCardProps) {
  const [replyBody, setReplyBody] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Scroll into view when active
  useEffect(() => {
    if (isActive && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  const submitReply = async () => {
    if (!replyBody.trim() || isSubmittingReply) return;
    setIsSubmittingReply(true);
    await onAddReply(thread.id, replyBody.trim());
    setReplyBody('');
    setIsSubmittingReply(false);
  };

  const isResolved = !!thread.resolvedAt;
  const isOrphaned = !!thread.orphaned;

  return (
    <div
      ref={cardRef}
      className={`csp-thread-card ${isActive ? 'is-active' : ''} ${isResolved ? 'is-resolved' : ''} ${isOrphaned ? 'is-orphaned' : ''}`}
      data-thread-id={thread.id}
    >
      {/* Thread header */}
      <div className="csp-thread-header">
        <Avatar name={thread.createdByName} />
        <div className="csp-thread-meta">
          <span className="csp-author">{thread.createdByName ?? '👤 Deleted User'}</span>
          <span className="csp-ts">{formatRelativeTime(thread.createdAt)}</span>
        </div>
        <div className="csp-thread-actions">
          {!isResolved && !isOrphaned && (
            <button
              className="csp-icon-btn csp-icon-btn--resolve"
              title="Resolve thread"
              onClick={() => onResolve(thread.id)}
            >
              <FiCheck size={14} />
            </button>
          )}
          {isResolved && !isOrphaned && (
            <button
              className="csp-icon-btn csp-icon-btn--unresolve"
              title="Unresolve thread"
              onClick={() => onUnresolve(thread.id)}
            >
              ↩
            </button>
          )}
          <button
            className="csp-icon-btn csp-icon-btn--danger"
            title="Delete thread"
            onClick={() => onDelete(thread.id)}
          >
            <FiTrash2 size={14} />
          </button>
        </div>
      </div>

      {/* Quoted text or orphaned badge */}
      {isOrphaned ? (
        <p className="csp-orphaned-badge">⚠ Text was deleted</p>
      ) : (
        <blockquote className="csp-quoted-text">
          "{thread.anchor?.quotedText || (thread as any).quotedText || 'Unknown text'}"
        </blockquote>
      )}

      {/* Resolved badge */}
      {isResolved && (
        <span className="csp-resolved-badge">✓ Resolved</span>
      )}

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div className="csp-replies">
          {thread.replies.map((r) => (
            <ReplyItem
              key={r.id}
              reply={r}
              onDelete={(rid) => onDeleteReply(thread.id, rid)}
              onEdit={onEditReply}
            />
          ))}
        </div>
      )}

      {/* Reply input */}
      {!isResolved && (
        <div className="csp-reply-input">
          <textarea
            className="csp-textarea"
            placeholder="Reply…"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={1}
            disabled={isSubmittingReply}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitReply();
            }}
          />
          <button
            className="csp-send-btn"
            disabled={!replyBody.trim() || isSubmittingReply}
            onClick={submitReply}
            title="Send reply (Cmd+Enter)"
          >
            <FiSend size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function CommentSidePanel({
  editor,
  threads,
  commentHandler,
  isOpen,
  activeThreadId,
  onClose,
  onThreadUpdated,
  onThreadDeleted,
}: CommentSidePanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(false);

  // Sync decorations with the editor plugin
  useEffect(() => {
    if (isOpen) {
      editor.view.dispatch(editor.state.tr.setMeta(commentDecorationKey, { threads, activeThreadId }));
    }
  }, [editor, threads, activeThreadId, isOpen]);

  // Handle resolve
  const handleResolve = async (threadId: string) => {
    try {
      const updated = await commentHandler.resolveThread(threadId);
      onThreadUpdated(updated);
    } catch (err) {
      console.error('[CommentSidePanel] resolveThread failed', err);
    }
  };

  // Handle unresolve
  const handleUnresolve = async (threadId: string) => {
    try {
      const updated = await commentHandler.unresolveThread(threadId);
      onThreadUpdated(updated);
    } catch (err) {
      console.error('[CommentSidePanel] unresolveThread failed', err);
    }
  };

  // Handle delete thread
  const handleDeleteThread = async (threadId: string) => {
    try {
      await commentHandler.deleteThread(threadId);
      onThreadDeleted(threadId);
    } catch (err) {
      console.error('[CommentSidePanel] deleteThread failed', err);
    }
  };

  // Handle add reply
  const handleAddReply = async (threadId: string, body: string) => {
    try {
      const reply = await commentHandler.addReply(threadId, body);
      const thread = threads.find((t) => t.id === threadId);
      if (thread) {
        onThreadUpdated({ ...thread, replies: [...thread.replies, reply] });
      }
    } catch (err) {
      console.error('[CommentSidePanel] addReply failed', err);
    }
  };

  // Handle delete reply
  const handleDeleteReply = async (threadId: string, replyId: string) => {
    try {
      await commentHandler.deleteReply(replyId);
      const thread = threads.find((t) => t.id === threadId);
      if (thread) {
        onThreadUpdated({ ...thread, replies: thread.replies.filter((r) => r.id !== replyId) });
      }
    } catch (err) {
      console.error('[CommentSidePanel] deleteReply failed', err);
    }
  };

  // Handle edit reply
  const handleEditReply = async (replyId: string, newBody: string) => {
    try {
      const updated = await commentHandler.editReply(replyId, newBody);
      // We need to find the thread that contains this reply to create the updated payload
      const thread = threads.find((t) => t.replies.some((r) => r.id === replyId));
      if (thread) {
        onThreadUpdated({
          ...thread,
          replies: thread.replies.map((r) => (r.id === replyId ? updated : r))
        });
      }
    } catch (err) {
      console.error('[CommentSidePanel] editReply failed', err);
    }
  };

  const isEditable = editor.isEditable;

  // Filter threads based on visibility policy:
  // - In edit mode (isEditable === true), show all threads.
  // - In view mode (isEditable === false), show only publishedVisible === true threads.
  const filteredThreads = threads.filter((t) => {
    if (isEditable) return true;
    return t.publishedVisible === true;
  });

  const activeThreads = filteredThreads.filter((t) => !t.orphaned && (showResolved || !t.resolvedAt || t.id === activeThreadId));
  const orphanedThreads = filteredThreads.filter((t) => t.orphaned);

  const visibleThreads = [...activeThreads, ...orphanedThreads];

  return (
    <div className={`csp-container ${isOpen ? 'is-open' : ''}`}>
      {/* Header */}
      <div className="csp-header">
        <h3 className="csp-title">
          <FiMessageSquare size={16} />
          Comments
          {threads.length > 0 && (
            <span className="csp-count">{threads.filter((t) => !t.resolvedAt).length}</span>
          )}
        </h3>
        <div className="csp-header-actions">
          <label className="csp-toggle-label">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show resolved
          </label>
          <button className="csp-icon-btn" onClick={onClose} title="Close">
            <FiX size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="csp-body">
        {loading ? (
          <div className="csp-loading">Loading comments…</div>
        ) : visibleThreads.length === 0 ? (
          <div className="csp-empty">
            <FiMessageSquare size={32} className="csp-empty-icon" />
            <p>No comments yet.</p>
            <p className="csp-empty-hint">Select text and click 💬 to add one.</p>
          </div>
        ) : (
          visibleThreads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              onResolve={handleResolve}
              onUnresolve={handleUnresolve}
              onDelete={handleDeleteThread}
              onAddReply={handleAddReply}
              onDeleteReply={handleDeleteReply}
              onEditReply={handleEditReply}
            />
          ))
        )}
      </div>
    </div>
  );
}
