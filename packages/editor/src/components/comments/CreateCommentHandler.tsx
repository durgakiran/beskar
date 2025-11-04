import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/core';
import { CreateCommentPopup } from './CreateCommentPopup';

export interface CreateCommentHandlerProps {
  editor: Editor;
  show: boolean;
  position?: { x: number; y: number };
  onClose: () => void;
  onSubmit: (commentText: string) => Promise<void>;
  authorName?: string;
  authorEmail?: string;
  authorInitials?: string;
}

/**
 * Create Comment Handler Component
 * Manages the display of CreateCommentPopup when user wants to add a comment
 */
export function CreateCommentHandler({
  editor,
  show,
  position,
  onClose,
  onSubmit,
  authorName,
  authorEmail,
  authorInitials,
}: CreateCommentHandlerProps) {
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!show) {
      setPopupPosition(null);
      return;
    }

    // Calculate position based on selection
    const { state, view } = editor;
    const { selection } = state;

    if (selection.empty) {
      onClose();
      return;
    }

    const { from, to } = selection;
    const rect = view.coordsAtPos(from);
    const endRect = view.coordsAtPos(to);

    // Get editor container to position relative to it
    const editorContainer = view.dom.closest('.beskar-editor') || view.dom.parentElement;
    if (!editorContainer) {
      onClose();
      return;
    }

    const containerRect = (editorContainer as HTMLElement).getBoundingClientRect();
    
    // Calculate position relative to editor container (not viewport)
    // Position at LEFT of selected text, next to the selection
    const calculatedPosition = position || {
      x: rect.left - containerRect.left, // Position relative to container
      y: rect.top - containerRect.top - 10, // Position above selection
    };

    // Adjust position to avoid overlap with bubble menu
    // Position to the right side of the selected text
    const spacing = 20;
    const popupWidth = 400; // Approximate width
    
    let adjustedPosition: { x: number; y: number };
    
    // Position to the right of the selected text
    const rightSideX = endRect.right - containerRect.left + spacing;
    const leftSideX = rect.left - containerRect.left - popupWidth - spacing;
    
    // Check if there's space on the right
    const spaceOnRight = containerRect.right - endRect.right;
    const spaceOnLeft = rect.left - containerRect.left;
    
    if (spaceOnRight > popupWidth + spacing) {
      // Position to the right
      adjustedPosition = {
        x: rightSideX,
        y: calculatedPosition.y,
      };
    } else if (spaceOnLeft > popupWidth + spacing) {
      // Position to the left
      adjustedPosition = {
        x: leftSideX,
        y: calculatedPosition.y,
      };
    } else {
      // Default to right side, even if it goes slightly outside
      adjustedPosition = {
        x: rightSideX,
        y: calculatedPosition.y,
      };
    }

    setPopupPosition(adjustedPosition);
  }, [show, editor, position, onClose]);

  if (!show || !popupPosition) {
    return null;
  }

  const handleSubmit = async (commentText: string) => {
    await onSubmit(commentText);
    // Popup will be closed by parent component after submission
  };

  // Find editor container to render popup inside it
  const editorContainer = editor.view.dom.closest('.beskar-editor') as HTMLElement;
  
  if (!editorContainer) {
    return null;
  }

  // Use React Portal to render inside editor container for proper absolute positioning
  return createPortal(
    <CreateCommentPopup
      position={popupPosition}
      onClose={onClose}
      onSubmit={handleSubmit}
      placeholder="Type /ai for Atlassian Intelligence, / to add elements, or @ to mention someone (we'll let them know)."
      authorName={authorName}
      authorEmail={authorEmail}
      authorInitials={authorInitials}
    />,
    editorContainer
  );
}

