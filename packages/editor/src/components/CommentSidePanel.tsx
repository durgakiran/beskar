/**
 * CommentSidePanel
 *
 * Right-side panel showing all comment threads for a document.
 * Opens when a comment highlight span is clicked.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/core';
import { FiArrowLeft, FiCheck, FiCheckCircle, FiCornerDownLeft, FiEdit2, FiFile, FiMessageSquare, FiPaperclip, FiRotateCcw, FiSend, FiTrash2, FiUser, FiX } from 'react-icons/fi';
import type { CommentAPIHandler, CommentThread, CommentReply, CommentReplyAttachment } from '../types';
import { commentDecorationKey } from '../extensions/comment-decoration';
import './CommentSidePanel.css';

export interface CommentSidePanelProps {
  editor: Editor;
  commentHandler: CommentAPIHandler;
  documentId: string;
  threads: CommentThread[];
  isOpen: boolean;
  presentation?: 'docked' | 'bottom-sheet';
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
      {name ? getInitials(name) : '👤'}
    </div>
  );
}

function getQuotedText(thread: CommentThread): string {
  return thread.anchor?.quotedText || (thread as any).quotedText || 'Unknown text';
}

function getThreadPreview(thread: CommentThread): string {
  const latestReply = thread.replies[thread.replies.length - 1];
  if (latestReply?.body?.trim()) return latestReply.body.trim();
  return 'Open thread';
}

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

interface ReplyItemProps {
  reply: CommentReply;
  readonlyMode?: boolean;
  onDelete: (replyId: string) => void;
  onEdit: (replyId: string, newBody: string) => void;
}

function ReplyItem({ reply, readonlyMode = false, onDelete, onEdit }: ReplyItemProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(reply.body);

  const submitEdit = () => {
    if (!editBody.trim()) return;
    onEdit(reply.id, editBody.trim());
    setEditing(false);
  };

  const hasAttachments = !!(reply.attachments && reply.attachments.length > 0);

  return (
    <div className="csp-reply">
      <Avatar name={reply.authorName} />
      <div className="csp-reply-content">
        <div className="csp-reply-header">
          <span className="csp-author">{reply.authorName ?? '👤 Deleted User'}</span>
          <span className="csp-ts">{formatRelativeTime(reply.createdAt)}</span>
          {!readonlyMode && reply.authorId && (
            <div className="csp-reply-actions">
              <button className="csp-icon-btn" title="Edit" onClick={() => setEditing(true)}>
                <FiEdit2 size={12} />
              </button>
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
          <>
            <p className="csp-reply-body">{reply.body}</p>
            {hasAttachments && (
              <div className="csp-attachments">
                {reply.attachments!.map((att) => (
                  <a
                    key={att.attachmentId}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="csp-attachment-pill"
                    title={`${att.fileName} (${(att.fileSize / 1024).toFixed(1)} KB)`}
                  >
                    <FiFile size={12} />
                    <span>{att.fileName}</span>
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

interface ThreadCardProps {
  thread: CommentThread;
  isActive: boolean;
  isReadOnly: boolean;
  onOpenThread?: (threadId: string) => void;
  onResolve: (threadId: string) => void;
  onUnresolve: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onAddReply: (threadId: string, body: string, attachments?: CommentReplyAttachment[]) => void;
  onDeleteReply: (threadId: string, replyId: string) => void;
  onEditReply: (replyId: string, newBody: string) => void;
}

function ThreadCard({
  thread,
  isActive,
  isReadOnly,
  onOpenThread,
  onResolve,
  onUnresolve,
  onDelete,
  onAddReply,
  onDeleteReply,
  onEditReply,
}: ThreadCardProps) {
  const [replyBody, setReplyBody] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<CommentReplyAttachment[]>([]);
  const cardRef = useRef<HTMLElement | null>(null);

  // Scroll into view when active
  useEffect(() => {
    if (isActive && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  const submitReply = async () => {
    if ((!replyBody.trim() && pendingAttachments.length === 0) || isSubmittingReply) return;
    setIsSubmittingReply(true);
    await onAddReply(thread.id, replyBody.trim(), pendingAttachments);
    setReplyBody('');
    setPendingAttachments([]);
    setIsSubmittingReply(false);
  };

  const handleMockAttach = () => {
    const mockAtt: CommentReplyAttachment = {
      attachmentId: crypto.randomUUID(),
      fileName: 'analysis-report.pdf',
      fileSize: 1024 * 1250,
      mimeType: 'application/pdf',
      url: '#',
    };
    setPendingAttachments((prev) => [...prev, mockAtt]);
  };

  const isResolved = !!thread.resolvedAt;
  const isOrphaned = !!thread.orphaned;
  const quotedText = getQuotedText(thread);
  const { opening } = splitOpeningReply(thread);
  const rootBody = opening?.body?.trim() || getThreadPreview(thread);

  if (isReadOnly) {
    return (
      <div
        ref={(node) => {
          cardRef.current = node;
        }}
        className={`csp-thread-card csp-thread-card--list ${isActive ? 'is-active' : ''} ${isResolved ? 'is-resolved' : ''}`}
        data-thread-id={thread.id}
      >
        <div className="primary-comment-block">
          <div className="primary-comment-header">
            <Avatar name={thread.createdByName} />
            <div className="csp-thread-meta">
              <span className="csp-author">{thread.createdByName ?? 'Deleted user'}</span>
              <span className="csp-ts">{formatRelativeTime((opening ?? thread).createdAt)}</span>
            </div>
            <div className="primary-comment-actions">
              {!isResolved && !isOrphaned ? (
                <button
                  type="button"
                  className="primary-comment-action-btn"
                  title="Resolve thread"
                  onClick={(event) => {
                    event.stopPropagation();
                    onResolve(thread.id);
                  }}
                >
                  <FiCheckCircle size={14} />
                </button>
              ) : null}
              {isResolved && !isOrphaned ? (
                <button
                  type="button"
                  className="primary-comment-action-btn"
                  title="Unresolve thread"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUnresolve(thread.id);
                  }}
                >
                  <FiRotateCcw size={14} />
                </button>
              ) : null}
              <button
                type="button"
                className="primary-comment-action-btn primary-comment-action-btn--danger"
                title="Delete thread"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(thread.id);
                }}
              >
                <FiTrash2 size={14} />
              </button>
            </div>
          </div>
          <div className="primary-comment-quote">"{quotedText}"</div>
          <p className="primary-comment-body">{rootBody}</p>
        </div>
        {!isActive && onOpenThread && (
          <button className="csp-view-thread-btn" onClick={() => onOpenThread(thread.id)}>
            <FiMessageSquare size={13} /> View thread
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={(node) => {
        cardRef.current = node;
      }}
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
          "{quotedText}"
        </blockquote>
      )}

      {/* Resolved badge */}
      {isResolved && (
        <span className="csp-resolved-badge">✓ Resolved</span>
      )}

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div className="csp-replies-wrap">
          {isReadOnly && <div className="csp-section-label">Discussion</div>}
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
        </div>
      )}

      {/* Reply input */}
      {!isResolved && (
        <div className={`csp-reply-composer ${isReadOnly ? 'is-readonly' : ''}`}>
          {isReadOnly && <div className="csp-section-label">Reply to thread</div>}
          <div className="csp-reply-input">
            <textarea
              className="csp-textarea"
              placeholder="Write a reply..."
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
              disabled={(!replyBody.trim() && pendingAttachments.length === 0) || isSubmittingReply}
              onClick={submitReply}
              title="Send reply (Cmd+Enter)"
            >
              <FiSend size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ThreadDetailProps {
  thread: CommentThread;
  isEditable: boolean;
  onBack: () => void;
  onClose: () => void;
  onResolve: (threadId: string) => void;
  onUnresolve: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onAddReply: (threadId: string, body: string, attachments?: CommentReplyAttachment[]) => void;
  onDeleteReply: (threadId: string, replyId: string) => void;
  onEditReply: (replyId: string, newBody: string) => void;
}

function ThreadDetail({
  thread,
  isEditable,
  onBack,
  onClose,
  onResolve,
  onUnresolve,
  onDeleteThread,
  onAddReply,
  onDeleteReply,
  onEditReply,
}: ThreadDetailProps) {
  const [replyBody, setReplyBody] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<CommentReplyAttachment[]>([]);
  const { opening, followUps } = splitOpeningReply(thread);

  const submitReply = async () => {
    if ((!replyBody.trim() && pendingAttachments.length === 0) || isSubmittingReply) return;
    setIsSubmittingReply(true);
    await onAddReply(thread.id, replyBody.trim(), pendingAttachments);
    setReplyBody('');
    setPendingAttachments([]);
    setIsSubmittingReply(false);
  };

  const handleMockAttach = () => {
    const mockAtt: CommentReplyAttachment = {
      attachmentId: crypto.randomUUID(),
      fileName: 'analysis-report.pdf',
      fileSize: 1024 * 1250,
      mimeType: 'application/pdf',
      url: '#',
    };
    setPendingAttachments((prev) => [...prev, mockAtt]);
  };

  const isResolved = !!thread.resolvedAt;

  return (
    <>
      <div className="csp-header">
        <div className="csp-title-block">
          <h3 className="csp-title">Thread</h3>
          <div className="csp-subtitle">
            1 thread · {thread.replies.length} comments
          </div>
        </div>
        <div className="csp-header-actions">
          <button type="button" className="csp-back-chip" onClick={onBack}>
            <FiArrowLeft size={14} />
            All threads
          </button>
          <button className="csp-icon-btn csp-icon-btn--close" onClick={onClose} title="Close">
            <FiX size={16} />
          </button>
        </div>
      </div>

      <div className="csp-body csp-body--thread">
        <div className="primary-comment-block">
          <div className="primary-comment-header">
            <Avatar name={thread.createdByName} />
            <div className="primary-comment-meta">
              <span className="csp-author">{thread.createdByName ?? 'Deleted user'}</span>
              <span className="csp-ts">{formatRelativeTime((opening ?? thread).createdAt)}</span>
            </div>
            <div className="primary-comment-actions">
              {!isResolved && (
                <button className="primary-comment-action-btn" title="Resolve" onClick={() => onResolve(thread.id)}>
                  <FiCheckCircle size={14} />
                </button>
              )}
              {isResolved && (
                <button className="primary-comment-action-btn" title="Unresolve" onClick={() => onUnresolve(thread.id)}>
                  <FiRotateCcw size={14} />
                </button>
              )}
              <button className="primary-comment-action-btn primary-comment-action-btn--danger" title="Delete" onClick={() => onDeleteThread(thread.id)}>
                <FiTrash2 size={14} />
              </button>
            </div>
          </div>
          <div className="primary-comment-quote">"{getQuotedText(thread)}"</div>
          <p className="primary-comment-body">{opening?.body?.trim() || getThreadPreview(thread)}</p>
        </div>

        <div className="csp-discussion-header">
          <FiMessageSquare size={13} />
          <span>Discussion</span>
        </div>

        <div className="csp-replies">
          {followUps.map((reply) => (
            <ReplyItem
              key={reply.id}
              reply={reply}
              readonlyMode={!isEditable}
              onDelete={(replyId) => onDeleteReply(thread.id, replyId)}
              onEdit={onEditReply}
            />
          ))}
        </div>

        {!isResolved && (
          <div className="csp-reply-composer">
            <div className="csp-reply-composer-label">Reply to thread</div>
            <textarea
              className="csp-textarea"
              placeholder="Write a reply..."
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={3}
              disabled={isSubmittingReply}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitReply();
              }}
            />
            {pendingAttachments.length > 0 && (
              <div className="csp-attachments" style={{ marginBottom: 8, padding: '0 4px' }}>
                {pendingAttachments.map((att) => (
                  <div key={att.attachmentId} className="csp-attachment-pill">
                    <FiFile size={12} />
                    <span>{att.fileName}</span>
                    <button
                      type="button"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 0 0 4px', color: 'var(--gray-9)' }}
                      onClick={() => setPendingAttachments(prev => prev.filter(a => a.attachmentId !== att.attachmentId))}
                    >
                      <FiX size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="csp-reply-composer-actions">
              <button className="csp-attach-btn" type="button" onClick={handleMockAttach}>
                <FiPaperclip size={14} /> Attach
              </button>
              <button
                className="csp-send-btn"
                disabled={(!replyBody.trim() && pendingAttachments.length === 0) || isSubmittingReply}
                onClick={submitReply}
                title="Send (Cmd+Enter)"
              >
                <FiCornerDownLeft size={14} /> Reply
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function CommentSidePanel({
  editor,
  threads,
  commentHandler,
  isOpen,
  presentation = 'docked',
  activeThreadId,
  onClose,
  onThreadUpdated,
  onThreadDeleted,
}: CommentSidePanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(activeThreadId ?? null);
  const isEditable = editor.isEditable;
  const highlightedThreadId = selectedThreadId ?? activeThreadId ?? null;

  // Sync decorations with the editor plugin
  useEffect(() => {
    if (isOpen) {
      editor.view.dispatch(editor.state.tr.setMeta(commentDecorationKey, { threads, activeThreadId: highlightedThreadId }));
    }
  }, [editor, threads, highlightedThreadId, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedThreadId(activeThreadId ?? null);
      return;
    }
    if (!isEditable) {
      setSelectedThreadId(activeThreadId ?? null);
    }
  }, [activeThreadId, isEditable, isOpen]);

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
  const handleAddReply = async (threadId: string, body: string, attachments?: CommentReplyAttachment[]) => {
    try {
      const reply = await commentHandler.addReply(threadId, body, attachments);
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

  // Filter threads based on visibility policy:
  // - In edit mode (isEditable === true), show all threads.
  // - In view mode (isEditable === false), show only publishedVisible === true threads.
  const filteredThreads = threads.filter((t) => {
    if (isEditable) return true;
    return t.publishedVisible === true;
  });

  const activeThreads = filteredThreads.filter((t) => !t.orphaned && (showResolved || !t.resolvedAt || t.id === highlightedThreadId));
  const orphanedThreads = filteredThreads.filter((t) => t.orphaned);

  const visibleThreads = [...activeThreads, ...orphanedThreads];
  const selectedThread = !isEditable && selectedThreadId
    ? visibleThreads.find((thread) => thread.id === selectedThreadId) ?? null
    : null;
  const openThreadCount = filteredThreads.filter((thread) => !thread.resolvedAt && !thread.orphaned).length;

  if (isOpen && selectedThread) {
    return (
      <div className={`csp-container is-open ${!isEditable ? 'is-readonly' : ''} is-thread-view ${presentation === 'bottom-sheet' ? 'is-bottom-sheet' : ''}`}>
        <ThreadDetail
          thread={selectedThread}
          isEditable={isEditable}
          onBack={() => setSelectedThreadId(null)}
          onClose={onClose}
          onResolve={handleResolve}
          onUnresolve={handleUnresolve}
          onDeleteThread={handleDeleteThread}
          onAddReply={handleAddReply}
          onDeleteReply={handleDeleteReply}
          onEditReply={handleEditReply}
        />
      </div>
    );
  }

  return (
    <div className={`csp-container ${isOpen ? 'is-open' : ''} ${!isEditable ? 'is-readonly' : ''} ${presentation === 'bottom-sheet' ? 'is-bottom-sheet' : ''}`}>
      {/* Header */}
      <div className="csp-header">
        <div className="csp-title-block">
          <h3 className="csp-title">
            <FiMessageSquare size={16} />
            {isEditable ? 'Comments' : 'Inline comments'}
            {threads.length > 0 && (
              <span className="csp-count">{threads.filter((t) => !t.resolvedAt).length}</span>
            )}
          </h3>
          {!isEditable && (
            <div className="csp-subtitle">
              {openThreadCount} open threads
            </div>
          )}
        </div>
        <div className="csp-header-actions">
          {isEditable ? (
            <label className="csp-toggle-label">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Show resolved
            </label>
          ) : (
            <div className="csp-filter-pills">
              <button
                type="button"
                className={`csp-filter-pill ${!showResolved ? 'is-active' : ''}`}
                onClick={() => setShowResolved(false)}
              >
                Open
              </button>
              <button
                type="button"
                className={`csp-filter-pill ${showResolved ? 'is-active' : ''}`}
                onClick={() => setShowResolved(true)}
              >
                Resolved
              </button>
            </div>
          )}
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
              isActive={thread.id === highlightedThreadId}
              isReadOnly={!isEditable}
              onOpenThread={setSelectedThreadId}
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
