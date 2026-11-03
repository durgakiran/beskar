import { afterEach, expect, it, vi } from 'vitest';
import { downloadAttachmentBlob } from './uploadAttachmentData';

const nativeCall = vi.hoisted(() => vi.fn());
vi.mock('../desktop/isDesktop', () => ({ isDesktop: true }));
vi.mock('@wailsio/runtime', () => ({ Call: { ByName: nativeCall } }));
afterEach(() => { nativeCall.mockReset(); vi.unstubAllGlobals(); });

it('uses the native attachment save service instead of a blob download anchor', async () => {
    nativeCall.mockResolvedValue(true);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await downloadAttachmentBlob('wails://localhost/api/v1/attachments/57a825c2-b600-48e4-a1b2-74eb7e5138e7', 'test.txt');
    expect(nativeCall).toHaveBeenCalledWith('beskar/desktop/transport.Service.SaveAttachment', '/api/v1/attachments/57a825c2-b600-48e4-a1b2-74eb7e5138e7', 'test.txt');
    expect(fetch).not.toHaveBeenCalled();
});

it('treats cancelling the native save dialog as a normal return', async () => {
    nativeCall.mockResolvedValue(false);
    await expect(downloadAttachmentBlob('/api/v1/attachments/57a825c2-b600-48e4-a1b2-74eb7e5138e7', 'test.txt')).resolves.toBeUndefined();
});

it('propagates native download failures to the caller', async () => {
    nativeCall.mockRejectedValue(new Error('download failed (403)'));
    await expect(downloadAttachmentBlob('/api/v1/attachments/57a825c2-b600-48e4-a1b2-74eb7e5138e7', 'test.txt')).rejects.toThrow('download failed (403)');
});
