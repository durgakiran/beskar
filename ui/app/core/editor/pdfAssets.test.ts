import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePdfImage } from './pdfAssets';
const desktop = vi.hoisted(() => ({ isDesktop: false }));
vi.mock('../desktop/isDesktop', () => desktop);
vi.mock('../desktop/transport', () => ({ getDesktopTransportURL: (path: string) => `http://127.0.0.1:43210/session${path}` }));

afterEach(() => { vi.unstubAllGlobals(); desktop.isDesktop = false; });
describe('PDF image access', () => {
    it('uses native HTTP transport instead of the unsupported wails scheme for desktop images', async () => {
        desktop.isDesktop = true;
        const fetch = vi.fn().mockResolvedValue({ ok: false });
        vi.stubGlobal('fetch', fetch);
        await expect(resolvePdfImage('/api/v1/media/image/asset')).rejects.toThrow('Image download failed');
        expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:43210/session/api/v1/media/image/asset', expect.any(Object));
    });
    it('uses the same-origin media proxy for stored image URLs', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: false });
        vi.stubGlobal('fetch', fetch);
        await expect(resolvePdfImage('https://old.example/api/v1/media/image/asset')).rejects.toThrow();
        expect(fetch).toHaveBeenCalledWith(`${window.location.origin}/api/v1/media/image/asset`, expect.objectContaining({ credentials: 'same-origin' }));
    });
    it('does not send credentials to external image hosts', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: false });
        vi.stubGlobal('fetch', fetch);
        await expect(resolvePdfImage('https://images.example/picture.png')).rejects.toThrow();
        expect(fetch).toHaveBeenCalledWith('https://images.example/picture.png', expect.objectContaining({ credentials: 'omit' }));
    });
    it('rejects unsupported schemes before fetching', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await expect(resolvePdfImage('file:///private/image.png')).rejects.toThrow('Unsupported image URL');
        expect(fetch).not.toHaveBeenCalled();
    });
});
