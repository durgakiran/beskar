import React, { useState, useRef, useEffect } from 'react';
import {
  FiX,
  FiCamera,
} from 'react-icons/fi';
import './CommentPopup.css';

export interface CreateCommentPopupProps {
  position: { x: number; y: number };
  onClose: () => void;
  onSubmit: (commentText: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  authorName?: string;
  authorEmail?: string;
  authorInitials?: string;
}

/**
 * Create Comment Popup Component
 * Shows a popup for creating a new comment when user clicks the comment button
 * Similar to CommentPopup but for creating new comments
 */
export function CreateCommentPopup({
  position,
  onClose,
  onSubmit,
  onCancel,
  placeholder = 'Type /ai for Atlassian Intelligence, / to add elements, or @ to mention someone (we\'ll let them know).',
  authorName,
  authorEmail,
  authorInitials,
}: CreateCommentPopupProps) {
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(commentText.trim());
      setCommentText('');
      onClose();
    } catch (error) {
      console.error('Failed to create comment:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle cancel
  const handleCancel = () => {
    setCommentText('');
    if (onCancel) {
      onCancel();
    } else {
      onClose();
    }
  };

  // Handle escape key and click outside
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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

  // Prevent popup from closing when clicking inside it
  const handlePopupMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      ref={popupRef}
      className="comment-popup create-comment-popup"
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 1001, // Above bubble menu
      }}
      onMouseDown={handlePopupMouseDown}
    >
      {/* Top bar with author info and close */}
      <div className="comment-popup-header">
        <div className="comment-popup-author-section-header">
          {(authorName || authorEmail) && (
            <>
              <div className="comment-popup-avatar">
                {getInitials()}
              </div>
              <div className="comment-popup-author-info">
                <div className="comment-popup-author-name">
                  {authorName || authorEmail || 'Unknown'}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="comment-popup-header-right">
          <button
            className="comment-popup-icon-btn"
            onClick={handleCancel}
            title="Close"
          >
            <FiX />
          </button>
        </div>
      </div>

      {/* Comment input */}
      <div className="comment-popup-body">
        <form onSubmit={handleSubmit} className="create-comment-form">
          <textarea
            ref={textareaRef}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={placeholder}
            className="create-comment-textarea"
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
          <div className="create-comment-actions">
            <button
              type="button"
              className="comment-popup-action-btn create-comment-camera-btn"
              title="Add attachment"
              disabled={isSubmitting}
            >
              <FiCamera />
            </button>
            <button
              type="submit"
              className="create-comment-add-btn"
              disabled={!commentText.trim() || isSubmitting}
            >
              {isSubmitting ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

