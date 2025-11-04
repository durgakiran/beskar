import React from 'react';

export interface Comment {
  id: string;
  authorId: string;
  authorName?: string;
  authorEmail?: string;
  commentText: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  resolved: boolean;
  parentCommentId?: string;
  commentType?: 'inline' | 'page_end';
}

interface CommentThreadProps {
  comment: Comment;
  replies?: Comment[];
  onReply?: (commentId: string) => void;
  onEdit?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onResolve?: (commentId: string, resolved: boolean) => void;
  currentUserId?: string;
}

export function CommentThread({
  comment,
  replies = [],
  onReply,
  onEdit,
  onDelete,
  onResolve,
  currentUserId,
}: CommentThreadProps) {
  const isAuthor = currentUserId === comment.authorId;

  return (
    <div className="comment-thread">
      <div className="comment-main">
        <div className="comment-header">
          <span className="comment-author">
            {comment.authorName || comment.authorEmail || 'Unknown'}
          </span>
          <span className="comment-date">
            {new Date(comment.createdAt).toLocaleString()}
            {comment.edited && ' (edited)'}
          </span>
        </div>
        <div className="comment-text">{comment.commentText}</div>
        <div className="comment-actions">
          {onReply && (
            <button onClick={() => onReply(comment.id)}>Reply</button>
          )}
          {isAuthor && onEdit && (
            <button onClick={() => onEdit(comment.id)}>Edit</button>
          )}
          {isAuthor && onDelete && (
            <button onClick={() => onDelete(comment.id)}>Delete</button>
          )}
          {onResolve && (
            <button
              onClick={() => onResolve(comment.id, !comment.resolved)}
            >
              {comment.resolved ? 'Unresolve' : 'Resolve'}
            </button>
          )}
        </div>
      </div>
      {replies.length > 0 && (
        <div className="comment-replies">
          {replies.map((reply) => (
            <CommentThread
              key={reply.id}
              comment={reply}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onResolve={onResolve}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

