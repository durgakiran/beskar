import React from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiAlertTriangle } from 'react-icons/fi';
import './DeleteCommentModal.css';

export interface DeleteCommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  commentText?: string;
  isReply?: boolean;
}

export function DeleteCommentModal({
  isOpen,
  onClose,
  onConfirm,
  commentText,
  isReply = false,
}: DeleteCommentModalProps) {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Render modal in portal to ensure it appears above everything
  return createPortal(
    <div className="delete-comment-modal-backdrop" onClick={handleBackdropClick}>
      <div className="delete-comment-modal" onClick={(e) => e.stopPropagation()}>
        <div className="delete-comment-modal-header">
          <div className="delete-comment-modal-icon">
            <FiAlertTriangle />
          </div>
          <h3 className="delete-comment-modal-title">
            Delete {isReply ? 'Reply' : 'Comment'}
          </h3>
          <button
            className="delete-comment-modal-close"
            onClick={onClose}
            title="Close"
          >
            <FiX />
          </button>
        </div>
        <div className="delete-comment-modal-body">
          <p className="delete-comment-modal-message">
            Are you sure you want to delete this {isReply ? 'reply' : 'comment'}? This action cannot be undone.
          </p>
          {commentText && (
            <div className="delete-comment-modal-preview">
              <div className="delete-comment-modal-preview-label">Comment:</div>
              <div className="delete-comment-modal-preview-text">
                {commentText.length > 100 ? `${commentText.substring(0, 100)}...` : commentText}
              </div>
            </div>
          )}
        </div>
        <div className="delete-comment-modal-footer">
          <button
            className="delete-comment-modal-button cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="delete-comment-modal-button confirm"
            onClick={handleConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

