import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDesktopDownloads } from './downloads';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const path = '/api/v1/attachments/57a825c2-b600-48e4-a1b2-74eb7e5138e7';

function link(url = path) {
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'test.txt'; anchor.target = '_blank';
    const label = document.createElement('span'); label.textContent = 'test attachment';
    anchor.append(label); document.body.append(anchor);
    return { anchor, label };
}

describe('native attachment links', () => {
    it('replaces a nested comment link click with the native download and prevents a new browser window', async () => {
        const download = vi.fn().mockResolvedValue(undefined);
        dispose = setupDesktopDownloads(download);
        const { label } = link();
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        label.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(download).toHaveBeenCalledWith(path, 'test.txt');
        await Promise.resolve();
    });

    it('does not open duplicate save dialogs while a download is in progress', () => {
        const download = vi.fn().mockReturnValue(new Promise(() => {}));
        dispose = setupDesktopDownloads(download);
        const { anchor } = link();
        anchor.click(); anchor.click();
        expect(download).toHaveBeenCalledOnce();
    });

    it('leaves external download links alone', () => {
        const download = vi.fn();
        dispose = setupDesktopDownloads(download);
        const { anchor } = link(`https://external.example${path}`);
        anchor.addEventListener('click', event => event.preventDefault());
        anchor.click();
        expect(download).not.toHaveBeenCalled();
    });

    it('reports a failed download', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
        dispose = setupDesktopDownloads(vi.fn().mockRejectedValue(new Error('denied')));
        link().anchor.click();
        await vi.waitFor(() => expect(alert).toHaveBeenCalledOnce());
    });
});
