import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePdfImage } from './pdfAssets';
vi.mock('../desktop/isDesktop', () => ({ isDesktop: false }));

afterEach(() => vi.unstubAllGlobals());
describe('PDF image access', () => {
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
