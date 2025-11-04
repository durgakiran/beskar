import React from 'react';
import { Comment, CommentThread } from './CommentThread';

interface CommentSidebarProps {
  comments: Comment[];
  inlineComments: Comment[];
  pageEndComments: Comment[];
  onCommentClick?: (commentId: string) => void;
  onReply?: (commentId: string) => void;
  onEdit?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onResolve?: (commentId: string, resolved: boolean) => void;
  currentUserId?: string;
}

export function CommentSidebar({
  comments,
  inlineComments,
  pageEndComments,
  onCommentClick,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  currentUserId,
}: CommentSidebarProps) {
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

  const inlineThreads = buildThreads(inlineComments);
  const pageEndThreads = buildThreads(pageEndComments);

  return (
    <div className="comment-sidebar">
      <h3>Comments</h3>
      
      {inlineComments.length > 0 && (
        <div className="comment-section">
          <h4>Inline Comments ({inlineComments.length})</h4>
          {Array.from(inlineThreads.entries()).map(([rootId, replies]) => {
            const root = inlineComments.find((c) => c.id === rootId);
            if (!root) return null;
            return (
              <div
                key={rootId}
                className="comment-item"
                onClick={() => onCommentClick?.(rootId)}
              >
                <CommentThread
                  comment={root}
                  replies={replies}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onResolve={onResolve}
                  currentUserId={currentUserId}
                />
              </div>
            );
          })}
        </div>
      )}

      {pageEndComments.length > 0 && (
        <div className="comment-section">
          <h4>Page Comments ({pageEndComments.length})</h4>
          {Array.from(pageEndThreads.entries()).map(([rootId, replies]) => {
            const root = pageEndComments.find((c) => c.id === rootId);
            if (!root) return null;
            return (
              <div
                key={rootId}
                className="comment-item"
                onClick={() => onCommentClick?.(rootId)}
              >
                <CommentThread
                  comment={root}
                  replies={replies}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onResolve={onResolve}
                  currentUserId={currentUserId}
                />
              </div>
            );
          })}
        </div>
      )}

      {comments.length === 0 && (
        <div className="no-comments">No comments yet</div>
      )}
    </div>
  );
}

