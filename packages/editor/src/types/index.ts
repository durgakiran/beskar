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

export interface AttachmentUploadResult {
  url: string;
  attachmentId: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
}

export interface AttachmentUploadOptions {
  signal?: AbortSignal;
}

export interface AttachmentAPIHandler {
  uploadAttachment: (
    file: File,
    options?: AttachmentUploadOptions,
  ) => Promise<AttachmentUploadResult>;
  getAttachmentUrl?: (url: string) => string;
  downloadAttachment?: (params: { url: string; fileName: string }) => void | Promise<void>;
}

/** Lightweight reference to a successfully uploaded attachment — emitted via `onAttachmentsChange`. */
export interface AttachmentRef {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileUrl: string;
}

// ─── Inline Comments ──────────────────────────────────────────────────────────

export interface CommentReply {
  id: string;
  threadId: string;
  authorId: string | null;      // null = deleted user
  authorName: string | null;    // null = deleted user
  body: string;
  editedAt?: string;            // ISO timestamp
  createdAt: string;            // ISO timestamp
}

export interface CommentThread {
  id: string;
  documentId: string;
  commentId: string;            // UUID stored as TipTap mark attribute
  quotedText: string;
  createdBy: string | null;     // null = deleted user
  createdByName: string | null; // null = deleted user
  resolvedBy?: string | null;
  resolvedAt?: string | null;   // ISO timestamp
  createdAt: string;            // ISO timestamp
  orphaned?: boolean;           // true when the anchoring text was deleted
  replies: CommentReply[];
}

export interface CommentAPIHandler {
  getThreads: (documentId: string) => Promise<CommentThread[]>;
  createThread: (documentId: string, commentId: string, quotedText: string, body: string) => Promise<CommentThread>;
  resolveThread: (threadId: string) => Promise<CommentThread>;
  deleteThread: (threadId: string) => Promise<void>;
  addReply: (threadId: string, body: string) => Promise<CommentReply>;
  editReply: (replyId: string, body: string) => Promise<CommentReply>;
  deleteReply: (replyId: string) => Promise<void>;
  unresolveThread: (threadId: string) => Promise<CommentThread>;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface EditorProps {
  initialContent?: any;
  editable?: boolean;
  placeholder?: string;
  /** Hint in empty paragraphs inside column layouts (default: `/ to insert`). */
  columnLayoutPlaceholder?: string;
  columnCodeBlockPlaceholder?: string;
  columnMathBlockPlaceholder?: string;
  columnTableOfContentsPlaceholder?: string;
  columnDetailsSummaryPlaceholder?: string;
  collaboration?: CollaborationConfig;
  onUpdate?: (content: any) => void;
  onReady?: (editor: TiptapEditor) => void;
  extensions?: Extensions;
  className?: string;
  autoFocus?: boolean | 'start' | 'end' | number;
  imageHandler?: ImageAPIHandler;
  /** When set, file attachments (slash /file, paste, drop) are enabled. */
  attachmentHandler?: AttachmentAPIHandler;
  /** Client-side max size; omit to skip the check. */
  maxAttachmentBytes?: number;
  onAttachmentRejected?: (reason: 'too_large', file: File) => void;
  /** Passed to `<input type="file" accept="...">` for the slash picker (hint only). */
  allowedMimeAccept?: string;
  /** Called whenever the set of successfully uploaded attachments in the document changes. */
  onAttachmentsChange?: (attachments: AttachmentRef[]) => void;
  commentHandler?: CommentAPIHandler;
}

export interface EditorContentProps {
  editor: TiptapEditor | null;
  className?: string;
}

export type { TiptapEditor as Editor };

