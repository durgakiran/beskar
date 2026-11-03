import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const base = `http://127.0.0.1:43210/${'a'.repeat(64)}`;
const nativeFetch = vi.fn();

beforeEach(() => {
    vi.resetModules();
    nativeFetch.mockReset().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', nativeFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('desktop native transport', () => {
    it('routes API calls and WebSockets through the same local bridge', async () => {
        const { setupDesktopTransport } = await import('./transport');
        setupDesktopTransport(base);
        const { getSignalingUrl, getCollaborationUrl } = await import('../signaling');
        const init = { method: 'PUT', body: '{"data":"draft"}', headers: { 'Content-Type': 'application/json' } };
        await fetch('/api/v1/editor/update', init);
        expect(nativeFetch).toHaveBeenCalledWith(`${base}/api/v1/editor/update`, init);
        expect(getSignalingUrl()).toBe(base.replace('http:', 'ws:') + '/ws');
        expect(getCollaborationUrl()).toBe(base.replace('http:', 'ws:') + '/collab');
    });

    it('preserves Request bodies, headers, method, query and cancellation', async () => {
        const { setupDesktopTransport } = await import('./transport');
        setupDesktopTransport(base);
        const request = new Request(`${window.location.origin}/api/v1/editor/update?draft=1`, {
            method: 'PUT', body: 'draft-body', headers: { 'X-Test': 'preserved' },
        });
        const init = { signal: new AbortController().signal };
        await fetch(request, init);
        const [forwarded, options] = nativeFetch.mock.calls[0];
        expect(forwarded.url).toBe(`${base}/api/v1/editor/update?draft=1`);
        expect(forwarded.method).toBe('PUT');
        expect(forwarded.headers.get('X-Test')).toBe('preserved');
        expect(await forwarded.text()).toBe('draft-body');
        expect(options).toBe(init);
    });

    it.each(['/wails/runtime', '/index.desktop.html', 'https://external.example/api/v1/media/file'])('does not intercept %s', async input => {
        const { setupDesktopTransport } = await import('./transport');
        setupDesktopTransport(base);
        await fetch(input);
        expect(nativeFetch).toHaveBeenCalledWith(input, undefined);
    });

    it.each(['http://evil.example/key', 'http://127.0.0.1:43210/no-capability', `${base}?token=secret`])('rejects an unexpected bridge endpoint', async value => {
        const { setupDesktopTransport } = await import('./transport');
        expect(() => setupDesktopTransport(value)).toThrow('Invalid native transport endpoint');
    });
});
