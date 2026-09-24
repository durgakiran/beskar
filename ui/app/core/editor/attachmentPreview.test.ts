import { afterEach, expect, it, vi } from 'vitest';
import { attachmentPreview } from './attachmentPreview';
import { downloadAttachmentBlob } from '../http/uploadAttachmentData';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const file = { fileName: 'test.txt', fileType: 'text/plain', fileUrl: '/api/v1/attachments/test' };
function dialogs() {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
}
it('only declares formats the viewer can render safely', () => {
    expect(attachmentPreview.supports(file)).toBe(true);
    for (const fileType of ['text/html', 'image/svg+xml', 'application/zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
        expect(attachmentPreview.supports({ fileType })).toBe(false);
    }
});
it('fetches with credentials and renders text as text, not markup', async () => {
    dialogs();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => ({ text: async () => '<script>alert(1)</script>' }) });
    vi.stubGlobal('fetch', fetcher);
    const preview = attachmentPreview.open(file);
    await vi.waitFor(() => expect(document.querySelector('pre')).not.toBeNull());
    expect(fetcher).toHaveBeenCalledWith(file.fileUrl, expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }));
    expect(document.querySelector('pre')?.textContent).toBe('<script>alert(1)</script>');
    expect(document.querySelector('script')).toBeNull();
    (document.querySelector('button') as HTMLButtonElement).click();
    await preview;
    expect(document.querySelector('dialog')).toBeNull();
});
it('rejects failed fetching so the package can show the error', async () => {
    dialogs();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(attachmentPreview.open(file)).rejects.toThrow('Preview failed (403)');
    expect(document.querySelector('dialog')).toBeNull();
});
it('downloads include credentials and reject HTTP failures', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetcher);
    await expect(downloadAttachmentBlob(file.fileUrl, file.fileName)).rejects.toThrow('Download failed (403)');
    expect(fetcher).toHaveBeenCalledWith(file.fileUrl, expect.objectContaining({ credentials: 'include' }));
});
