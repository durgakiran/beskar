// Main exports
export { Editor } from './core/Editor';

// Components
export { BubbleMenu, BubbleMenuButton } from './components/BubbleMenu';
export type { BubbleMenuProps, BubbleMenuButtonProps } from './components/BubbleMenu';

// Table Components
export { TableToolbar } from './components/table/TableToolbar';
export { TableFloatingMenu } from './components/table/TableFloatingMenu';
export { RowDragHandle } from './components/table/RowDragHandle';
export { ColumnDragHandle } from './components/table/ColumnDragHandle';
export { ColorPicker } from './components/table/ColorPicker';

// Note Block Components
export { NoteBlock } from './nodes/NoteBlock';
export * from './nodes/note/utils';
export * from './components/note';

// Types
export type {
  Editor as TiptapEditor,
  UserInfo,
  CollaborationConfig,
  EditorProps,
  EditorContentProps,
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

