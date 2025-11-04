import React, { useState, useRef, useEffect } from 'react';
import {
  FiChevronUp,
  FiChevronDown,
  FiMessageCircle,
  FiX,
  FiPlus,
  FiSmile,
  FiCheck,
  FiMoreVertical,
  FiEdit3,
} from 'react-icons/fi';
import * as Popover from '@radix-ui/react-popover';
import { Comment } from './CommentThread';
import { EmojiPicker, ReactionSummary } from './EmojiPicker';
import { DeleteCommentModal } from './DeleteCommentModal';
import './CommentPopup.css';

export interface CommentPopupProps {
  comment: Comment;
  replies?: Comment[];
  reactions?: ReactionSummary[];
  replyReactions?: Map<string, ReactionSummary[]>; // Map of reply ID to reactions
  position: { x: number; y: number };
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  onReply?: (commentId: string, replyText?: string) => void;
  onEdit?: (commentId: string, newText?: string) => void;
  onDelete?: (commentId: string) => void;
  onResolve?: (commentId: string, resolved: boolean) => void;
  onAddEmoji?: (commentId: string, emoji: string) => void;
  onRemoveEmoji?: (commentId: string, emoji: string) => void;
  onAddAttachment?: (commentId: string) => void;
  getReplyReactions?: (replyId: string) => Promise<ReactionSummary[]> | ReactionSummary[];
  currentUserId?: string;
  showNavigation?: boolean;
  canNavigatePrev?: boolean;
  canNavigateNext?: boolean;
}

/**
 * Comment Popup Component
 * Shows a popup with comment details when hovering over commented text
 * Matches the reference design with navigation, actions, and reply input
 */
export function CommentPopup({
  comment,
  replies = [],
  reactions = [],
  replyReactions = new Map(),
  position,
  onClose,
  onNavigate,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onAddEmoji,
  onRemoveEmoji,
  onAddAttachment,
  getReplyReactions,
  currentUserId,
  showNavigation = false,
  canNavigatePrev = false,
  canNavigateNext = false,
}: CommentPopupProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyMenus, setReplyMenus] = useState<Map<string, boolean>>(new Map());
  const [loadedReplyReactions, setLoadedReplyReactions] = useState<Map<string, ReactionSummary[]>>(new Map());
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.commentText);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCommentId, setDeleteCommentId] = useState<string | null>(null);
  const [deleteIsReply, setDeleteIsReply] = useState(false);
  const [replyEditStates, setReplyEditStates] = useState<Map<string, { isEditing: boolean; editText: string }>>(new Map());
  const menuRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  const isAuthor = currentUserId === comment.authorId;

  // Update edit text when comment changes (when comment is updated externally)
  useEffect(() => {
    // Only update if we're not currently editing (to avoid interrupting user)
    if (!isEditing) {
      setEditText(comment.commentText);
    }
  }, [comment.commentText, isEditing]);

  // Focus edit input when editing starts
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.setSelectionRange(
        editInputRef.current.value.length,
        editInputRef.current.value.length
      );
    }
  }, [isEditing]);

  // Load reactions for replies when they're displayed
  useEffect(() => {
    if (getReplyReactions && replies.length > 0) {
      const loadAllReplyReactions = async () => {
        const reactionsMap = new Map<string, ReactionSummary[]>();
        for (const reply of replies) {
          try {
            const result = await getReplyReactions(reply.id);
            reactionsMap.set(reply.id, Array.isArray(result) ? result : []);
          } catch (error) {
            console.error(`Failed to load reactions for reply ${reply.id}:`, error);
            reactionsMap.set(reply.id, []);
          }
        }
        setLoadedReplyReactions(reactionsMap);
      };
      loadAllReplyReactions();
    } else if (replyReactions.size > 0) {
      setLoadedReplyReactions(replyReactions);
    }
  }, [replies, getReplyReactions, replyReactions]);

  // Get user initials for avatar
  const getInitials = (name?: string, email?: string): string => {
    const displayName = name || email || 'U';
    const parts = displayName.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return displayName[0].toUpperCase();
  };

  // Format relative time
  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'less than a minute ago';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  // Handle reply submission
  const handleReplySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (replyText.trim() && onReply) {
      onReply(comment.id, replyText);
      setReplyText('');
      setIsReplying(false);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  // Prevent popup from closing when clicking inside it
  const handlePopupMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handlePopupClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      ref={popupRef}
      className="comment-popup"
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 1000,
      }}
      onMouseDown={handlePopupMouseDown}
      onClick={handlePopupClick}
    >
      {/* Top bar with navigation and close */}
      <div className="comment-popup-header">
        <div className="comment-popup-nav">
          {showNavigation && (
            <>
              <button
                className="comment-popup-nav-btn"
                onClick={() => onNavigate?.('prev')}
                disabled={!canNavigatePrev}
                title="Previous comment"
              >
                <FiChevronUp />
              </button>
              <button
                className="comment-popup-nav-btn"
                onClick={() => onNavigate?.('next')}
                disabled={!canNavigateNext}
                title="Next comment"
              >
                <FiChevronDown />
              </button>
            </>
          )}
        </div>
        <div className="comment-popup-header-right">
          <button
            className="comment-popup-icon-btn"
            onClick={() => {
              // Navigate to all comments view
            }}
            title="View all comments"
          >
            <FiMessageCircle />
          </button>
          <button
            className="comment-popup-icon-btn"
            onClick={onClose}
            title="Close"
          >
            <FiX />
          </button>
        </div>
      </div>

      {/* Comment content */}
      <div className="comment-popup-body">
        <div className="comment-popup-author-section">
          <div className="comment-popup-avatar">
            {getInitials(comment.authorName, comment.authorEmail)}
          </div>
          <div className="comment-popup-author-info">
            <div className="comment-popup-author-name">
              {comment.authorName || comment.authorEmail || 'Unknown'}
            </div>
            <div className="comment-popup-time">
              {formatRelativeTime(comment.createdAt)}
              {comment.edited && ' (edited)'}
            </div>
          </div>
          <div className="comment-popup-actions">
            {onAddAttachment && (
              <button
                className="comment-popup-action-btn"
                onClick={() => onAddAttachment(comment.id)}
                title="Add attachment"
              >
                <FiPlus />
              </button>
            )}
            {onAddEmoji && (
              <EmojiPicker
                onSelect={(emoji) => {
                  // Check if user already reacted with this emoji
                  const reaction = reactions.find((r) => r.emoji === emoji);
                  if (reaction?.hasReacted && onRemoveEmoji) {
                    onRemoveEmoji(comment.id, emoji);
                  } else {
                    onAddEmoji(comment.id, emoji);
                  }
                }}
                currentReactions={reactions}
                currentUserId={currentUserId}
              />
            )}
            {onResolve && (
              <button
                className={`comment-popup-action-btn ${
                  comment.resolved ? 'resolved' : ''
                }`}
                onClick={() => onResolve(comment.id, !comment.resolved)}
                title={comment.resolved ? 'Unresolve' : 'Resolve'}
              >
                <FiCheck />
              </button>
            )}
            <div className="comment-popup-menu-wrapper" ref={menuRef}>
              <button
                className="comment-popup-action-btn"
                onClick={() => setShowMenu(!showMenu)}
                title="More options"
              >
                <FiMoreVertical />
              </button>
              {showMenu && (
                <div className="comment-popup-menu">
                  {isAuthor && onEdit && (
                    <button
                      className="comment-popup-menu-item"
                      onClick={() => {
                        setIsEditing(true);
                        setEditText(comment.commentText);
                        setShowMenu(false);
                      }}
                    >
                      <FiEdit3 /> Edit
                    </button>
                  )}
                  {isAuthor && onDelete && (
                    <button
                      className="comment-popup-menu-item"
                      onClick={() => {
                        setDeleteCommentId(comment.id);
                        setDeleteIsReply(false);
                        setShowDeleteModal(true);
                        setShowMenu(false);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Comment text - show edit input if editing */}
        {isEditing ? (
          <div className="comment-popup-edit-section">
            <textarea
              ref={editInputRef}
              className="comment-popup-edit-input"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className="comment-popup-edit-actions">
              <button
                className="comment-popup-edit-button cancel"
                onClick={() => {
                  setIsEditing(false);
                  setEditText(comment.commentText);
                }}
              >
                Cancel
              </button>
              <button
                className="comment-popup-edit-button save"
                onClick={() => {
                  if (editText.trim() && editText.trim() !== comment.commentText && onEdit) {
                    onEdit(comment.id, editText.trim());
                    // Keep edit mode open until comment is reloaded (parent will update comment.commentText)
                    // The useEffect will detect the change and close edit mode
                  }
                }}
                disabled={!editText.trim() || editText.trim() === comment.commentText}
              >
                <FiCheck /> Save
              </button>
            </div>
          </div>
        ) : (
          <div className="comment-popup-text">{comment.commentText}</div>
        )}
        
        {/* Reactions */}
        {reactions.length > 0 && (
          <div className="comment-popup-reactions">
            {reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                className={`comment-popup-reaction ${reaction.hasReacted ? 'has-reacted' : ''}`}
                onClick={() => {
                  if (reaction.hasReacted && onRemoveEmoji) {
                    onRemoveEmoji(comment.id, reaction.emoji);
                  } else if (!reaction.hasReacted && onAddEmoji) {
                    onAddEmoji(comment.id, reaction.emoji);
                  }
                }}
                title={`${reaction.count} reaction${reaction.count > 1 ? 's' : ''}`}
              >
                <span className="reaction-emoji">{reaction.emoji}</span>
                <span className="reaction-count">{reaction.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Replies section */}
      {replies.length > 0 && (
        <div className="comment-popup-replies">
          <div className="comment-popup-replies-header">
            {replies.length} {replies.length === 1 ? 'Reply' : 'Replies'}
          </div>
          {replies.map((reply) => {
            const replyIsAuthor = currentUserId === reply.authorId;
            const replyMenuOpen = replyMenus.get(reply.id) || false;
            const replyReactionsList = loadedReplyReactions.get(reply.id) || [];

            return (
              <div key={reply.id} className="comment-popup-reply-item">
                <div className="comment-popup-reply-author">
                  <div className="comment-popup-reply-avatar">
                    {getInitials(reply.authorName, reply.authorEmail)}
                  </div>
                  <div className="comment-popup-reply-author-info">
                    <div className="comment-popup-reply-author-name">
                      {reply.authorName || reply.authorEmail || 'Unknown'}
                    </div>
                    <div className="comment-popup-reply-time">
                      {formatRelativeTime(reply.createdAt)}
                      {reply.edited && ' (edited)'}
                    </div>
                  </div>
                  <div className="comment-popup-reply-actions">
                    {onAddAttachment && (
                      <button
                        className="comment-popup-action-btn"
                        onClick={() => onAddAttachment(reply.id)}
                        title="Add attachment"
                      >
                        <FiPlus />
                      </button>
                    )}
                    {onAddEmoji && (
                      <EmojiPicker
                        onSelect={(emoji) => {
                          const reaction = replyReactionsList.find((r) => r.emoji === emoji);
                          if (reaction?.hasReacted && onRemoveEmoji) {
                            onRemoveEmoji(reply.id, emoji);
                            // Reload reactions
                            if (getReplyReactions) {
                              const result = getReplyReactions(reply.id);
                              if (result instanceof Promise) {
                                result.then((reactions: ReactionSummary[]) => {
                                  const newMap = new Map(loadedReplyReactions);
                                  newMap.set(reply.id, Array.isArray(reactions) ? reactions : []);
                                  setLoadedReplyReactions(newMap);
                                });
                              } else {
                                const newMap = new Map(loadedReplyReactions);
                                newMap.set(reply.id, Array.isArray(result) ? result : []);
                                setLoadedReplyReactions(newMap);
                              }
                            }
                          } else {
                            onAddEmoji(reply.id, emoji);
                            // Reload reactions
                            if (getReplyReactions) {
                              const result = getReplyReactions(reply.id);
                              if (result instanceof Promise) {
                                result.then((reactions: ReactionSummary[]) => {
                                  const newMap = new Map(loadedReplyReactions);
                                  newMap.set(reply.id, Array.isArray(reactions) ? reactions : []);
                                  setLoadedReplyReactions(newMap);
                                });
                              } else {
                                const newMap = new Map(loadedReplyReactions);
                                newMap.set(reply.id, Array.isArray(result) ? result : []);
                                setLoadedReplyReactions(newMap);
                              }
                            }
                          }
                        }}
                        currentReactions={replyReactionsList}
                        currentUserId={currentUserId}
                      />
                    )}
                    <div className="comment-popup-menu-wrapper">
                      <button
                        className="comment-popup-action-btn"
                        onClick={() => {
                          const newMap = new Map(replyMenus);
                          newMap.set(reply.id, !replyMenuOpen);
                          setReplyMenus(newMap);
                        }}
                        title="More options"
                      >
                        <FiMoreVertical />
                      </button>
                      {replyMenuOpen && (
                        <div className="comment-popup-menu">
                          {replyIsAuthor && onEdit && (
                            <button
                              className="comment-popup-menu-item"
                              onClick={() => {
                                const newMap = new Map(replyEditStates);
                                newMap.set(reply.id, { isEditing: true, editText: reply.commentText });
                                setReplyEditStates(newMap);
                                const menuMap = new Map(replyMenus);
                                menuMap.set(reply.id, false);
                                setReplyMenus(menuMap);
                              }}
                            >
                              <FiEdit3 /> Edit
                            </button>
                          )}
                          {replyIsAuthor && onDelete && (
                            <button
                              className="comment-popup-menu-item"
                              onClick={() => {
                                setDeleteCommentId(reply.id);
                                setDeleteIsReply(true);
                                setShowDeleteModal(true);
                                const newMap = new Map(replyMenus);
                                newMap.set(reply.id, false);
                                setReplyMenus(newMap);
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {/* Reply text - show edit input if editing */}
                {replyEditStates.get(reply.id)?.isEditing ? (
                  <div className="comment-popup-edit-section">
                    <textarea
                      className="comment-popup-edit-input"
                      value={replyEditStates.get(reply.id)?.editText || ''}
                      onChange={(e) => {
                        const newMap = new Map(replyEditStates);
                        const state = newMap.get(reply.id) || { isEditing: true, editText: '' };
                        state.editText = e.target.value;
                        newMap.set(reply.id, state);
                        setReplyEditStates(newMap);
                      }}
                      rows={3}
                      autoFocus
                    />
                    <div className="comment-popup-edit-actions">
                      <button
                        className="comment-popup-edit-button cancel"
                        onClick={() => {
                          const newMap = new Map(replyEditStates);
                          newMap.delete(reply.id);
                          setReplyEditStates(newMap);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="comment-popup-edit-button save"
                        onClick={() => {
                          const editState = replyEditStates.get(reply.id);
                          if (editState?.editText.trim() && 
                              editState.editText.trim() !== reply.commentText && 
                              onEdit) {
                            onEdit(reply.id, editState.editText.trim());
                            // Note: The edit state will be cleared after comment is updated
                            // The parent component should reload replies which will update the UI
                            const newMap = new Map(replyEditStates);
                            newMap.delete(reply.id);
                            setReplyEditStates(newMap);
                          }
                        }}
                        disabled={!replyEditStates.get(reply.id)?.editText.trim() || 
                                 replyEditStates.get(reply.id)?.editText.trim() === reply.commentText}
                      >
                        <FiCheck /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="comment-popup-reply-text">{reply.commentText}</div>
                )}
                
                {/* Reply Reactions */}
                {replyReactionsList.length > 0 && (
                  <div className="comment-popup-reactions">
                    {replyReactionsList.map((reaction) => (
                      <button
                        key={reaction.emoji}
                        className={`comment-popup-reaction ${reaction.hasReacted ? 'has-reacted' : ''}`}
                        onClick={() => {
                          if (reaction.hasReacted && onRemoveEmoji) {
                            onRemoveEmoji(reply.id, reaction.emoji);
                            // Reload reactions
                            if (getReplyReactions) {
                              const result = getReplyReactions(reply.id);
                              if (result instanceof Promise) {
                                result.then((reactions: ReactionSummary[]) => {
                                  const newMap = new Map(loadedReplyReactions);
                                  newMap.set(reply.id, Array.isArray(reactions) ? reactions : []);
                                  setLoadedReplyReactions(newMap);
                                });
                              } else {
                                const newMap = new Map(loadedReplyReactions);
                                newMap.set(reply.id, Array.isArray(result) ? result : []);
                                setLoadedReplyReactions(newMap);
                              }
                            }
                          } else if (!reaction.hasReacted && onAddEmoji) {
                            onAddEmoji(reply.id, reaction.emoji);
                            // Reload reactions
                            if (getReplyReactions) {
                              const result = getReplyReactions(reply.id);
                              if (result instanceof Promise) {
                                result.then((reactions: ReactionSummary[]) => {
                                  const newMap = new Map(loadedReplyReactions);
                                  newMap.set(reply.id, Array.isArray(reactions) ? reactions : []);
                                  setLoadedReplyReactions(newMap);
                                });
                              } else {
                                const newMap = new Map(loadedReplyReactions);
                                newMap.set(reply.id, Array.isArray(result) ? result : []);
                                setLoadedReplyReactions(newMap);
                              }
                            }
                          }
                        }}
                        title={`${reaction.count} reaction${reaction.count > 1 ? 's' : ''}`}
                      >
                        <span className="reaction-emoji">{reaction.emoji}</span>
                        <span className="reaction-count">{reaction.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reply section */}
      <div className="comment-popup-reply">
        {isReplying ? (
          <form onSubmit={handleReplySubmit} className="comment-popup-reply-form">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Reply to this comment..."
              className="comment-popup-reply-input"
              autoFocus
            />
            <div className="comment-popup-reply-actions">
              <button
                type="submit"
                className="comment-popup-reply-submit"
                disabled={!replyText.trim()}
              >
                Reply
              </button>
              <button
                type="button"
                className="comment-popup-reply-cancel"
                onClick={() => {
                  setIsReplying(false);
                  setReplyText('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className="comment-popup-reply-btn"
            onClick={() => setIsReplying(true)}
          >
            Reply
          </button>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <DeleteCommentModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteCommentId(null);
        }}
        onConfirm={() => {
          if (deleteCommentId && onDelete) {
            onDelete(deleteCommentId);
          }
        }}
        commentText={
          deleteCommentId
            ? deleteIsReply
              ? replies.find((r) => r.id === deleteCommentId)?.commentText
              : comment.id === deleteCommentId
              ? comment.commentText
              : undefined
            : undefined
        }
        isReply={deleteIsReply}
      />
    </div>
  );
}

