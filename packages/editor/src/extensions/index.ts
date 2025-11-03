import { StarterKit } from '@tiptap/starter-kit';
import { TextAlign } from '@tiptap/extension-text-align';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { Typography } from '@tiptap/extension-typography';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { ListItem } from '@tiptap/extension-list-item';
import type { Extensions } from '@tiptap/core';
import type { CollaborationConfig, ImageAPIHandler } from '../types';
import { CustomAttributes } from './custom-attributes';
import { ImagePasteDrop } from './image-paste-drop';
import { Table, TableCell, TableHeader, TableRow } from '../nodes/table';
import { SlashCommand } from './slash-command';
import { BlockId } from './block-id';
import { BlockDragDrop } from './block-drag-drop';
import Emoji, { gitHubEmojis } from '@tiptap/extension-emoji';
import {
  BlockHeading,
  BlockParagraph,
  BlockBlockquote,
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
import { ImageBlock } from '../nodes/ImageBlock';
import { MathBlock } from '../nodes/MathBlock';
import { TableOfContents } from '../nodes/TableOfContents';
import { InlineMath } from './math-inline';

export { CustomAttributes };
export { Table, TableCell, TableHeader, TableRow } from '../nodes/table';
export { MathBlock };
export { InlineMath };
export { TableOfContents };
export * from '../nodes/table/utils';
export { NoteBlock } from '../nodes/NoteBlock';
export * from '../nodes/note/utils';
export { ImageBlock } from '../nodes/ImageBlock';
export * from '../components/image/utils';
export { SlashCommand } from './slash-command';
export { ImagePasteDrop } from './image-paste-drop';
export { BlockId } from './block-id';
export { BlockDragDrop } from './block-drag-drop';

export interface GetExtensionsOptions {
  placeholder?: string;
  collaboration?: CollaborationConfig;
  additionalExtensions?: Extensions;
  imageHandler?: ImageAPIHandler;
}

/**
 * Get the default extensions for the editor
 */
export function getExtensions(options: GetExtensionsOptions = {}): Extensions {
  const {
    placeholder = 'Write something....',
    collaboration,
    additionalExtensions = [],
    imageHandler,
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
    BlockListItem, // Used by BlockBulletList and BlockOrderedList
    ListItem, // Required by TaskItem (TaskItem extends ListItem)
    BlockHorizontalRule,
    BlockDetails,
    BlockDetailsSummary,
    BlockDetailsContent,
    TaskList, // Task list with checkboxes (requires TaskItem)
    TaskItem, // Task item (checkbox item) - extends ListItem
    NoteBlock, // Custom note block with themes and styling
    ImageBlock, // Custom image block with upload and resize
    MathBlock, // Custom math block for LaTeX formulas
    TableOfContents, // Auto-generated table of contents
    InlineMath, // Inline math formulas within text
    ImagePasteDrop.configure({
      imageHandler,
    }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'right', 'center', 'justify'],
    }),
    Underline,
    TextStyle,
    Color,
    Highlight.configure({
      multicolor: true, // Allow multiple highlight colors
    }),
    Typography, // Auto-convert text patterns like -> to →, (c) to ©, etc.
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
          color: collaboration.user.color || (() => {
            // Generate lighter colors (RGB values 150-255) for better text visibility
            const r = Math.floor(Math.random() * 106) + 150; // 150-255
            const g = Math.floor(Math.random() * 106) + 150; // 150-255
            const b = Math.floor(Math.random() * 106) + 150; // 150-255
            return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
          })(),
        },
      }),
    ];

    return [...baseExtensions, ...collaborationExtensions, ...additionalExtensions];
  }

  return [...baseExtensions, ...additionalExtensions];
}

export * from './custom-attributes';

