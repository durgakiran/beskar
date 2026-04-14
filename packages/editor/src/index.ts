// Main exports
export { Editor } from './core/Editor';

// Components
export { BubbleMenu, BubbleMenuButton } from './components/BubbleMenu';
export type { BubbleMenuProps, BubbleMenuButtonProps } from './components/BubbleMenu';
export { TextFormattingMenu } from './components/TextFormattingMenu';
export type { TextFormattingMenuProps } from './components/TextFormattingMenu';
export { CommentInputPopover } from './components/CommentInputPopover';
export type { CommentInputPopoverProps } from './components/CommentInputPopover';
export { CommentSidePanel } from './components/CommentSidePanel';
export type { CommentSidePanelProps } from './components/CommentSidePanel';
export { CommentGutter } from './components/CommentGutter';
export type { CommentGutterProps } from './components/CommentGutter';
export { CommentThreadCard } from './components/CommentThreadCard';
export type { CommentThreadCardProps } from './components/CommentThreadCard';
export { OverlapDisambiguationPopover } from './components/OverlapDisambiguationPopover';
export type { OverlapDisambiguationPopoverProps } from './components/OverlapDisambiguationPopover';

// Table Components
export { TableToolbar } from './components/table/TableToolbar';
export { TableFloatingMenu } from './components/table/TableFloatingMenu';
export { RowDragHandle } from './components/table/RowDragHandle';
export { ColumnDragHandle } from './components/table/ColumnDragHandle';
export { ColorPicker } from './components/table/ColorPicker';

// Code Block Components
export { CodeBlockFloatingMenu } from './components/codeblock/CodeBlockFloatingMenu';

// Note Block Components
export { NoteBlock } from './nodes/NoteBlock';
export * from './nodes/note/utils';
export * from './components/note';

// Image Block Components
export { ImageBlock } from './nodes/ImageBlock';
export * from './components/image/utils';
export * from './components/image';

// Attachment inline chip
export { AttachmentInline } from './nodes/AttachmentInline';
export { StatusBadge } from './nodes/StatusBadge';
export type { StatusBadgeColor } from './nodes/statusBadgeConstants';

// Types
export type {
  Editor as TiptapEditor,
  UserInfo,
  CollaborationConfig,
  EditorProps,
  EditorContentProps,
  ImageAPIHandler,
  ImageUploadResult,
  AttachmentAPIHandler,
  AttachmentUploadResult,
  AttachmentUploadOptions,
  AttachmentRef,
  CommentAPIHandler,
  CommentAnchor,
  CommentThread,
  CommentReply,
} from './types';

// Hooks
export { useEditor, useDebounce } from './hooks';

// Extensions
export { getExtensions, CustomAttributes, CommentMark } from './extensions';

// Utilities
export { useDebounce as useDebounceUtil } from './utils/debounce';
export { resolveAnchor, extractAnchor } from './utils/anchorResolution';
export { commentDecorationKey } from './extensions/comment-decoration';

// Re-export common TipTap exports that users might need
export { EditorContent } from '@tiptap/react';
export type { JSONContent } from '@tiptap/core';
