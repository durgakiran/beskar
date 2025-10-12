import type { Editor as TiptapEditor } from '@tiptap/core';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { Extensions } from '@tiptap/core';

export interface UserInfo {
  id: string;
  name: string;
  email?: string;
  username?: string;
  color?: string;
}

export interface CollaborationConfig {
  provider: HocuspocusProvider;
  user: UserInfo;
  field?: string;
}

export interface EditorProps {
  initialContent?: any;
  editable?: boolean;
  placeholder?: string;
  collaboration?: CollaborationConfig;
  onUpdate?: (content: any) => void;
  onReady?: (editor: TiptapEditor) => void;
  extensions?: Extensions;
  className?: string;
  autoFocus?: boolean | 'start' | 'end' | number;
}

export interface EditorContentProps {
  editor: TiptapEditor | null;
  className?: string;
}

export type { TiptapEditor as Editor };

