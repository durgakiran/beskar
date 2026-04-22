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

// ─── Internal Resource Embeds ────────────────────────────────────────────────

export type InternalResourceType = 'document' | 'whiteboard';

export interface InternalResourceResult {
  resourceId: string;
  resourceType: InternalResourceType;
  title: string;
  icon?: string;
  lastEditedAt?: string;
}

export interface InternalResourceMetadata extends InternalResourceResult {
  excerpt?: string;
  thumbnailUrl?: string;
  updatedByName?: string;
  updatedByAvatarUrl?: string;
}

export interface InternalResourceHandler {
  appBaseUrl: string;
  searchResources: (
    query: string,
    resourceType: InternalResourceType,
  ) => Promise<InternalResourceResult[]>;
  getResourceMetadata: (
    resourceId: string,
    resourceType: InternalResourceType,
  ) => Promise<InternalResourceMetadata | null>;
  navigateToResource: (
    resourceId: string,
    resourceType: InternalResourceType,
  ) => void;
}

// ─── Child Pages List ────────────────────────────────────────────────────────

export interface ChildPageResult {
  pageId: string;
  title: string;
  /** Zero-based depth relative to the current page. Omit or use 0 for immediate children. */
  depth?: number;
  lastEditedAt?: string;
  updatedByName?: string;
  children?: ChildPageResult[];
}

export interface ChildPagesHandler {
  /**
   * The consuming app should bind current page context into this handler.
   * The editor intentionally does not know page IDs or auth tokens.
   */
  /** Preferred: return all descendant pages in display order, with depth populated. */
  getPageHierarchy?: () => Promise<ChildPageResult[]>;
  /** Backward-compatible fallback for consumers that only expose immediate children. */
  getChildPages?: () => Promise<ChildPageResult[]>;
  navigateToChildPage: (pageId: string) => void;
}

// ─── Inline Comments ──────────────────────────────────────────────────────────

export interface CommentReplyAttachment {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
}

export interface CommentReply {
  id: string;
  threadId: string;
  authorId: string | null;      // null = deleted user
  authorName: string | null;    // null = deleted user
  body: string;
  editedAt?: string;            // ISO timestamp
  createdAt: string;            // ISO timestamp
  attachments?: CommentReplyAttachment[];
}

export interface CommentAnchor {
  quotedText: string;
  prefixText: string;
  suffixText: string;
  blockId: string;
  start: number;
  end: number;
  versionHint: 'draft' | 'published';
}

export interface CommentThread {
  id: string;
  documentId: string;
  commentId: string;            // UUID stored as TipTap mark attribute
  anchor: CommentAnchor;        // Source of truth for anchoring
  publishedVisible: boolean;    // Controls view-mode visibility
  createdBy: string | null;     // null = deleted user
  createdByName: string | null; // null = deleted user
  resolvedBy?: string | null;
  resolvedAt?: string | null;   // ISO timestamp
  createdAt: string;            // ISO timestamp
  orphaned?: boolean;           // true when resolution fails
  replies: CommentReply[];
}

export interface CommentAPIHandler {
  getThreads: (documentId: string) => Promise<CommentThread[]>;
  createThread: (
    documentId: string,
    commentId: string,
    anchor: CommentAnchor,
    body: string,
    attachments?: CommentReplyAttachment[],
  ) => Promise<CommentThread>;

  resolveThread: (threadId: string) => Promise<CommentThread>;
  orphanThread: (threadId: string) => Promise<CommentThread>;
  deleteThread: (threadId: string) => Promise<void>;
  addReply: (threadId: string, body: string, attachments?: CommentReplyAttachment[]) => Promise<CommentReply>;
  editReply: (replyId: string, body: string, attachments?: CommentReplyAttachment[]) => Promise<CommentReply>;

  deleteReply: (replyId: string) => Promise<void>;
  unresolveThread: (threadId: string) => Promise<CommentThread>;
  /**
   * Optional: called by the editor when the document is saved and the text
   * underneath a highlight has changed (e.g. a character was deleted inside the
   * highlighted span). Implementations should persist the new anchor so that
   * resolveAnchor can find the highlight after a page reload.
   */
  updateThreadAnchor?: (threadId: string, anchor: CommentAnchor) => Promise<void>;
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
  internalResourceHandler?: InternalResourceHandler;
  childPagesHandler?: ChildPagesHandler;
  commentHandler?: CommentAPIHandler;
}

export interface EditorContentProps {
  editor: TiptapEditor | null;
  className?: string;
}

export type { TiptapEditor as Editor };
