// Main exports
export { Editor } from './core/Editor';

// Components
export { BubbleMenu, BubbleMenuButton } from './components/BubbleMenu';
export type { BubbleMenuProps, BubbleMenuButtonProps } from './components/BubbleMenu';

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

