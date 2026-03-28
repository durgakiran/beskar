import React, { useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { AttachmentAPIHandler } from '../../types';
import {
  getPendingAttachmentFile,
  startAttachmentUpload,
} from '../../extensions/attachment-upload';
import { getAttachmentPasteStorage } from '../../extensions/attachment-paste-drop';
import type { Editor } from '@tiptap/core';

function getAttachmentHandler(editor: Editor): AttachmentAPIHandler | undefined {
  return getAttachmentPasteStorage(editor)?.attachmentHandler;
}

async function downloadViaFetch(url: string, fileName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include', mode: 'cors' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName || 'download';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function AttachmentInlineView({
  node,
  editor,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const {
    fileUrl,
    fileName,
    fileSize,
    fileType: _fileType,
    placeholderId,
    uploadStatus,
    errorMessage,
  } = node.attrs as {
    fileUrl: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    placeholderId: string;
    uploadStatus: 'uploading' | 'success' | 'error';
    errorMessage: string | null;
  };

  const displayName = fileName || 'file';

  const handleChipClick = useCallback(async () => {
    if (uploadStatus !== 'success' || !fileUrl) return;
    const h = getAttachmentHandler(editor);
    try {
      if (h?.downloadAttachment) {
        await h.downloadAttachment({ url: fileUrl, fileName: displayName });
        return;
      }
      if (fileUrl.startsWith('blob:') || fileUrl.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = fileUrl;
        a.download = displayName;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      await downloadViaFetch(fileUrl, displayName);
    } catch (e) {
      console.error('[AttachmentInlineView] download failed', e);
    }
  }, [editor, fileUrl, displayName, uploadStatus]);

  const handleRetry = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const h = getAttachmentHandler(editor);
      if (!h || !placeholderId) return;
      const file = getPendingAttachmentFile(placeholderId);
      if (!file) return;
      updateAttributes({ uploadStatus: 'uploading', errorMessage: null });
      queueMicrotask(() => {
        startAttachmentUpload(editor.view, placeholderId, file, h);
      });
    },
    [editor, placeholderId, updateAttributes],
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteNode();
    },
    [deleteNode],
  );

  const isSuccess = uploadStatus === 'success' && !!fileUrl;
  const isUploading = uploadStatus === 'uploading';
  const isError = uploadStatus === 'error';
  const canRetry = isError && !!placeholderId && !!getPendingAttachmentFile(placeholderId);

  const sizeLabel = fileSize > 0 ? ` · ${formatFileSize(fileSize)}` : '';

  return (
    <NodeViewWrapper as="span" className="attachment-inline-wrapper">
      <span
        className={`attachment-inline-chip attachment-inline-${uploadStatus}`}
        contentEditable={false}
        onClick={isSuccess ? handleChipClick : undefined}
        title={isSuccess ? `Download ${displayName}` : displayName}
        aria-label={isSuccess ? `Download ${displayName}` : displayName}
        role={isSuccess ? 'button' : undefined}
      >
        <span className="attachment-inline-icon" aria-hidden>
          {isError ? '⚠' : '📎'}
        </span>
        <span className="attachment-inline-filename">
          {displayName}
          {!isUploading && sizeLabel}
        </span>

        {isUploading && (
          <span className="attachment-inline-spinner" aria-label="Uploading…" />
        )}

        {isError && (
          <span className="attachment-inline-actions">
            {canRetry && (
              <button
                type="button"
                className="attachment-inline-action-btn"
                onClick={handleRetry}
                title="Retry upload"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              className="attachment-inline-action-btn attachment-inline-remove-btn"
              onClick={handleRemove}
              title="Remove attachment"
            >
              ✕
            </button>
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[i]}`;
}
