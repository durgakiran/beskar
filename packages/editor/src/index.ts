// Main exports
export { Editor } from './core/Editor';

// Components
export { BubbleMenu, BubbleMenuButton } from './components/BubbleMenu';
export type { BubbleMenuProps, BubbleMenuButtonProps } from './components/BubbleMenu';
export { TextFormattingMenu } from './components/TextFormattingMenu';

// Table Components
export { TableToolbar } from './components/table/TableToolbar';
export { TableFloatingMenu } from './components/table/TableFloatingMenu';
export { RowDragHandle } from './components/table/RowDragHandle';
export { ColumnDragHandle } from './components/table/ColumnDragHandle';
export { ColorPicker } from './components/table/ColorPicker';

// Code Block Components
export { CodeBlockFloatingMenu } from './components/codeblock/CodeBlockFloatingMenu';

// Comment Components
export { CommentThread } from './components/comments/CommentThread';
export { CommentSidebar } from './components/comments/CommentSidebar';
export { EndOfPageComments } from './components/comments/EndOfPageComments';
export { CommentPopup } from './components/comments/CommentPopup';
export { CommentClickHandler } from './components/comments/CommentHoverHandler';
export type { CommentClickHandlerProps } from './components/comments/CommentHoverHandler';
export { CreateCommentPopup } from './components/comments/CreateCommentPopup';
export { CreateCommentHandler } from './components/comments/CreateCommentHandler';
export { EmojiPicker } from './components/comments/EmojiPicker';
export type { ReactionSummary } from './components/comments/EmojiPicker';
export { DeleteCommentModal } from './components/comments/DeleteCommentModal';
export type { Comment } from './components/comments/CommentThread';

// Note Block Components
export { NoteBlock } from './nodes/NoteBlock';
export * from './nodes/note/utils';
export * from './components/note';

// Image Block Components
export { ImageBlock } from './nodes/ImageBlock';
export * from './components/image/utils';
export * from './components/image';

// Types
export type {
  Editor as TiptapEditor,
  UserInfo,
  CollaborationConfig,
  EditorProps,
  EditorContentProps,
  ImageAPIHandler,
  ImageUploadResult,
} from './types';

// Hooks
export { useEditor, useDebounce } from './hooks';

// Extensions
export { getExtensions, CustomAttributes } from './extensions';

// Utilities
export { useDebounce as useDebounceUtil } from './utils/debounce';

// Re-export common TipTap exports that users might need
export { EditorContent } from '@tiptap/react';
export type { JSONContent } from '@tiptap/core';
