/**
 * AttachmentPasteDrop — paste / drop of non-image files as inline attachment chips.
 * Pure image drops are left to ImagePasteDrop.
 * Also watches doc changes to fire onAttachmentsChange with the current list of
 * successfully uploaded attachments.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import type { AttachmentAPIHandler, AttachmentRef } from '../types';
import { insertAttachmentsAt } from './attachment-upload';

export interface AttachmentPasteDropStorage {
  attachmentHandler?: AttachmentAPIHandler;
  maxAttachmentBytes?: number;
  onAttachmentRejected?: (reason: 'too_large', file: File) => void;
  allowedMimeAccept: string;
}

/** Read live attachment config synced in `onCreate` from extension options. */
export function getAttachmentPasteStorage(editor: Editor): AttachmentPasteDropStorage | undefined {
  return (editor.storage as unknown as { attachmentPasteDrop?: AttachmentPasteDropStorage })
    .attachmentPasteDrop;
}

export interface AttachmentPasteDropOptions {
  attachmentHandler?: AttachmentAPIHandler;
  maxAttachmentBytes?: number;
  onAttachmentRejected?: (reason: 'too_large', file: File) => void;
  allowedMimeAccept?: string;
  onAttachmentsChange?: (attachments: AttachmentRef[]) => void;
}

export const AttachmentPasteDrop = Extension.create<AttachmentPasteDropOptions>({
  name: 'attachmentPasteDrop',

  addOptions() {
    return {
      attachmentHandler: undefined,
      maxAttachmentBytes: undefined,
      onAttachmentRejected: undefined,
      allowedMimeAccept: '*',
      onAttachmentsChange: undefined,
    };
  },

  addStorage() {
    return {
      attachmentHandler: undefined as AttachmentAPIHandler | undefined,
      maxAttachmentBytes: undefined as number | undefined,
      onAttachmentRejected: undefined as ((reason: 'too_large', file: File) => void) | undefined,
      allowedMimeAccept: '*' as string,
    };
  },

  onCreate() {
    const s = this.storage as AttachmentPasteDropStorage;
    s.attachmentHandler = this.options.attachmentHandler;
    s.maxAttachmentBytes = this.options.maxAttachmentBytes;
    s.onAttachmentRejected = this.options.onAttachmentRejected;
    s.allowedMimeAccept = this.options.allowedMimeAccept ?? '*';
  },

  addProseMirrorPlugins() {
    const options = this.options;

    // Track previous list to avoid spurious calls
    let prevIds = '';

    return [
      // ── Doc-change watcher: emit onAttachmentsChange ──────────────────────
      new Plugin({
        key: new PluginKey('attachmentChangeWatcher'),
        view: () => ({
          update(view, prevState) {
            if (view.state.doc === prevState.doc) return;
            const cb = options.onAttachmentsChange;
            if (!cb) return;

            const refs: AttachmentRef[] = [];
            view.state.doc.descendants((node) => {
              if (
                node.type.name === 'attachmentInline' &&
                node.attrs.uploadStatus === 'success' &&
                node.attrs.attachmentId
              ) {
                refs.push({
                  attachmentId: node.attrs.attachmentId,
                  fileName: node.attrs.fileName,
                  fileSize: node.attrs.fileSize,
                  fileType: node.attrs.fileType,
                  fileUrl: node.attrs.fileUrl,
                });
              }
            });

            const ids = refs.map((r) => r.attachmentId).join(',');
            if (ids === prevIds) return;
            prevIds = ids;
            cb(refs);
          },
        }),
      }),

      // ── Paste / drop handler ───────────────────────────────────────────────
      new Plugin({
        key: new PluginKey('attachmentPasteDrop'),
        props: {
          handlePaste: (view, event) => {
            if (!view.editable || !options.attachmentHandler) return false;

            const files = Array.from(event.clipboardData?.files || []);
            if (files.length === 0) return false;

            const nonImages = files.filter((f) => !f.type.startsWith('image/'));
            if (nonImages.length === 0) return false;

            event.preventDefault();
            const pos = view.state.selection.from;
            insertAttachmentsAt(view, pos, nonImages, {
              handler: options.attachmentHandler,
              maxAttachmentBytes: options.maxAttachmentBytes,
              onAttachmentRejected: options.onAttachmentRejected,
            });
            return true;
          },

          handleDrop: (view, event) => {
            if (!view.editable || !options.attachmentHandler) return false;

            const allFiles = Array.from(event.dataTransfer?.files || []);
            if (allFiles.length === 0) return false;

            const nonImages = allFiles.filter((f) => !f.type.startsWith('image/'));
            if (nonImages.length === 0) return false;

            // Mixed drop: let ImagePasteDrop handle it; we only take pure non-image drops
            if (allFiles.some((f) => f.type.startsWith('image/'))) return false;

            event.preventDefault();
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!coords) return true;

            insertAttachmentsAt(view, coords.pos, nonImages, {
              handler: options.attachmentHandler,
              maxAttachmentBytes: options.maxAttachmentBytes,
              onAttachmentRejected: options.onAttachmentRejected,
            });
            return true;
          },
        },
      }),
    ];
  },
});

export default AttachmentPasteDrop;
