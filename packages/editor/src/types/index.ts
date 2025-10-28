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

export interface ImageUploadResult {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface ImageAPIHandler {
  uploadImage: (file: File) => Promise<ImageUploadResult>;
  getImageUrl?: (url: string) => string; // Optional CDN transformation
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
  imageHandler?: ImageAPIHandler;
}

export interface EditorContentProps {
  editor: TiptapEditor | null;
  className?: string;
}

export type { TiptapEditor as Editor };

