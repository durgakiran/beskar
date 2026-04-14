import type { AttachmentAPIHandler, AttachmentUploadResult } from '@beskar/editor';

let failFirstUpload =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('attachmentFail');

/**
 * Mock uploads for editor-demo.
 * Add `?attachmentFail` to the URL so the **first** upload attempt errors; **Retry** then succeeds.
 */
export const mockAttachmentHandler: AttachmentAPIHandler = {
  async uploadAttachment(file: File): Promise<AttachmentUploadResult> {
    await new Promise<void>((r) => setTimeout(r, 600));

    if (failFirstUpload) {
      failFirstUpload = false;
      throw new Error('Mock failure (first attempt). Click Retry to succeed.');
    }

    const attachmentId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const url = URL.createObjectURL(file);

    return {
      url,
      attachmentId,
      mimeType: file.type || 'application/octet-stream',
      fileName: file.name,
      fileSize: file.size,
    };
  },
  getAttachmentUrl: (url: string) => url,
  async downloadAttachment({ url, fileName }) {
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  },
};
