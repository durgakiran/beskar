import { StarterKit } from '@tiptap/starter-kit';
import { TextAlign } from '@tiptap/extension-text-align';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import type { Extensions } from '@tiptap/core';
import type { CollaborationConfig } from '../types';
import { CustomAttributes } from './custom-attributes';
import { Table, TableCell, TableHeader, TableRow } from '../nodes/table';
import { SlashCommand } from './slash-command';
import { BlockId } from './block-id';
import { BlockDragDrop } from './block-drag-drop';
import Emoji, { gitHubEmojis } from '@tiptap/extension-emoji';
import {
  BlockHeading,
  BlockParagraph,
  BlockBlockquote,
  BlockCodeBlock,
  BlockCodeBlockLowlight,
  BlockBulletList,
  BlockOrderedList,
  BlockHorizontalRule,
  BlockDetails,
  BlockDetailsSummary,
  BlockDetailsContent,
  BlockListItem,
} from '../nodes/block-nodes';
import { NoteBlock } from '../nodes/NoteBlock';

export { CustomAttributes };
export { Table, TableCell, TableHeader, TableRow } from '../nodes/table';
export * from '../nodes/table/utils';
export { NoteBlock } from '../nodes/NoteBlock';
export * from '../nodes/note/utils';
export { SlashCommand } from './slash-command';
export { BlockId } from './block-id';
export { BlockDragDrop } from './block-drag-drop';

export interface GetExtensionsOptions {
  placeholder?: string;
  collaboration?: CollaborationConfig;
  additionalExtensions?: Extensions;
}

/**
 * Get the default extensions for the editor
 */
export function getExtensions(options: GetExtensionsOptions = {}): Extensions {
  const {
    placeholder = 'Write something....',
    collaboration,
    additionalExtensions = [],
  } = options;

  const baseExtensions: Extensions = [
    CustomAttributes,
    BlockId, // Block-based editor with unique IDs for each block
    BlockDragDrop, // Drag and drop to rearrange blocks
    // Use StarterKit but exclude nodes we're replacing with block-enabled versions
    StarterKit.configure({
      heading: false,
      paragraph: false,
      blockquote: false,
      codeBlock: false,
      bulletList: false,
      orderedList: false,
      horizontalRule: false,
      listItem: false,
    }),
    // Add our custom block-enabled nodes
    BlockHeading,
    BlockParagraph,
    BlockBlockquote,
    BlockCodeBlockLowlight, // Use code block with syntax highlighting
    BlockBulletList,
    BlockOrderedList,
    BlockListItem,
    BlockHorizontalRule,
    BlockDetails,
    BlockDetailsSummary,
    BlockDetailsContent,
    NoteBlock, // Custom note block with themes and styling
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'right', 'center', 'justify'],
    }),
    Underline,
    TextStyle,
    Color,
    Emoji.configure({
      emojis: gitHubEmojis, // Use extended GitHub emoji set (includes custom ones like :octocat:)
      enableEmoticons: true, // Convert emoticons like :) to 😊, <3 to ❤️
      HTMLAttributes: {
        class: 'emoji-node',
      },
    }),
    Table, // Already configured with resizable: true in the custom extension
    TableRow,
    TableHeader,
    TableCell,
    SlashCommand, // Slash command menu for inserting content
  ];

  // Add collaboration extensions if provided
  if (collaboration) {
    const collaborationExtensions: Extensions = [
      Collaboration.configure({
        document: collaboration.provider?.document,
        field: collaboration.field || 'default',
      }),
      CollaborationCaret.configure({
        provider: collaboration.provider,
        user: {
          id: collaboration.user.id,
          name: collaboration.user.name,
          color: collaboration.user.color || `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
        },
      }),
    ];

    return [...baseExtensions, ...collaborationExtensions, ...additionalExtensions];
  }

  return [...baseExtensions, ...additionalExtensions];
}

export * from './custom-attributes';

