/**
 * AttachmentInline — non-image file reference as an inline chip.
 * Sits inside text flow like a mention. The blob lives on the server
 * independently; the doc only holds a lightweight reference.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { AttachmentInlineView } from '../components/attachment/AttachmentInlineView';

export const AttachmentInline = Node.create({
  name: 'attachmentInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-attachment-id'),
        renderHTML: (attrs) =>
          attrs.attachmentId ? { 'data-attachment-id': attrs.attachmentId } : {},
      },
      fileUrl: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-file-url') || '',
        renderHTML: (attrs) => (attrs.fileUrl ? { 'data-file-url': attrs.fileUrl } : {}),
      },
      fileName: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-file-name') || '',
        renderHTML: (attrs) => ({ 'data-file-name': attrs.fileName }),
      },
      fileSize: {
        default: 0,
        parseHTML: (el) => {
          const n = el.getAttribute('data-file-size');
          return n ? parseInt(n, 10) : 0;
        },
        renderHTML: (attrs) => ({ 'data-file-size': String(attrs.fileSize) }),
      },
      fileType: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-file-type') || '',
        renderHTML: (attrs) => ({ 'data-file-type': attrs.fileType }),
      },
      placeholderId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-placeholder-id') || '',
        renderHTML: (attrs) =>
          attrs.placeholderId ? { 'data-placeholder-id': attrs.placeholderId } : {},
      },
      uploadStatus: {
        default: 'uploading',
        parseHTML: (el) => el.getAttribute('data-upload-status') || 'uploading',
        renderHTML: (attrs) => ({ 'data-upload-status': attrs.uploadStatus }),
      },
      errorMessage: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-error-message'),
        renderHTML: (attrs) =>
          attrs.errorMessage ? { 'data-error-message': attrs.errorMessage } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="attachment-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'attachment-inline',
        'data-attachment-id': node.attrs.attachmentId ?? undefined,
        'data-file-url': node.attrs.fileUrl || undefined,
        'data-file-name': node.attrs.fileName,
        'data-file-size': String(node.attrs.fileSize),
        'data-file-type': node.attrs.fileType,
        'data-placeholder-id': node.attrs.placeholderId || undefined,
        'data-upload-status': node.attrs.uploadStatus,
        'data-error-message': node.attrs.errorMessage ?? undefined,
        class: 'attachment-inline-root',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentInlineView);
  },
});

export default AttachmentInline;
