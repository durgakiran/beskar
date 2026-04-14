/**
 * CommentSidePanel
 *
 * Right-side panel showing all comment threads for a document.
 * Opens when a comment highlight span is clicked.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/core';
import { FiArrowLeft, FiCheckCircle, FiCornerDownLeft, FiEdit2, FiFile, FiMessageSquare, FiPaperclip, FiRotateCcw, FiSend, FiTrash2, FiX } from 'react-icons/fi';
import type {
  AttachmentAPIHandler,
  CommentAPIHandler,
  CommentThread,
  CommentReply,
  CommentReplyAttachment,
} from '../types';
import { commentDecorationKey } from '../extensions/comment-decoration';
import {
  buildReplyAttachments,
  CommentAttachmentPills,
  CommentAvatar,
  formatCommentRelativeTime,
  getQuotedText,
  readFilesFromInputEvent,
  splitOpeningReply,
  uploadCommentAttachments,
} from './comment-ui';
import './CommentThreadCard.css';
import './CommentSidePanel.css';

export interface CommentSidePanelProps {
  editor: Editor;
  commentHandler: CommentAPIHandler;
  documentId: string;
  threads: CommentThread[];
  isOpen: boolean;
  presentation?: 'docked' | 'bottom-sheet';
  activeThreadId?: string | null;
  attachmentHandler?: AttachmentAPIHandler;
  onClose: () => void;
  onThreadUpdated: (thread: CommentThread) => void;
  onThreadDeleted: (threadId: string) => void;
}

function getThreadPreview(thread: CommentThread): string {
  const latestReply = thread.replies[thread.replies.length - 1];
  if (latestReply?.body?.trim()) return latestReply.body.trim();
  return 'Open thread';
}

interface ReplyItemProps {
  reply: CommentReply;
  readonlyMode?: boolean;
  onDelete: (replyId: string) => void;
  onEdit: (replyId: string, newBody: string, attachments: CommentReplyAttachment[]) => void;
  attachmentHandler?: AttachmentAPIHandler;
}

function ReplyItem({ reply, readonlyMode = false, onDelete, onEdit, attachmentHandler }: ReplyItemProps) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(reply.body);
  const [editAttachments, setEditAttachments] = useState<CommentReplyAttachment[]>(reply.attachments ?? []);
  const [editPendingAttachments, setEditPendingAttachments] = useState<CommentReplyAttachment[]>([]);
  const [editUploadingFiles, setEditUploadingFiles] = useState<File[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [isUploadingEditAttachments, setIsUploadingEditAttachments] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const submitEdit = () => {
    if ((!editBody.trim() && editAttachments.length === 0 && editPendingAttachments.length === 0) || isUploadingEditAttachments) return;
    onEdit(reply.id, editBody.trim(), [...editAttachments, ...editPendingAttachments]);
    setEditing(false);
    setEditError(null);
    setEditPendingAttachments([]);
  };
  const cancelEdit = () => {
    setEditing(false);
    setEditBody(reply.body);
    setEditAttachments(reply.attachments ?? []);
    setEditPendingAttachments([]);
    setEditUploadingFiles([]);
    setEditError(null);
  };
  const startEdit = () => {
    setEditBody(reply.body);
    setEditAttachments(reply.attachments ?? []);
    setEditPendingAttachments([]);
    setEditing(true);
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = readFilesFromInputEvent(e);
    e.target.value = '';
    if (files.length > 0) {
      setEditError(null);
      if (attachmentHandler) {
        setIsUploadingEditAttachments(true);
        setEditUploadingFiles((prev) => [...prev, ...files]);
        try {
          const { uploaded, failedFiles } = await uploadCommentAttachments(attachmentHandler, files);
          if (uploaded.length > 0) {
            setEditPendingAttachments((prev) => [...prev, ...uploaded]);
          }
          if (failedFiles.length > 0) {
            setEditError(`Failed to upload: ${failedFiles.join(', ')}`);
          }
        } finally {
          setEditUploadingFiles((prev) => prev.filter((file) => !files.includes(file)));
          setIsUploadingEditAttachments(false);
        }
      } else {
        setEditPendingAttachments((prev) => [...prev, ...buildReplyAttachments(files)]);
      }
    }
  };

  return (
    <div className="ctc-reply-item">
      <CommentAvatar name={reply.authorName} size="small" />
      <div className="ctc-reply-body">
        <div className="ctc-reply-header">
          <div className="ctc-reply-meta">
            <span className="ctc-name">{reply.authorName ?? '👤 Deleted User'}</span>
            <span className="ctc-time">{formatCommentRelativeTime(reply.createdAt)}</span>
          </div>
          {!readonlyMode && reply.authorId && (
            <div className="ctc-reply-actions">
              <button className="ctc-tiny-btn" title="Edit" onClick={startEdit}>
                <FiEdit2 size={13} />
              </button>
              <button className="ctc-tiny-btn ctc-tiny-btn--danger" title="Delete" onClick={() => onDelete(reply.id)}>
                <FiTrash2 size={13} />
              </button>
            </div>
          )}
        </div>
        {editing ? (
          <div className="ctc-edit-area">
            <textarea
              className="ctc-reply-input-textarea"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={2}
              autoFocus
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <CommentAttachmentPills
              attachments={editAttachments}
              editable
              scrollable
              onRemoveAttachment={(attachmentId) =>
                setEditAttachments((prev) => prev.filter((att) => att.attachmentId !== attachmentId))
              }
            />
            <CommentAttachmentPills
              attachments={editPendingAttachments}
              editable
              scrollable
              onRemoveAttachment={(attachmentId) =>
                setEditPendingAttachments((prev) => prev.filter((att) => att.attachmentId !== attachmentId))
              }
            />
            <CommentAttachmentPills files={editUploadingFiles} scrollable />
            {editError && <p className="ctc-error-text">{editError}</p>}
            {isUploadingEditAttachments && <p className="ctc-error-text">Uploading attachment…</p>}
            <input
              type="file"
              multiple
              ref={editFileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <div className="ctc-edit-actions">
              <button
                type="button"
                className="ctc-attach-btn"
                style={{ marginRight: 'auto' }}
                onClick={() => editFileInputRef.current?.click()}
                disabled={isUploadingEditAttachments}
              >
                <FiPaperclip size={13} /> Attach
              </button>
              <button className="ctc-btn ctc-btn--ghost" onClick={cancelEdit}>Cancel</button>
              <button className="ctc-btn ctc-btn--primary" onClick={submitEdit} disabled={isUploadingEditAttachments}>Save</button>
            </div>
          </div>
        ) : (
          <>
            <p className="ctc-reply-text">{reply.body}</p>
            <CommentAttachmentPills attachments={reply.attachments} />
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
  onEditReply: (replyId: string, newBody: string, attachments: CommentReplyAttachment[]) => void;
  attachmentHandler?: AttachmentAPIHandler;
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
  attachmentHandler,
}: ThreadCardProps) {
  const [replyBody, setReplyBody] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<CommentReplyAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  // Scroll into view when active
  useEffect(() => {
    if (isActive && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  const submitReply = async () => {
    if ((!replyBody.trim() && pendingAttachments.length === 0) || isSubmittingReply || isUploadingAttachments) return;
    setIsSubmittingReply(true);
    setReplyError(null);
    try {
      await onAddReply(thread.id, replyBody.trim(), pendingAttachments);
      setReplyBody('');
      setPendingAttachments([]);
    } catch {
      setReplyError('Failed to send reply. Please try again.');
    } finally {
      setIsSubmittingReply(false);
    }
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = readFilesFromInputEvent(e);
    e.target.value = '';
    if (files.length > 0) {
      setReplyError(null);
      if (attachmentHandler) {
        setIsUploadingAttachments(true);
        setUploadingFiles((prev) => [...prev, ...files]);
        try {
          const { uploaded, failedFiles } = await uploadCommentAttachments(attachmentHandler, files);
          if (uploaded.length > 0) {
            setPendingAttachments((prev) => [...prev, ...uploaded]);
          }
          if (failedFiles.length > 0) {
            setReplyError(`Failed to upload: ${failedFiles.join(', ')}`);
          }
        } finally {
          setUploadingFiles((prev) => prev.filter((file) => !files.includes(file)));
          setIsUploadingAttachments(false);
        }
      } else {
        setPendingAttachments((prev) => [...prev, ...buildReplyAttachments(files)]);
      }
    }
  };

  const isResolved = !!thread.resolvedAt;
  const isOrphaned = !!thread.orphaned;
  const quotedText = getQuotedText(thread);
  const { opening, followUps } = splitOpeningReply(thread);
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
            <CommentAvatar name={thread.createdByName} />
            <div className="csp-thread-meta">
              <span className="csp-author">{thread.createdByName ?? 'Deleted user'}</span>
              <span className="csp-ts">{formatCommentRelativeTime((opening ?? thread).createdAt)}</span>
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
      <div className="primary-comment-block">
        <div className="primary-comment-header">
          <CommentAvatar name={thread.createdByName} />
          <div className="primary-comment-meta">
            <span className="ctc-name">{thread.createdByName ?? '👤 Deleted User'}</span>
            <span className="ctc-time">{formatCommentRelativeTime(thread.createdAt)}</span>
          </div>
          <div className="primary-comment-actions">
            {!isResolved && !isOrphaned && (
              <button
                className="primary-comment-action-btn"
                title="Resolve thread"
                onClick={() => onResolve(thread.id)}
              >
                <FiCheckCircle size={14} />
              </button>
            )}
            {isResolved && !isOrphaned && (
              <button
                className="primary-comment-action-btn"
                title="Unresolve thread"
                onClick={() => onUnresolve(thread.id)}
              >
                <FiRotateCcw size={14} />
              </button>
            )}
            <button
              className="primary-comment-action-btn primary-comment-action-btn--danger"
              title="Delete thread"
              onClick={() => onDelete(thread.id)}
            >
              <FiTrash2 size={14} />
            </button>
          </div>
        </div>

        {isOrphaned ? (
          <p className="ctc-orphaned">The commented text was deleted.</p>
        ) : (
          <div className="primary-comment-quote">"{quotedText}"</div>
        )}

        <p className="primary-comment-body">{rootBody}</p>
      </div>

      {followUps.length > 0 && (
        <div className="ctc-discussion-section">
          <div className="ctc-discussion-header">Discussion</div>
          <div className="ctc-replies-list">
            <div className="ctc-discussion-dot" />
            <div className="ctc-threading-line" />
            {followUps.map((reply) => (
              <ReplyItem
                key={reply.id}
                reply={reply}
                attachmentHandler={attachmentHandler}
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
          <textarea
            className="ctc-reply-textarea"
            placeholder="Write a reply..."
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={3}
            disabled={isSubmittingReply}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitReply();
            }}
          />
          <CommentAttachmentPills
            attachments={pendingAttachments}
            editable
            scrollable
            onRemoveAttachment={(attachmentId) =>
              setPendingAttachments((prev) => prev.filter((att) => att.attachmentId !== attachmentId))
            }
          />
          <CommentAttachmentPills files={uploadingFiles} scrollable />
          {replyError && <p className="ctc-error-text">{replyError}</p>}
          {isUploadingAttachments && <p className="ctc-error-text">Uploading attachment…</p>}
          <div className="ctc-reply-composer-actions">
            <input
              type="file"
              multiple
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button className="ctc-attach-btn" type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploadingAttachments}>
              <FiPaperclip size={14} /> Attach
            </button>
            <button
              className="ctc-send-btn"
              disabled={(!replyBody.trim() && pendingAttachments.length === 0) || isSubmittingReply || isUploadingAttachments}
              onClick={submitReply}
              title="Send reply (Cmd+Enter)"
            >
              <FiCornerDownLeft size={14} /> Reply
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
  onEditReply: (replyId: string, newBody: string, attachments: CommentReplyAttachment[]) => void;
  attachmentHandler?: AttachmentAPIHandler;
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
  attachmentHandler,
}: ThreadDetailProps) {
  const [replyBody, setReplyBody] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<CommentReplyAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { opening, followUps } = splitOpeningReply(thread);

  const submitReply = async () => {
    if ((!replyBody.trim() && pendingAttachments.length === 0) || isSubmittingReply || isUploadingAttachments) return;
    setIsSubmittingReply(true);
    setReplyError(null);
    try {
      await onAddReply(thread.id, replyBody.trim(), pendingAttachments);
      setReplyBody('');
      setPendingAttachments([]);
    } catch {
      setReplyError('Failed to send reply. Please try again.');
    } finally {
      setIsSubmittingReply(false);
    }
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = readFilesFromInputEvent(e);
    e.target.value = '';
    if (files.length > 0) {
      setReplyError(null);
      if (attachmentHandler) {
        setIsUploadingAttachments(true);
        setUploadingFiles((prev) => [...prev, ...files]);
        try {
          const { uploaded, failedFiles } = await uploadCommentAttachments(attachmentHandler, files);
          if (uploaded.length > 0) {
            setPendingAttachments((prev) => [...prev, ...uploaded]);
          }
          if (failedFiles.length > 0) {
            setReplyError(`Failed to upload: ${failedFiles.join(', ')}`);
          }
        } finally {
          setUploadingFiles((prev) => prev.filter((file) => !files.includes(file)));
          setIsUploadingAttachments(false);
        }
      } else {
        setPendingAttachments((prev) => [...prev, ...buildReplyAttachments(files)]);
      }
    }
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
            <CommentAvatar name={thread.createdByName} />
            <div className="primary-comment-meta">
              <span className="csp-author">{thread.createdByName ?? 'Deleted user'}</span>
              <span className="csp-ts">{formatCommentRelativeTime((opening ?? thread).createdAt)}</span>
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

        {followUps.length > 0 && (
          <div className="ctc-discussion-section">
            <div className="ctc-discussion-header">Discussion</div>
            <div className="ctc-replies-list">
              <div className="ctc-discussion-dot" />
              <div className="ctc-threading-line" />
              {followUps.map((reply) => (
                <ReplyItem
                  key={reply.id}
                  reply={reply}
                  readonlyMode={!isEditable}
                  attachmentHandler={attachmentHandler}
                  onDelete={(replyId) => onDeleteReply(thread.id, replyId)}
                  onEdit={onEditReply}
                />
              ))}
            </div>
          </div>
        )}

        {!isResolved && (
          <div className="csp-reply-composer">
            <div className="csp-reply-composer-label">Reply to thread</div>
            <textarea
              className="ctc-reply-textarea"
              placeholder="Write a reply..."
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={3}
              disabled={isSubmittingReply}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitReply();
              }}
            />
            <CommentAttachmentPills
              attachments={pendingAttachments}
              editable
              scrollable
              onRemoveAttachment={(attachmentId) =>
                setPendingAttachments((prev) => prev.filter((att) => att.attachmentId !== attachmentId))
              }
            />
            <CommentAttachmentPills files={uploadingFiles} scrollable />
            {replyError && <p className="ctc-error-text">{replyError}</p>}
            {isUploadingAttachments && <p className="ctc-error-text">Uploading attachment…</p>}
            <div className="ctc-reply-composer-actions">
              <input
                type="file"
                multiple
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button className="ctc-attach-btn" type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploadingAttachments}>
                <FiPaperclip size={14} /> Attach
              </button>
              <button
                className="ctc-send-btn"
                disabled={(!replyBody.trim() && pendingAttachments.length === 0) || isSubmittingReply || isUploadingAttachments}
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
  attachmentHandler,
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
  const handleEditReply = async (replyId: string, newBody: string, attachments: CommentReplyAttachment[]) => {
    try {
      const updated = await commentHandler.editReply(replyId, newBody, attachments);
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
          attachmentHandler={attachmentHandler}
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
              attachmentHandler={attachmentHandler}
            />
          ))
        )}
      </div>
    </div>
  );
}
