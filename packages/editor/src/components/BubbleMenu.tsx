'use client';

import React, { useEffect, useState } from 'react';
import { Editor } from '@tiptap/core';
import { posToDOMRect } from '@tiptap/core';
import * as Popover from '@radix-ui/react-popover';
import './BubbleMenu.css';

export interface BubbleMenuProps {
  editor: Editor;
  children: React.ReactNode;
  className?: string;
  shouldShow?: (props: {
    editor: Editor;
    from: number;
    to: number;
  }) => boolean;
}

/**
 * Bubble Menu Component
 * 
 * Shows a floating menu when text is selected in the editor.
 * Uses Radix UI Popover for positioning and accessibility.
 */
export function BubbleMenu({
  editor,
  children,
  className = '',
  shouldShow,
}: BubbleMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const updateMenu = () => {
      const { state, view } = editor;
      const { selection } = state;
      const { empty } = selection;

      // Don't show on empty selection
      if (empty) {
        setIsOpen(false);
        return;
      }

      // Check if text is actually selected
      const { from, to } = selection;
      const text = state.doc.textBetween(from, to);
      
      if (!text) {
        setIsOpen(false);
        return;
      }

      // Custom shouldShow logic
      if (shouldShow && !shouldShow({ editor, from, to })) {
        setIsOpen(false);
        return;
      }

      // Don't show in tables or special nodes
      if (editor.isActive('table') || editor.isActive('mermaid')) {
        setIsOpen(false);
        return;
      }

      // Get selection rect for positioning
      const rect = posToDOMRect(view, from, to);
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top,
      });

      setIsOpen(true);
    };

    // Update on selection change
    editor.on('selectionUpdate', updateMenu);
    editor.on('transaction', updateMenu);
    editor.on('focus', updateMenu);
    editor.on('blur', () => setIsOpen(false));

    return () => {
      editor.off('selectionUpdate', updateMenu);
      editor.off('transaction', updateMenu);
      editor.off('focus', updateMenu);
      editor.off('blur', () => setIsOpen(false));
    };
  }, [editor, shouldShow]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={`bubble-menu-container ${className}`}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y - 10}px`,
        transform: 'translate(-50%, -100%)',
        zIndex: 50,
      }}
      onMouseDown={(e) => {
        // Prevent editor from losing focus
        e.preventDefault();
      }}
    >
      <div className="bubble-menu-content">
        {children}
      </div>
    </div>
  );
}

/**
 * Bubble Menu Button Component
 */
export interface BubbleMenuButtonProps {
  onClick: () => void;
  isActive?: boolean;
  children: React.ReactNode;
  title?: string;
}

export function BubbleMenuButton({
  onClick,
  isActive = false,
  children,
  title,
}: BubbleMenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bubble-menu-button ${isActive ? 'is-active' : ''}`}
      title={title}
    >
      {children}
    </button>
  );
}

