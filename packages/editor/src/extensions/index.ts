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
import { Extension, type Extensions } from '@tiptap/core';
import type { AttachmentAPIHandler, AttachmentRef, CollaborationConfig, ImageAPIHandler } from '../types';
import { CustomAttributes } from './custom-attributes';
import { ImagePasteDrop } from './image-paste-drop';
import { AttachmentPasteDrop } from './attachment-paste-drop';
import { Table, TableCell, TableHeader, TableRow } from '../nodes/table';
import { SlashCommand } from './slash-command';
import { BlockId } from './block-id';
import { BlockDragDrop } from './block-drag-drop';
import Emoji, { gitHubEmojis } from '@tiptap/extension-emoji';
import { Placeholder } from '@tiptap/extensions';
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
import { ImageInline } from '../nodes/ImageInline';
import { AttachmentInline } from '../nodes/AttachmentInline';
import { StatusBadge } from '../nodes/StatusBadge';
import { MathBlock } from '../nodes/MathBlock';
import { TableOfContents } from '../nodes/TableOfContents';
import { InlineMath } from './math-inline';
import { Columns } from '../nodes/layout/Columns';
import { Column } from '../nodes/layout/Column';
import { CommentMark } from './comment';

export { CustomAttributes };
export { Table, TableCell, TableHeader, TableRow } from '../nodes/table';
export { MathBlock };
export { InlineMath };
export { TableOfContents };
export * from '../nodes/table/utils';
export { NoteBlock } from '../nodes/NoteBlock';
export * from '../nodes/note/utils';
export { ImageBlock } from '../nodes/ImageBlock';
export { ImageInline } from '../nodes/ImageInline';
export { AttachmentInline } from '../nodes/AttachmentInline';
export { StatusBadge } from '../nodes/StatusBadge';
export * from '../components/image/utils';
export { SlashCommand } from './slash-command';
export { ImagePasteDrop, getImagePasteStorage, insertImageAt } from './image-paste-drop';
export { AttachmentPasteDrop } from './attachment-paste-drop';
export { BlockId } from './block-id';
export { BlockDragDrop } from './block-drag-drop';
export { Columns } from '../nodes/layout/Columns';
export { Column } from '../nodes/layout/Column';

/** Exposes editor-level UI strings (e.g. column placeholders) to NodeViews via `editor.storage.editorUi`. */
const EditorUi = Extension.create({
  name: 'editorUi',
  addOptions() {
    return {
      placeholder: 'Write something....',
      /** Hint inside layout column cells (Confluence-style short line). */
      columnLayoutPlaceholder: '/ to insert',
      columnCodeBlockPlaceholder: 'Add code…',
      columnMathBlockPlaceholder: 'Add equation…',
      columnTableOfContentsPlaceholder: 'Add headings above to populate…',
      columnDetailsSummaryPlaceholder: 'Add summary…',
    };
  },
  addStorage() {
    return {
      placeholder: 'Write something....',
      columnLayoutPlaceholder: '/ to insert',
      columnCodeBlockPlaceholder: 'Add code…',
      columnMathBlockPlaceholder: 'Add equation…',
      columnTableOfContentsPlaceholder: 'Add headings above to populate…',
      columnDetailsSummaryPlaceholder: 'Add summary…',
    };
  },
  onCreate() {
    this.storage.placeholder = this.options.placeholder;
    this.storage.columnLayoutPlaceholder = this.options.columnLayoutPlaceholder;
    this.storage.columnCodeBlockPlaceholder = this.options.columnCodeBlockPlaceholder;
    this.storage.columnMathBlockPlaceholder = this.options.columnMathBlockPlaceholder;
    this.storage.columnTableOfContentsPlaceholder = this.options.columnTableOfContentsPlaceholder;
    this.storage.columnDetailsSummaryPlaceholder = this.options.columnDetailsSummaryPlaceholder;
  },
});

export interface GetExtensionsOptions {
  placeholder?: string;
  /** Placeholder shown in empty paragraphs inside column layouts (default: `/ to insert`). */
  columnLayoutPlaceholder?: string;
  /** Empty code block inside a column (default: `Add code…`). */
  columnCodeBlockPlaceholder?: string;
  /** Empty math block inside a column (default: `Add equation…`). */
  columnMathBlockPlaceholder?: string;
  /** Empty TOC block inside a column (default: short hint). */
  columnTableOfContentsPlaceholder?: string;
  /** Empty details/summary toggle label inside a column (default: `Add summary…`). */
  columnDetailsSummaryPlaceholder?: string;
  collaboration?: CollaborationConfig;
  additionalExtensions?: Extensions;
  imageHandler?: ImageAPIHandler;
  attachmentHandler?: AttachmentAPIHandler;
  maxAttachmentBytes?: number;
  onAttachmentRejected?: (reason: 'too_large', file: File) => void;
  allowedMimeAccept?: string;
  onAttachmentsChange?: (attachments: AttachmentRef[]) => void;
  onAddCommentShortcut?: () => void;
  onNextCommentShortcut?: () => void;
  onPrevCommentShortcut?: () => void;
}

/**
 * Get the default extensions for the editor
 */
export function getExtensions(options: GetExtensionsOptions = {}): Extensions {
  const {
    placeholder = 'Write something....',
    columnLayoutPlaceholder = '/ to insert',
    columnCodeBlockPlaceholder = 'Add code…',
    columnMathBlockPlaceholder = 'Add equation…',
    columnTableOfContentsPlaceholder = 'Add headings above to populate…',
    columnDetailsSummaryPlaceholder = 'Add summary…',
    collaboration,
    additionalExtensions = [],
    imageHandler,
    attachmentHandler,
    maxAttachmentBytes,
    onAttachmentRejected,
    allowedMimeAccept = '*',
    onAttachmentsChange,
    onAddCommentShortcut,
    onNextCommentShortcut,
    onPrevCommentShortcut,
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
    EditorUi.configure({
      placeholder,
      columnLayoutPlaceholder,
      columnCodeBlockPlaceholder,
      columnMathBlockPlaceholder,
      columnTableOfContentsPlaceholder,
      columnDetailsSummaryPlaceholder,
    }),
    Placeholder.configure({
      // Defaults skip nested blocks: returning `includeChildren: false` from the
      // descendants callback stops ProseMirror from recursing, so empty paragraphs
      // inside `columns` never received `is-empty`. Traverse the full tree.
      includeChildren: true,
      // Show every empty text block in the doc (including all column cells), not only
      // the block that contains the caret.
      showOnlyCurrent: false,
      placeholder: ({ node, pos, editor }) => {
        // Do not show placeholder inside noteBlock — the is-empty class lands on the
        // react-renderer wrapper (not the inner content), causing it to render outside
        // the visual note block due to float:left; height:0 on the ::before rule.
        if (node.type.name === 'noteBlock') return '';
        // Layout wrappers can be marked empty when every cell is empty; keep attr empty
        // so global ::before does not run (see editor.css).
        if (node.type.name === 'columns' || node.type.name === 'column') return '';
        // Details NodeView wrapper + body container get recursive is-empty; CSS suppresses
        // pseudo-elements — empty attr avoids redundant placeholder text on those nodes.
        if (node.type.name === 'details' || node.type.name === 'detailsContent') return '';
        // Blockquote & lists: same recursive is-empty on wrapper + li + inner block (see editor.css).
        if (
          node.type.name === 'blockquote' ||
          node.type.name === 'bulletList' ||
          node.type.name === 'orderedList' ||
          node.type.name === 'listItem' ||
          node.type.name === 'taskList' ||
          node.type.name === 'taskItem'
        ) {
          return '';
        }
        // Inside columns: never use global ::before (float breaks flex). CSS uses ::after +
        // attr(data-placeholder). Per-block hints here; nested p/headings in lists/blockquotes work.
        try {
          const $pos = editor.state.doc.resolve(pos);
          let inColumn = false;
          let inTableCell = false;
          for (let d = $pos.depth; d > 0; d--) {
            const nm = $pos.node(d).type.name;
            if (nm === 'column') inColumn = true;
            if (nm === 'tableCell' || nm === 'tableHeader') inTableCell = true;
          }
          if (inColumn && inTableCell) {
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              return placeholder;
            }
            if (node.type.name === 'detailsSummary') {
              return columnDetailsSummaryPlaceholder;
            }
            return '';
          }
          if (inColumn) {
            const n = node.type.name;
            if (n === 'paragraph' || n === 'heading') {
              return columnLayoutPlaceholder;
            }
            if (n === 'codeBlock') {
              return columnCodeBlockPlaceholder;
            }
            if (n === 'mathBlock') {
              return columnMathBlockPlaceholder;
            }
            if (n === 'tableOfContents') {
              return columnTableOfContentsPlaceholder;
            }
            if (n === 'detailsSummary') {
              return columnDetailsSummaryPlaceholder;
            }
            return '';
          }
        } catch {
          /* ignore resolve errors during transient states */
        }
        return placeholder;
      },
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
    ImageInline, // Inline image that flows within text (like Confluence)
    AttachmentInline, // Non-image file attachments as inline chips
    StatusBadge, // Inline status pill (e.g. IN PROGRESS, DONE)
    MathBlock, // Custom math block for LaTeX formulas
    TableOfContents, // Auto-generated table of contents
    InlineMath, // Inline math formulas within text
    ImagePasteDrop.configure({
      imageHandler,
      attachmentHandler,
      maxAttachmentBytes,
      onAttachmentRejected,
    }),
    AttachmentPasteDrop.configure({
      attachmentHandler,
      maxAttachmentBytes,
      onAttachmentRejected,
      allowedMimeAccept,
      onAttachmentsChange,
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
    Columns,
    Column,
    SlashCommand, // Slash command menu for inserting content
    CommentMark.configure({
      onAddCommentShortcut,
      onNextCommentShortcut,
      onPrevCommentShortcut,
    }), // Inline comments
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
export * from './comment';
export { exitNodeAfter } from './node-escape';
