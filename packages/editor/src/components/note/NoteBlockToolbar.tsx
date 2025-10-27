/**
 * NoteBlockToolbar - Bottom toolbar for note block customization
 */

import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FiMoreVertical, FiCopy, FiTrash2, FiDroplet, FiSmile, FiXCircle } from 'react-icons/fi';
import { Editor } from '@tiptap/core';
import { ThemePresets, THEME_PRESETS, type Theme } from './ThemePresets';
import { EmojiSelector } from './EmojiSelector';
import { NoteColorPicker } from './NoteColorPicker';
import { copyNoteBlock, deleteNoteBlock } from '../../nodes/note/utils';

export interface NoteBlockToolbarProps {
  editor: Editor;
  updateAttributes: (attrs: Record<string, any>) => void;
  currentTheme?: string;
  currentIcon?: string;
  currentBackgroundColor?: string;
}

export function NoteBlockToolbar({
  editor,
  updateAttributes,
  currentTheme = 'note',
  currentIcon = 'note',
  currentBackgroundColor,
}: NoteBlockToolbarProps) {
  const handleThemeSelect = (theme: Theme) => {
    updateAttributes({
      theme: theme.name,
      icon: theme.icon,
      backgroundColor: theme.backgroundColor,
    });
  };

  const handleEmojiSelect = (emoji: string) => {
    updateAttributes({
      icon: 'emoji',
      emoji,
    });
  };

  const handleRemoveEmoji = () => {
    // Reset to theme icon
    const theme = THEME_PRESETS.find((t) => t.name === currentTheme);
    if (theme) {
      updateAttributes({
        icon: theme.icon,
        emoji: theme.IconComponent ? '' : '📝',
      });
    }
  };

  const handleColorChange = (color: string) => {
    updateAttributes({
      backgroundColor: color,
      theme: 'custom',
    });
  };

  const handleCopy = () => {
    console.log('[NoteBlockToolbar] Copy button clicked');
    try {
      const result = copyNoteBlock(editor);
      console.log('[NoteBlockToolbar] Copy result:', result);
    } catch (error) {
      console.error('[NoteBlockToolbar] Failed to copy:', error);
    }
  };

  const handleDelete = () => {
    try {
      deleteNoteBlock(editor);
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  // Get current theme label
  const currentThemeObj = THEME_PRESETS.find((t) => t.name === currentTheme);
  const themeLabel = currentThemeObj?.label || 'Theme';

  return (
    <div className="note-block-toolbar-bottom">
      {/* Theme Selector */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="note-toolbar-button" type="button">
            {currentThemeObj && <currentThemeObj.IconComponent size={14} />}
            <span>{themeLabel}</span>
            <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
              <path d="M5 6L0 0h10L5 6z" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="note-dropdown-content" sideOffset={5}>
            <ThemePresets onSelect={handleThemeSelect} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Emoji Selector */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="note-toolbar-button" type="button" aria-label="Select emoji">
            <FiSmile size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="note-dropdown-content" sideOffset={5}>
            <EmojiSelector onSelect={handleEmojiSelect} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Remove Emoji / Reset to Theme Icon */}
      <button 
        className="note-toolbar-button" 
        type="button" 
        aria-label="Remove custom emoji"
        onClick={handleRemoveEmoji}
        disabled={currentIcon !== 'emoji'}
      >
        <FiXCircle size={16} />
      </button>

      {/* Color Picker */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="note-toolbar-button" type="button" aria-label="Background color">
            <FiDroplet size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="note-dropdown-content" sideOffset={5}>
            <NoteColorPicker
              currentColor={currentBackgroundColor}
              onColorChange={handleColorChange}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* More Menu */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="note-toolbar-button" type="button" aria-label="More options">
            <FiMoreVertical size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="note-dropdown-content" sideOffset={5}>
            <DropdownMenu.Item className="note-dropdown-item" onSelect={handleCopy}>
              <FiCopy size={14} />
              <span>Copy</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="note-dropdown-item note-dropdown-item-danger"
              onSelect={handleDelete}
            >
              <FiTrash2 size={14} />
              <span>Delete</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

