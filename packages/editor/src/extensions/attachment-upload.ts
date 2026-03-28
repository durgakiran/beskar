import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { AttachmentAPIHandler, AttachmentUploadResult } from '../types';

const pendingFiles = new Map<string, File>();

export function registerPendingAttachmentFile(placeholderId: string, file: File): void {
  pendingFiles.set(placeholderId, file);
}

export function getPendingAttachmentFile(placeholderId: string): File | undefined {
  return pendingFiles.get(placeholderId);
}

export function clearPendingAttachmentFile(placeholderId: string): void {
  pendingFiles.delete(placeholderId);
}

export function makeAttachmentPlaceholderAttrs(file: File, placeholderId: string) {
  return {
    attachmentId: null as string | null,
    fileUrl: '',
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || 'application/octet-stream',
    placeholderId,
    uploadStatus: 'uploading' as const,
    errorMessage: null as string | null,
  };
}

export function findAttachmentByPlaceholderId(
  doc: PMNode,
  placeholderId: string,
): { pos: number; node: PMNode } | null {
  let found: { pos: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === 'attachmentInline' && node.attrs.placeholderId === placeholderId) {
      found = { pos, node };
      return false;
    }
  });
  return found;
}

export interface AttachmentInsertOptions {
  handler: AttachmentAPIHandler;
  maxAttachmentBytes?: number;
  onAttachmentRejected?: (reason: 'too_large', file: File) => void;
}

/**
 * Insert one inline attachment placeholder at `pos` and start the upload.
 * Returns the document position immediately after the inserted node, or 0 if skipped.
 * `pos` must be inside a text block (paragraph, heading, etc.).
 */
export function insertAttachmentAtPos(
  view: EditorView,
  pos: number,
  file: File,
  opts: AttachmentInsertOptions,
): number {
  if (opts.maxAttachmentBytes != null && file.size > opts.maxAttachmentBytes) {
    opts.onAttachmentRejected?.('too_large', file);
    return 0;
  }

  const placeholderId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `ph-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  registerPendingAttachmentFile(placeholderId, file);

  const nodeType = view.state.schema.nodes.attachmentInline;
  if (!nodeType) {
    console.warn('[attachment] attachmentInline node missing from schema');
    return 0;
  }

  const node = nodeType.create(makeAttachmentPlaceholderAttrs(file, placeholderId));
  const { state } = view;

  // Clamp pos to valid doc range
  const safePos = Math.max(0, Math.min(pos, state.doc.content.size));
  const $pos = state.doc.resolve(safePos);

  // If we're not in a textblock (e.g. between blocks), move into the nearest one
  let insertPos = safePos;
  if (!$pos.parent.isTextblock) {
    // Try inside the next node
    const next = $pos.nodeAfter;
    if (next && next.isTextblock) {
      insertPos = safePos + 1;
    } else {
      // Fall back to end of the previous textblock
      const prev = $pos.nodeBefore;
      if (prev && prev.isTextblock) {
        insertPos = safePos - 1;
      }
    }
  }

  const tr = state.tr.insert(insertPos, node);
  view.dispatch(tr);

  startAttachmentUpload(view, placeholderId, file, opts.handler);

  return insertPos + node.nodeSize;
}

/** Insert multiple inline attachment chips sequentially, each after the previous. */
export function insertAttachmentsAt(
  view: EditorView,
  pos: number,
  files: File[],
  opts: AttachmentInsertOptions,
): void {
  let insertPos = pos;
  for (const file of files) {
    const nextPos = insertAttachmentAtPos(view, insertPos, file, opts);
    if (nextPos > 0) {
      insertPos = nextPos;
    }
  }
}

export function startAttachmentUpload(
  view: EditorView,
  placeholderId: string,
  file: File,
  handler: AttachmentAPIHandler,
): void {
  handler
    .uploadAttachment(file)
    .then((result) => applyAttachmentUploadSuccess(view, placeholderId, result, handler))
    .catch((err: unknown) => {
      console.error('[attachment] Upload failed:', err);
      const message = err instanceof Error ? err.message : 'Upload failed';
      applyAttachmentUploadError(view, placeholderId, message);
    });
}

export function applyAttachmentUploadSuccess(
  view: EditorView,
  placeholderId: string,
  result: AttachmentUploadResult,
  handler: AttachmentAPIHandler,
): void {
  const { state } = view;
  const hit = findAttachmentByPlaceholderId(state.doc, placeholderId);
  if (!hit) return;

  const url = handler.getAttachmentUrl?.(result.url) ?? result.url;
  const tr = state.tr.setNodeMarkup(hit.pos, undefined, {
    ...hit.node.attrs,
    attachmentId: result.attachmentId,
    fileUrl: url,
    fileName: result.fileName,
    fileSize: result.fileSize,
    fileType: result.mimeType,
    uploadStatus: 'success',
    errorMessage: null,
  });
  view.dispatch(tr);
  clearPendingAttachmentFile(placeholderId);
}

export function applyAttachmentUploadError(
  view: EditorView,
  placeholderId: string,
  message: string,
): void {
  const { state } = view;
  const hit = findAttachmentByPlaceholderId(state.doc, placeholderId);
  if (!hit) return;

  const tr = state.tr.setNodeMarkup(hit.pos, undefined, {
    ...hit.node.attrs,
    uploadStatus: 'error',
    errorMessage: message,
  });
  view.dispatch(tr);
}
