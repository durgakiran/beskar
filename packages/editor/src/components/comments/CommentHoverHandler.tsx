import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/core';
import { CommentPopup } from './CommentPopup';
import { Comment } from './CommentThread';

import { ReactionSummary } from './EmojiPicker';

export interface CommentClickHandlerProps {
  editor: Editor;
  comments: Comment[];
  getReplies?: (commentId: string) => Comment[];
  getReactions?: (commentId: string) => Promise<ReactionSummary[]> | ReactionSummary[];
  onReply?: (commentId: string, replyText?: string) => void;
  onEdit?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onResolve?: (commentId: string, resolved: boolean) => void;
  onAddEmoji?: (commentId: string, emoji: string) => void;
  onRemoveEmoji?: (commentId: string, emoji: string) => void;
  onAddAttachment?: (commentId: string) => void;
  currentUserId?: string;
}

// Keep old name for backward compatibility
export interface CommentHoverHandlerProps extends CommentClickHandlerProps {}

/**
 * Comment Click Handler Component
 * Detects clicks on comment marks and shows the CommentPopup
 * Popup stays open until close button is clicked
 */
export function CommentClickHandler({
  editor,
  comments,
  getReplies,
  getReactions,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onAddEmoji,
  onRemoveEmoji,
  onAddAttachment,
  currentUserId,
}: CommentClickHandlerProps) {
  const [openComment, setOpenComment] = useState<{
    comment: Comment;
    position: { x: number; y: number };
  } | null>(null);
  const [reactions, setReactions] = useState<ReactionSummary[]>([]);
  const [replies, setReplies] = useState<Comment[]>([]);
  const [replyReactions, setReplyReactions] = useState<Map<string, ReactionSummary[]>>(new Map());
  const popupRef = useRef<HTMLDivElement>(null);

  // Load reactions and replies when comment opens
  useEffect(() => {
    if (!openComment) {
      setReactions([]);
      setReplies([]);
      setReplyReactions(new Map());
      return;
    }

    // Load reactions for main comment (only for this specific comment)
    if (getReactions) {
      const loadReactions = async () => {
        try {
          // Explicitly pass the current comment's ID to ensure we get only its reactions
          const commentId = openComment.comment.id;
          const result = await getReactions(commentId);
          // Only set reactions if we're still viewing the same comment (race condition guard)
          if (openComment && openComment.comment.id === commentId) {
            setReactions(Array.isArray(result) ? result : []);
          }
        } catch (error) {
          console.error('Failed to load reactions:', error);
          setReactions([]);
        }
      };
      loadReactions();
    }

    // Load replies
    if (getReplies) {
      const repliesList = getReplies(openComment.comment.id);
      setReplies(Array.isArray(repliesList) ? repliesList : []);

      // Load reactions for all replies (each reply gets its own reactions)
      if (getReactions && repliesList.length > 0) {
        const loadReplyReactions = async () => {
          const reactionsMap = new Map<string, ReactionSummary[]>();
          const currentCommentId = openComment.comment.id;
          
          for (const reply of repliesList) {
            try {
              // Explicitly pass each reply's ID to ensure we get only that reply's reactions
              const result = await getReactions(reply.id);
              reactionsMap.set(reply.id, Array.isArray(result) ? result : []);
            } catch (error) {
              console.error(`Failed to load reactions for reply ${reply.id}:`, error);
              reactionsMap.set(reply.id, []);
            }
          }
          
          // Only set reply reactions if we're still viewing the same comment (race condition guard)
          if (openComment && openComment.comment.id === currentCommentId) {
            setReplyReactions(reactionsMap);
          }
        };
        loadReplyReactions();
      }
    }
  }, [openComment, getReactions, getReplies]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // If clicking on popup itself, don't do anything
      if (popupRef.current && popupRef.current.contains(target)) {
        return;
      }

      const commentMark = target.closest('.comment-mark[data-comment-id]');
      
      if (!commentMark) {
        // Clicking outside comment mark - close popup
        setOpenComment(null);
        return;
      }

      // Prevent event from bubbling to document click handler
      e.stopPropagation();

      const commentId = commentMark.getAttribute('data-comment-id');
      if (!commentId) return;

      const comment = comments.find((c) => c.id === commentId);
      if (!comment) return;

      // If clicking on the same comment that's already open, toggle it closed
      if (openComment && openComment.comment.id === commentId) {
        setOpenComment(null);
        return;
      }

      // Calculate position relative to editor container
      const rect = commentMark.getBoundingClientRect();
      const editorContainer = editor.view.dom.closest('.beskar-editor') || editor.view.dom.parentElement;
      if (!editorContainer) {
        return;
      }
      
      const containerRect = (editorContainer as HTMLElement).getBoundingClientRect();
      const spacing = 20;
      const popupWidth = 400;
      
      const rightSideX = rect.right - containerRect.left + spacing;
      const leftSideX = rect.left - containerRect.left - popupWidth - spacing;
      const spaceOnRight = containerRect.right - rect.right;
      const spaceOnLeft = rect.left - containerRect.left;
      
      let popupX: number;
      let popupY: number;
      
      if (spaceOnRight > popupWidth + spacing) {
        popupX = rightSideX;
        popupY = rect.top - containerRect.top;
      } else if (spaceOnLeft > popupWidth + spacing) {
        popupX = leftSideX;
        popupY = rect.top - containerRect.top;
      } else {
        popupX = rightSideX;
        popupY = rect.top - containerRect.top;
      }

      setOpenComment({
        comment,
        position: {
          x: popupX,
          y: popupY,
        },
      });
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener('click', handleClick, true); // Use capture phase

    // Handle clicks outside to close popup
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If clicking outside editor and popup, close it
      if (!editorElement.contains(target) && !(popupRef.current && popupRef.current.contains(target))) {
        setOpenComment(null);
      }
    };

    document.addEventListener('click', handleDocumentClick);

    return () => {
      editorElement.removeEventListener('click', handleClick, true);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [editor, comments, openComment]);

  if (!openComment) {
    return null;
  }

  // Get inline comments for navigation
  const inlineComments = comments.filter((c) => c.commentType === 'inline');
  const currentIndex = inlineComments.findIndex((c) => c.id === openComment.comment.id);

  // Find editor container to render popup inside it
  const editorContainer = editor.view.dom.closest('.beskar-editor') as HTMLElement;
  
  if (!editorContainer) {
    return null;
  }

  // Use React Portal to render inside editor container for proper absolute positioning
  return createPortal(
    <div ref={popupRef}>
      <CommentPopup
        comment={openComment.comment}
        replies={replies}
        reactions={reactions}
        replyReactions={replyReactions}
        getReplyReactions={getReactions}
        position={openComment.position}
        onClose={() => setOpenComment(null)}
        onNavigate={async (direction) => {
          const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
          if (newIndex >= 0 && newIndex < inlineComments.length) {
            const newComment = inlineComments[newIndex];
            // Find the mark in the editor and update position
            const editorElement = editor.view.dom;
            const marks = editorElement.querySelectorAll(
              `.comment-mark[data-comment-id="${newComment.id}"]`
            );
            if (marks.length > 0) {
              const rect = marks[0].getBoundingClientRect();
              const containerRect = editorContainer.getBoundingClientRect();
              setOpenComment({
                comment: newComment,
                position: {
                  x: rect.right - containerRect.left + 20,
                  y: rect.top - containerRect.top,
                },
              });
              
              // Load reactions and replies for the new comment
              if (getReactions) {
                try {
                  const result = await getReactions(newComment.id);
                  setReactions(Array.isArray(result) ? result : []);
                } catch (error) {
                  console.error('Failed to load reactions:', error);
                  setReactions([]);
                }
              }
              if (getReplies) {
                const repliesList = getReplies(newComment.id);
                setReplies(Array.isArray(repliesList) ? repliesList : []);
                
                // Load reactions for all replies
                if (getReactions && repliesList.length > 0) {
                  const loadReplyReactions = async () => {
                    const reactionsMap = new Map<string, ReactionSummary[]>();
                    for (const reply of repliesList) {
                      try {
                        const result = await getReactions(reply.id);
                        reactionsMap.set(reply.id, Array.isArray(result) ? result : []);
                      } catch (error) {
                        console.error(`Failed to load reactions for reply ${reply.id}:`, error);
                        reactionsMap.set(reply.id, []);
                      }
                    }
                    setReplyReactions(reactionsMap);
                  };
                  loadReplyReactions();
                } else {
                  setReplyReactions(new Map());
                }
              }
            }
          }
        }}
        showNavigation={inlineComments.length > 1}
        canNavigatePrev={currentIndex > 0}
        canNavigateNext={currentIndex < inlineComments.length - 1}
        onReply={onReply}
        onEdit={onEdit}
        onDelete={onDelete}
        onResolve={onResolve}
        onAddEmoji={async (commentId, emoji) => {
          if (onAddEmoji) {
            await onAddEmoji(commentId, emoji);
            // Reload reactions after adding
            if (getReactions) {
              try {
                // Check if it's a reply or the main comment
                const isReply = replies.some(r => r.id === commentId);
                const isMainComment = openComment && openComment.comment.id === commentId;
                
                if (isReply) {
                  // Reload only the reply's reactions
                  const replyResult = await getReactions(commentId);
                  const newMap = new Map(replyReactions);
                  newMap.set(commentId, Array.isArray(replyResult) ? replyResult : []);
                  setReplyReactions(newMap);
                } else if (isMainComment) {
                  // Reload only the main comment's reactions
                  const result = await getReactions(commentId);
                  setReactions(Array.isArray(result) ? result : []);
                }
              } catch (error) {
                console.error('Failed to reload reactions:', error);
              }
            }
          }
        }}
        onRemoveEmoji={async (commentId, emoji) => {
          if (onRemoveEmoji) {
            await onRemoveEmoji(commentId, emoji);
            // Reload reactions after removing
            if (getReactions) {
              try {
                // Check if it's a reply or the main comment
                const isReply = replies.some(r => r.id === commentId);
                const isMainComment = openComment && openComment.comment.id === commentId;
                
                if (isReply) {
                  // Reload only the reply's reactions
                  const replyResult = await getReactions(commentId);
                  const newMap = new Map(replyReactions);
                  newMap.set(commentId, Array.isArray(replyResult) ? replyResult : []);
                  setReplyReactions(newMap);
                } else if (isMainComment) {
                  // Reload only the main comment's reactions
                  const result = await getReactions(commentId);
                  setReactions(Array.isArray(result) ? result : []);
                }
              } catch (error) {
                console.error('Failed to reload reactions:', error);
              }
            }
          }
        }}
        onAddAttachment={onAddAttachment}
        currentUserId={currentUserId}
      />
    </div>,
    editorContainer
  );
}

