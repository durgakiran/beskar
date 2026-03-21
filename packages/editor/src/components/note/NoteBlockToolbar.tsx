/**
 * NoteBlockToolbar - Bottom toolbar for note block customization
 */

import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
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
    <Toolbar.Root className="editor-floating-toolbar">
      {/* Copy Button */}
      <Toolbar.Button className="editor-floating-toolbar-button" onClick={handleCopy} aria-label="Copy note" title="Copy note">
        <FiCopy size={16} />
        <span>Copy</span>
      </Toolbar.Button>

      {/* Delete Button */}
      <Toolbar.Button className="editor-floating-toolbar-button" onClick={handleDelete} aria-label="Delete note" title="Delete note">
        <FiTrash2 size={16} />
        <span>Delete</span>
      </Toolbar.Button>

      <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />

      {/* Theme Selector */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="editor-floating-toolbar-button" type="button">
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
          <button className="editor-floating-toolbar-button" type="button" aria-label="Select emoji">
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
        className="editor-floating-toolbar-button" 
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
          <button className="editor-floating-toolbar-button" type="button" aria-label="Background color">
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
    </Toolbar.Root>
  );
}

