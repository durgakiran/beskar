import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommentEvents } from './useCommentEvents';
import { useEditorPageEvents } from '../editor/useEditorPageEvents';
import { setupApiClient } from '../http/setupApiClient';

const currentUrl = 'http://localhost:3000/space/1/page/2?mode=edit#comments';

const location = {
    pathname: '/space/1/page/2',
    search: '?mode=edit',
    hash: '#comments',
    href: '',
};
const loginUrl = '/auth/login?returnTo=%2Fspace%2F1%2Fpage%2F2%3Fmode%3Dedit%23comments';

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_PAGE_EVENTS_SSE', '1');
    location.href = currentUrl;
    vi.stubGlobal('window', new Proxy(window, {
        get(target, property) { return property === 'location' ? location : Reflect.get(target, property); },
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

const transports = [
    {
        name: 'comment SSE',
        useEvents: () => { useCommentEvents('2'); },
        path: '/comment/documents/2/events',
        interval: 2000,
    },
    {
        name: 'editor SSE',
        useEvents: () => { useEditorPageEvents({ spaceId: '1', pageId: '2', enabled: true, onPageEvent: vi.fn() }); },
        path: '/editor/space/1/page/2/events',
        interval: 2000,
    },
    {
        name: 'editor polling fallback',
        useEvents: () => {
            vi.stubEnv('VITE_PAGE_EVENTS_SSE', '0');
            useEditorPageEvents({ spaceId: '1', pageId: '2', enabled: true, onPageEvent: vi.fn() });
        },
        path: '/editor/space/1/page/2/edit/meta',
        interval: 45_000,
    },
];

describe.each(transports)('$name authentication', ({ useEvents, path, interval }) => {
    it('redirects on 401 and stops requests while navigation is pending', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
        vi.stubGlobal('fetch', fetchMock);
        setupApiClient();

        await act(async () => { renderHook(useEvents); });

        expect(fetchMock.mock.calls[0][0]).toContain(path);
        expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(location.href).toBe(loginUrl);
        await act(async () => { await vi.advanceTimersByTimeAsync(interval * 3); });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([403, 503, 'network'])('keeps retrying after %s without redirecting, then stops on 401', async status => {
        const fetchMock = vi.fn();
        if (status === 'network') {
            fetchMock.mockRejectedValueOnce(new TypeError('offline'));
        } else {
            fetchMock.mockResolvedValueOnce(new Response(null, { status: Number(status) }));
        }
        fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        vi.stubGlobal('fetch', fetchMock);
        setupApiClient();

        await act(async () => { renderHook(useEvents); });
        expect(location.href).toBe(currentUrl);
        await act(async () => { await vi.advanceTimersByTimeAsync(interval); });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(location.href).toBe(loginUrl);
        await act(async () => { await vi.advanceTimersByTimeAsync(interval * 3); });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('ignores a late 401 after unmount', async () => {
        let resolve!: (response: Response) => void;
        const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(done => { resolve = done; }));
        vi.stubGlobal('fetch', fetchMock);
        setupApiClient();
        const { unmount } = renderHook(useEvents);
        unmount();

        await act(async () => { resolve(new Response(null, { status: 401 })); });
        await act(async () => { await vi.advanceTimersByTimeAsync(interval * 3); });
        expect(location.href).toBe(currentUrl);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe.each(transports.slice(0, 2))('$name reconnect', ({ useEvents, interval }) => {
    it('redirects when a previously successful stream reconnects with 401', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.close(); } })))
            .mockResolvedValue(new Response(null, { status: 401 }));
        vi.stubGlobal('fetch', fetchMock);
        setupApiClient();

        await act(async () => { renderHook(useEvents); });
        expect(location.href).toBe(currentUrl);
        await act(async () => { await vi.advanceTimersByTimeAsync(interval); });
        expect(location.href).toBe(loginUrl);
        await act(async () => { await vi.advanceTimersByTimeAsync(interval * 3); });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
