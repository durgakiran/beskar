import React, { useState, useRef, useEffect } from 'react';
import { FiX, FiCamera } from 'react-icons/fi';
import { Comment, CommentThread } from './CommentThread';
import './EndOfPageComments.css';

interface EndOfPageCommentsProps {
  comments: Comment[];
  onAddComment?: (commentText: string) => void;
  onReply?: (commentId: string, replyText?: string) => void;
  onEdit?: (commentId: string, newText?: string) => void;
  onDelete?: (commentId: string) => void;
  onResolve?: (commentId: string, resolved: boolean) => void;
  currentUserId?: string;
  canComment?: boolean;
  authorName?: string;
  authorEmail?: string;
  authorInitials?: string;
}

export function EndOfPageComments({
  comments,
  onAddComment,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  currentUserId,
  canComment = false,
  authorName,
  authorEmail,
  authorInitials,
}: EndOfPageCommentsProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Group comments into threads
  const buildThreads = (commentList: Comment[]): Map<string, Comment[]> => {
    const threads = new Map<string, Comment[]>();
    const rootComments = commentList.filter((c) => !c.parentCommentId);

    rootComments.forEach((root) => {
      const replies = commentList.filter(
        (c) => c.parentCommentId === root.id
      );
      threads.set(root.id, replies);
    });

    return threads;
  };

  const threads = buildThreads(comments);
  const rootComments = comments.filter((c) => !c.parentCommentId);

  // Focus textarea when creating comment
  useEffect(() => {
    if (isCreating && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isCreating]);

  // Get user initials for avatar
  const getInitials = (): string => {
    if (authorInitials) return authorInitials;
    const displayName = authorName || authorEmail || 'U';
    const parts = displayName.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return displayName[0].toUpperCase();
  };

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || isSubmitting || !onAddComment) return;

    setIsSubmitting(true);
    try {
      await onAddComment(commentText.trim());
      setCommentText('');
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle cancel
  const handleCancel = () => {
    setCommentText('');
    setIsCreating(false);
  };

  return (
    <div className="end-of-page-comments">
      <h2>Comments</h2>
      
      {/* Create Comment UI */}
      {canComment && onAddComment && (
        <div className="end-of-page-create-comment">
          {!isCreating ? (
            <button 
              onClick={() => setIsCreating(true)} 
              className="end-of-page-add-comment-btn"
            >
              Add Comment
            </button>
          ) : (
            <div className="end-of-page-create-comment-form">
              {/* Header with author info */}
              {(authorName || authorEmail) && (
                <div className="end-of-page-create-comment-header">
                  <div className="end-of-page-create-comment-avatar">
                    {getInitials()}
                  </div>
                  <div className="end-of-page-create-comment-author-info">
                    <div className="end-of-page-create-comment-author-name">
                      {authorName || authorEmail || 'Unknown'}
                    </div>
                  </div>
                  <button
                    className="end-of-page-create-comment-close"
                    onClick={handleCancel}
                    title="Close"
                  >
                    <FiX />
                  </button>
                </div>
              )}
              
              {/* Comment input */}
              <form onSubmit={handleSubmit} className="end-of-page-create-comment-form-inner">
                <textarea
                  ref={textareaRef}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Type /ai for Atlassian Intelligence, / to add elements, or @ to mention someone (we'll let them know)."
                  className="end-of-page-create-comment-textarea"
                  rows={3}
                  onKeyDown={(e) => {
                    // Submit on Cmd/Ctrl + Enter
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                    // Cancel on Escape
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancel();
                    }
                  }}
                />
                <div className="end-of-page-create-comment-actions">
                  <button
                    type="button"
                    className="end-of-page-create-comment-camera-btn"
                    title="Add attachment"
                    disabled={isSubmitting}
                  >
                    <FiCamera />
                  </button>
                  <button
                    type="submit"
                    className="end-of-page-create-comment-add-btn"
                    disabled={!commentText.trim() || isSubmitting}
                  >
                    {isSubmitting ? 'Adding...' : 'Add'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {rootComments.length > 0 ? (
        <div className="end-of-page-comments-list">
          {rootComments.map((comment) => {
            const replies = threads.get(comment.id) || [];
            return (
              <CommentThread
                key={comment.id}
                comment={comment}
                replies={replies}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                onResolve={onResolve}
                currentUserId={currentUserId}
              />
            );
          })}
        </div>
      ) : !isCreating && (
        <div className="end-of-page-no-comments">No comments yet</div>
      )}
    </div>
  );
}

